import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { getDb, parseJson } from "./db.js";
import { engineMap } from "./engines/index.js";
import { createGitHubPR } from "./github-service.js";
import {
  ensureRepo,
  createFeatureBranch,
  pushBranch,
  makeBranchName,
} from "./git-workspace.js";
import { buildRunPrompt } from "./runPrompt.js";

// ── SSE subscribers ─────────────────────────────────────────────────────

const runSubscribers = new Map<string, Set<Response>>();

export function getRunSubscribers(): Map<string, Set<Response>> {
  return runSubscribers;
}

export function publishRunEvent(runId: string, payload: Record<string, unknown>): void {
  const subscribers = runSubscribers.get(runId);
  if (!subscribers) {
    return;
  }

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const subscriber of subscribers) {
    subscriber.write(data);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

export function insertAgentComment(issueId: string, agentId: string, body: string) {
  getDb()
    .prepare(
      `INSERT INTO issue_comments (id, issue_id, parent_id, author_type, author_id, body)
       VALUES (?, ?, NULL, 'agent', ?, ?)`,
    )
    .run(randomUUID(), issueId, agentId, body);
}

function agentHasTool(agentRow: Record<string, unknown>, tool: string): boolean {
  return parseJson<string[]>(String(agentRow.tools ?? "[]"), []).includes(tool);
}

export function isImplementationAgent(agentRow: Record<string, unknown>): boolean {
  return agentHasTool(agentRow, "code-exec") || agentHasTool(agentRow, "file-system");
}

export function isDelegationOnlyAgent(agentRow: Record<string, unknown>): boolean {
  if (isImplementationAgent(agentRow)) {
    return false;
  }

  const identity = [agentRow.name, agentRow.role, agentRow.soul_md]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");

  return /\b(?:boss|orchestrat(?:or|ion)|delegat(?:e|or|ion)|coordinator|lead)\b/i.test(identity);
}

function isIosSpecificTask(task: string): boolean {
  return /\b(?:ios|ipad(?:os)?|swift|xcode|uikit|swiftui|app store|testflight|cocoa(?:pods)?|apple)\b/i.test(task);
}

type DelegationContext = {
  issueId: string | null;
  missionId: string | null;
  rawPrompt?: string;
  issueTitle?: string;
  issueDescription?: string;
  missionTitle?: string;
  githubRepo?: string;
  baseBranch?: string;
};

export function buildDelegationMessage(
  fromAgent: Record<string, unknown>,
  targetName: string,
  context: DelegationContext,
): string {
  const db = getDb();
  const issue =
    context.issueId
      ? (db.prepare("SELECT title, description FROM issues WHERE id = ?").get(context.issueId) as
          | { title: string; description: string | null }
          | undefined)
      : undefined;
  const mission =
    context.missionId
      ? (db
          .prepare("SELECT title, github_repo, github_default_branch FROM missions WHERE id = ?")
          .get(context.missionId) as
          | { title: string; github_repo: string | null; github_default_branch: string | null }
          | undefined)
      : undefined;

  const issueTitle = issue?.title?.trim() || "Untitled issue";
  const issueDescription =
    context.issueDescription?.trim() ||
    issue?.description?.trim() ||
    context.rawPrompt?.trim() ||
    "No additional description provided.";
  const repoContext = context.githubRepo?.trim() || mission?.github_repo?.trim() || "mission-linked repository";
  const baseBranch = context.baseBranch?.trim() || mission?.github_default_branch?.trim() || "main";
  const routingNote =
    targetName === "Cody"
      ? "Treat this as Apple-platform-specific work only."
      : "Treat this as general product engineering work.";

  return [
    `Implement issue ${context.issueId ?? "unknown"}: ${context.issueTitle?.trim() || issueTitle}.`,
    `Mission: ${context.missionTitle?.trim() || mission?.title?.trim() || "linked mission"}.`,
    `Repository context: ${repoContext} on base branch ${baseBranch}.`,
    `Required change: ${issueDescription}`,
    "Constraints: keep scope tight, preserve existing layout/copy/behavior unless the issue requires otherwise, and avoid unrelated refactors.",
    "Acceptance criteria: the requested change is visible in the correct place, no unrelated behavior regresses, and changed files are reported clearly.",
    "Verification: run the strongest relevant local check you can, then report files changed, verification results, blockers, and PR URL if one is created.",
    routingNote,
  ].join(" ");
}

// ── Delegation detection ────────────────────────────────────────────────

/**
 * Detect Codex-native collaboration signals in agent output.
 * Codex uses `collab: SpawnAgent` / `collab: Wait` instead of our
 * `@agent:Name: message` directive format. When detected, this counts
 * as an implicit delegation signal.
 */
function hasCodexCollabSignal(text: string): boolean {
  return /\bcollab:\s*SpawnAgent\b/i.test(text);
}

async function processAgentDirectives(
  runId: string,
  fromAgentId: string,
  missionId: string | null,
  output: string,
  prompt?: string,
  rawPrompt?: string,
) {
  const db = getDb();
  const fromAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(fromAgentId) as Record<string, unknown> | undefined;
  if (!fromAgent) {
    return 0;
  }

  const originRun = db.prepare("SELECT issue_id FROM runs WHERE id = ?").get(runId) as { issue_id: string | null } | undefined;
  const issueId = originRun?.issue_id ?? null;

  // Strip the echoed prompt from the output so that example @agent: directives
  // inside SOUL.md / AGENTS.md are not treated as real handoff commands.
  let agentOutput = output;
  if (prompt) {
    const promptIndex = agentOutput.indexOf(prompt);
    if (promptIndex !== -1) {
      agentOutput = agentOutput.slice(promptIndex + prompt.length);
    }
  }

  const directivePattern = /@agent:([^:]+):\s*([^\n]+)/gu;
  let delegatedCount = 0;
  for (const match of agentOutput.matchAll(directivePattern)) {
    const agentName = match[1]?.trim();
    const message = match[2]?.trim();
    if (!agentName || !message) {
      continue;
    }

    const target = db
      .prepare("SELECT * FROM agents WHERE lower(name) = lower(?) LIMIT 1")
      .get(agentName) as Record<string, unknown> | undefined;
    if (!target || String(target.id) === fromAgentId) {
      continue;
    }

    db.prepare(
      `
      INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(randomUUID(), fromAgentId, String(target.id), missionId, runId, message);

    if (missionId) {
      await createRunRecord({
        agentId: String(target.id),
        prompt: `Mission handoff from ${String(fromAgent.name)}: ${message}`,
        missionId,
        issueId,
      });
    }
    delegatedCount += 1;
  }

  // Fallback: orchestration-only agents that didn't produce an explicit @agent:
  // directive still get delegation — either via Codex collab: signal or by
  // detecting they have no implementation tools.
  const orchestrationOnly = isDelegationOnlyAgent(fromAgent);
  const hasCollabSignal = hasCodexCollabSignal(output);

  if (delegatedCount === 0 && (orchestrationOnly || hasCollabSignal) && missionId && rawPrompt) {
    const fallbackTargetName = isIosSpecificTask(rawPrompt) ? "Cody" : "Claudy";
    const fallbackTarget = db
      .prepare("SELECT * FROM agents WHERE lower(name) = lower(?) LIMIT 1")
      .get(fallbackTargetName) as Record<string, unknown> | undefined;

    if (fallbackTarget && String(fallbackTarget.id) !== fromAgentId) {
      const fallbackMessage = buildDelegationMessage(fromAgent, fallbackTargetName, {
        issueId,
        missionId,
        rawPrompt,
      });
      db.prepare(
        `
        INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run(randomUUID(), fromAgentId, String(fallbackTarget.id), missionId, runId, fallbackMessage);

      await createRunRecord({
        agentId: String(fallbackTarget.id),
        prompt: `Mission handoff from ${String(fromAgent.name)}:\n${fallbackMessage}`,
        missionId,
        issueId,
      });
      delegatedCount += 1;
    }
  }

  return delegatedCount;
}

// ── Run lifecycle ───────────────────────────────────────────────────────

export async function createRunRecord(input: {
  agentId: string;
  prompt: string;
  missionId?: string | null | undefined;
  issueId?: string | null | undefined;
  scheduleId?: string | null | undefined;
}) {
  const db = getDb();
  const agentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | undefined;
  if (!agentRow) {
    throw new Error("Agent not found.");
  }

  const adapter = engineMap.get(String(agentRow.engine));
  if (!adapter) {
    throw new Error(`Unsupported engine: ${String(agentRow.engine)}`);
  }

  let workingDirectory: string | null = null;
  let githubBranch: string | null = null;

  const missionId = input.missionId ?? null;
  const issueId = input.issueId ?? null;
  const scheduleId = input.scheduleId ?? null;

  if (issueId && missionId && isImplementationAgent(agentRow)) {
    const mission = db.prepare("SELECT github_repo, github_default_branch FROM missions WHERE id = ?").get(missionId) as {
      github_repo: string | null;
      github_default_branch: string | null;
    } | undefined;

    if (mission?.github_repo) {
      const [owner, repo] = mission.github_repo.split("/");
      if (owner && repo) {
        try {
          const issue = db.prepare("SELECT title FROM issues WHERE id = ?").get(issueId) as { title: string } | undefined;
          const branchName = makeBranchName(issueId, issue?.title ?? "work");
          workingDirectory = await ensureRepo(owner, repo, issueId);
          await createFeatureBranch(workingDirectory, branchName, mission.github_default_branch ?? "main");
          githubBranch = branchName;
        } catch (error) {
          console.error("[github] Failed to prepare workspace:", error);
        }
      }
    }
  }

  const runId = randomUUID();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, schedule_id, engine, status, prompt, output, tool_calls, started_at, working_directory, github_branch)
    VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '', '[]', datetime('now'), ?, ?)
    `,
  ).run(runId, input.agentId, missionId, issueId, scheduleId, String(agentRow.engine), input.prompt, workingDirectory, githubBranch);

  void executeRun(runId);
  return runId;
}

async function executeRun(runId: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  if (!row) {
    return;
  }

  const agentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(String(row.agent_id)) as Record<string, unknown> | undefined;
  if (!agentRow) {
    db.prepare("UPDATE runs SET status = 'failed', output = ? WHERE id = ?").run("Agent not found.", runId);
    publishRunEvent(runId, { type: "error", message: "Agent not found." });
    return;
  }

  const adapter = engineMap.get(String(agentRow.engine));
  if (!adapter) {
    db.prepare("UPDATE runs SET status = 'failed', output = ? WHERE id = ?").run("Engine not supported.", runId);
    publishRunEvent(runId, { type: "error", message: "Engine not supported." });
    return;
  }

  const startedAt = Date.now();
  let output = "";

  if (row.issue_id) {
    insertAgentComment(String(row.issue_id), String(row.agent_id), `Started working on this issue.`);
  }

  if (isDelegationOnlyAgent(agentRow) && row.mission_id && row.issue_id) {
    const targetName = isIosSpecificTask(String(row.prompt ?? "")) ? "Cody" : "Claudy";
    const target = db
      .prepare("SELECT * FROM agents WHERE lower(name) = lower(?) LIMIT 1")
      .get(targetName) as Record<string, unknown> | undefined;

    if (!target || String(target.id) === String(agentRow.id)) {
      const message = `Delegation target ${targetName} is not configured.`;
      db.prepare(
        `
        UPDATE runs
        SET status = 'failed', output = ?, finished_at = datetime('now'), duration_ms = ?
        WHERE id = ?
        `,
      ).run(message, Date.now() - startedAt, runId);
      publishRunEvent(runId, { type: "error", message, output: message });
      if (row.issue_id) {
        insertAgentComment(String(row.issue_id), String(row.agent_id), `Failed to delegate this issue.\n\nError: ${message}`);
      }
      return;
    }

    const handoffMessage = buildDelegationMessage(agentRow, targetName, {
      issueId: String(row.issue_id),
      missionId: String(row.mission_id),
      rawPrompt: String(row.prompt ?? ""),
    });

    db.prepare(
      `
      INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(randomUUID(), String(agentRow.id), String(target.id), row.mission_id, runId, handoffMessage);

    const childRunId = await createRunRecord({
      agentId: String(target.id),
      prompt: `Mission handoff from ${String(agentRow.name)}: ${handoffMessage}`,
      missionId: (row.mission_id as string | null) ?? null,
      issueId: (row.issue_id as string | null) ?? null,
    });

    output = `@agent:${targetName}: ${handoffMessage}\n\nDelegated implementation to ${targetName}. Follow-up run: ${childRunId}`;

    db.prepare(
      `
      UPDATE runs
      SET status = 'complete', output = ?, finished_at = datetime('now'), duration_ms = ?
      WHERE id = ?
      `,
    ).run(output, Date.now() - startedAt, runId);
    publishRunEvent(runId, { type: "complete", output, duration_ms: Date.now() - startedAt });

    if (row.issue_id) {
      insertAgentComment(
        String(row.issue_id),
        String(row.agent_id),
        `Delegated this issue to ${targetName}.\n\n${handoffMessage}`,
      );
    }
    return;
  }

  const baseConfig = parseJson<Record<string, unknown>>(String(agentRow.connection_config ?? "{}"), {});
  const workingDir = typeof row.working_directory === "string" ? row.working_directory : null;
  const connectionConfig = workingDir ? { ...baseConfig, workingDirectory: workingDir } : baseConfig;

  try {
    const fullPrompt = buildRunPrompt(agentRow, String(row.prompt ?? ""));
    for await (const chunk of adapter.run({
      prompt: fullPrompt,
      connectionConfig,
      agent: {
        id: String(agentRow.id),
        name: String(agentRow.name),
        ...(typeof agentRow.role === "string" ? { role: agentRow.role } : {}),
        tools: parseJson<string[]>(String(agentRow.tools ?? "[]"), []),
      },
      context: {
        missionId: row.mission_id,
        issueId: row.issue_id,
      },
    })) {
      output += chunk;
      db.prepare("UPDATE runs SET output = ? WHERE id = ?").run(output, runId);
      publishRunEvent(runId, { type: "chunk", chunk, output });
    }

    let delegatedCount = 0;

    db.prepare(
      `
      UPDATE runs
      SET status = 'complete', output = ?, finished_at = datetime('now'), duration_ms = ?
      WHERE id = ?
      `,
    ).run(output, Date.now() - startedAt, runId);
    publishRunEvent(runId, { type: "complete", output, duration_ms: Date.now() - startedAt });
    delegatedCount = await processAgentDirectives(
      runId,
      String(agentRow.id),
      (row.mission_id as string | null) ?? null,
      output,
      fullPrompt,
      String(row.prompt ?? ""),
    );

    // After successful run, push branch and create PR if GitHub-linked
    const ghBranch = typeof row.github_branch === "string" ? row.github_branch : null;
    if (workingDir && ghBranch && row.mission_id) {
      try {
        const mission = db.prepare("SELECT github_repo, github_default_branch FROM missions WHERE id = ?").get(String(row.mission_id)) as {
          github_repo: string | null;
          github_default_branch: string | null;
        } | undefined;

        if (mission?.github_repo) {
          const [owner, repo] = mission.github_repo.split("/");
          if (owner && repo) {
            await pushBranch(workingDir, ghBranch);
            const issue = row.issue_id
              ? (db.prepare("SELECT title, github_number FROM issues WHERE id = ?").get(String(row.issue_id)) as { title: string; github_number: number | null } | undefined)
              : undefined;

            const prTitle = issue?.title ? `[Agent] ${issue.title}` : `[Agent] ${ghBranch}`;
            const ghIssueRef = issue?.github_number ? `\n\nCloses #${issue.github_number}` : "";
            const prBody = `Automated changes by agent **${String(agentRow.name)}**.${ghIssueRef}`;
            const baseBranch = mission.github_default_branch ?? "main";

            const pr = await createGitHubPR(owner, repo, ghBranch, baseBranch, prTitle, prBody);
            db.prepare("UPDATE runs SET github_pr_url = ? WHERE id = ?").run(pr.html_url, runId);

            if (row.issue_id) {
              db.prepare("UPDATE issues SET github_pr_number = ?, github_pr_url = ?, github_branch = ? WHERE id = ?")
                .run(pr.number, pr.html_url, ghBranch, String(row.issue_id));
            }

            publishRunEvent(runId, { type: "pr_created", pr_url: pr.html_url, pr_number: pr.number });
          }
        }
      } catch (prError) {
        console.error("[github] Failed to push/create PR:", prError);
        publishRunEvent(runId, { type: "pr_error", message: prError instanceof Error ? prError.message : "PR creation failed." });
      }
    }

    // Post "completed" comment on the issue
    if (row.issue_id) {
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      const truncatedOutput = output.length > 500 ? `${output.slice(0, 500)}...` : output;
      const updatedRun = db.prepare("SELECT github_pr_url FROM runs WHERE id = ?").get(runId) as { github_pr_url: string | null } | undefined;
      const prLine = updatedRun?.github_pr_url ? `\nPR: ${updatedRun.github_pr_url}` : "";
      const delegationLine =
        delegatedCount > 0 && isDelegationOnlyAgent(agentRow)
          ? `\nDelegated follow-up run(s): ${delegatedCount}`
          : "";
      insertAgentComment(
        String(row.issue_id),
        String(row.agent_id),
        `Completed this issue in ${durationSec}s.${prLine}${delegationLine}\n\n${truncatedOutput}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run failed.";
    const failedOutput = `${output}${output ? "\n\n" : ""}[error] ${message}`;
    db.prepare(
      `
      UPDATE runs
      SET status = 'failed', output = ?, finished_at = datetime('now'), duration_ms = ?
      WHERE id = ?
      `,
    ).run(failedOutput, Date.now() - startedAt, runId);
    publishRunEvent(runId, { type: "error", message, output: failedOutput });

    if (row.issue_id) {
      insertAgentComment(
        String(row.issue_id),
        String(row.agent_id),
        `Failed to complete this issue.\n\nError: ${message}`,
      );
    }
  }
}
