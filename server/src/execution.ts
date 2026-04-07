import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { isDelegationOnlyAgent, isImplementationAgent, isIosSpecificTask } from "./agentClassification.js";
import { getDb, parseJson } from "./db.js";
import { engineMap } from "./engines/index.js";
import { extractPlan, getReadySteps, validatePlan } from "./executionPlan.js";
import type { ExecutionPlan } from "./executionPlan.js";
import { createGitHubPR } from "./github-service.js";
import {
  ensureRepo,
  createFeatureBranch,
  pushBranch,
  formatIssueKey,
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

// Re-export classification functions for backward compatibility
export { isDelegationOnlyAgent, isImplementationAgent, isIosSpecificTask } from "./agentClassification.js";

export function buildPullRequestTitle(
  agentName: string,
  issueTitle: string | null | undefined,
  issueKey: string | null | undefined,
  fallbackBranch: string,
): string {
  const normalizedAgentName = String(agentName).trim() || "Agent";
  const normalizedIssueTitle = issueTitle?.trim();
  const normalizedIssueKey = issueKey?.trim();

  if (normalizedIssueTitle && normalizedIssueKey) {
    return `[${normalizedAgentName}] ${normalizedIssueKey}: ${normalizedIssueTitle}`;
  }

  if (normalizedIssueTitle) {
    return `[${normalizedAgentName}] ${normalizedIssueTitle}`;
  }

  return `[${normalizedAgentName}] ${fallbackBranch}`;
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
    "Constraints: keep scope tight, preserve existing layout/copy/behavior unless the issue requires otherwise, and avoid unrelated refactors. IMPORTANT: only modify files within your current working directory — never modify files outside the workspace you have been given.",
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

export function stripPromptEcho(output: string, prompts: Array<string | undefined>): string {
  for (const prompt of prompts) {
    const candidate = prompt?.trim();
    if (!candidate) {
      continue;
    }

    const index = output.lastIndexOf(candidate);
    if (index !== -1) {
      return output.slice(index + candidate.length).trimStart();
    }
  }

  return output;
}

function findExistingChildRun(input: {
  parentRunId: string;
  agentId: string;
  prompt: string;
  planStepId?: string | null;
}): { id: string; status: string } | null {
  const db = getDb();

  if (input.planStepId) {
    return (
      db
        .prepare(
          `
          SELECT id, status
          FROM runs
          WHERE parent_run_id = ? AND plan_step_id = ?
          ORDER BY started_at DESC
          LIMIT 1
          `,
        )
        .get(input.parentRunId, input.planStepId) as { id: string; status: string } | undefined
    ) ?? null;
  }

  return (
    db
      .prepare(
        `
        SELECT id, status
        FROM runs
        WHERE parent_run_id = ? AND agent_id = ? AND prompt = ?
        ORDER BY started_at DESC
        LIMIT 1
        `,
      )
      .get(input.parentRunId, input.agentId, input.prompt) as { id: string; status: string } | undefined
  ) ?? null;
}

async function processAgentDirectives(
  runId: string,
  fromAgentId: string,
  missionId: string | null,
  output: string,
  rawPrompt?: string,
) {
  const db = getDb();
  const fromAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(fromAgentId) as Record<string, unknown> | undefined;
  if (!fromAgent) {
    return 0;
  }

  const originRun = db.prepare("SELECT issue_id FROM runs WHERE id = ?").get(runId) as { issue_id: string | null } | undefined;
  const issueId = originRun?.issue_id ?? null;

  const directivePattern = /@agent:([^:]+):\s*([^\n]+)/gu;
  let delegatedCount = 0;
  for (const match of output.matchAll(directivePattern)) {
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

    const delegatedPrompt = `Mission handoff from ${String(fromAgent.name)}: ${message}`;
    const existingRun = findExistingChildRun({
      parentRunId: runId,
      agentId: String(target.id),
      prompt: delegatedPrompt,
    });
    if (existingRun) {
      delegatedCount += 1;
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
        prompt: delegatedPrompt,
        missionId,
        issueId,
        parentRunId: runId,
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
      const delegatedPrompt = `Mission handoff from ${String(fromAgent.name)}:\n${fallbackMessage}`;
      const existingRun = findExistingChildRun({
        parentRunId: runId,
        agentId: String(fallbackTarget.id),
        prompt: delegatedPrompt,
      });
      if (existingRun) {
        delegatedCount += 1;
        return delegatedCount;
      }

      db.prepare(
        `
        INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run(randomUUID(), fromAgentId, String(fallbackTarget.id), missionId, runId, fallbackMessage);

      await createRunRecord({
        agentId: String(fallbackTarget.id),
        prompt: delegatedPrompt,
        missionId,
        issueId,
        parentRunId: runId,
      });
      delegatedCount += 1;
    }
  }

  return delegatedCount;
}

// ── Complexity gating ──────────────────────────────────────────────────

const SIMPLE_TASK_PATTERNS = [
  /\b(swap|replace|change|update)\b.*\b(image|icon|logo|favicon|asset)\b/i,
  /\b(change|update|fix)\b.*\b(text|copy|label|title|heading|placeholder)\b/i,
  /\b(change|update|fix)\b.*\b(color|colour|background|border)\b/i,
  /\bsingle[- ]file\b/i,
  /\b(typo|spelling|wording)\b/i,
  /\b(show|hide|toggle)\b.*\b(element|button|link|section)\b/i,
];

export function isSimpleTask(prompt: string): boolean {
  return SIMPLE_TASK_PATTERNS.some((pattern) => pattern.test(prompt));
}

// ── Run lifecycle ───────────────────────────────────────────────────────

export async function createRunRecord(input: {
  agentId: string;
  prompt: string;
  missionId?: string | null | undefined;
  issueId?: string | null | undefined;
  scheduleId?: string | null | undefined;
  parentRunId?: string | null | undefined;
  planStepId?: string | null | undefined;
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
  const parentRunId = input.parentRunId ?? null;
  const planStepId = input.planStepId ?? null;

  if (issueId && missionId && isImplementationAgent(agentRow)) {
    const mission = db.prepare("SELECT github_repo, github_default_branch FROM missions WHERE id = ?").get(missionId) as {
      github_repo: string | null;
      github_default_branch: string | null;
    } | undefined;

    if (mission?.github_repo) {
      const [owner, repo] = mission.github_repo.split("/");
      if (owner && repo) {
        try {
          const issue = db.prepare("SELECT title, issue_number FROM issues WHERE id = ?").get(issueId) as
            | { title: string; issue_number: number | null }
            | undefined;
          const issuePrefixRow = db.prepare("SELECT value FROM settings WHERE key = 'issue_prefix'").get() as
            | { value: string }
            | undefined;
          const issueKey = formatIssueKey(issue?.issue_number, issuePrefixRow?.value, issueId);
          const branchName = makeBranchName(String(agentRow.name), issueKey, issue?.title ?? "work");
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
    INSERT INTO runs (id, agent_id, mission_id, issue_id, schedule_id, engine, status, prompt, output, tool_calls, started_at, working_directory, github_branch, parent_run_id, plan_step_id)
    VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '', '[]', datetime('now'), ?, ?, ?, ?)
    `,
  ).run(runId, input.agentId, missionId, issueId, scheduleId, String(agentRow.engine), input.prompt, workingDirectory, githubBranch, parentRunId, planStepId);

  if (issueId) {
    db.prepare("UPDATE issues SET status = 'in_progress' WHERE id = ? AND status NOT IN ('done', 'in_review', 'merged_ready')")
      .run(issueId);
  }

  void executeRun(runId);
  return runId;
}

// ── Plan-based delegation ───────���───────────────────────────────────────

async function processPlan(
  parentRunId: string,
  plan: ExecutionPlan,
  missionId: string | null,
  issueId: string | null,
  fromAgentId: string,
): Promise<number> {
  const db = getDb();

  // Store the plan on the parent run
  db.prepare("UPDATE runs SET execution_plan = ? WHERE id = ?").run(JSON.stringify(plan), parentRunId);

  const readySteps = getReadySteps(plan, new Set(), new Set());
  let spawnedCount = 0;

  for (const step of readySteps) {
    const target = db
      .prepare("SELECT * FROM agents WHERE lower(name) = lower(?) LIMIT 1")
      .get(step.agent) as Record<string, unknown> | undefined;
    if (!target || String(target.id) === fromAgentId) {
      continue;
    }

    const fromAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(fromAgentId) as Record<string, unknown> | undefined;
    const handoffMessage = fromAgent
      ? buildDelegationMessage(fromAgent, step.agent, { issueId, missionId, rawPrompt: step.task })
      : step.task;
    const delegatedPrompt = `Mission handoff from orchestrator:\n${handoffMessage}`;
    const existingRun = findExistingChildRun({
      parentRunId,
      agentId: String(target.id),
      prompt: delegatedPrompt,
      planStepId: step.id,
    });
    if (existingRun) {
      spawnedCount += 1;
      continue;
    }

    await createRunRecord({
      agentId: String(target.id),
      prompt: delegatedPrompt,
      missionId,
      issueId,
      parentRunId,
      planStepId: step.id,
    });
    db.prepare(
      `
      INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(randomUUID(), fromAgentId, String(target.id), missionId, parentRunId, step.task);
    spawnedCount += 1;
  }

  return spawnedCount;
}

async function checkPlanProgress(parentRunId: string): Promise<void> {
  const db = getDb();
  const parentRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(parentRunId) as Record<string, unknown> | undefined;
  if (!parentRow?.execution_plan) {
    return;
  }

  let plan: ExecutionPlan;
  try {
    plan = JSON.parse(String(parentRow.execution_plan)) as ExecutionPlan;
  } catch {
    return;
  }

  const childRows = db
    .prepare("SELECT plan_step_id, status FROM runs WHERE parent_run_id = ?")
    .all(parentRunId) as Array<{ plan_step_id: string | null; status: string }>;

  const completedStepIds = new Set<string>();
  const startedStepIds = new Set<string>();
  let allTerminal = true;

  for (const child of childRows) {
    if (child.plan_step_id) {
      startedStepIds.add(child.plan_step_id);
      if (child.status === "complete") {
        completedStepIds.add(child.plan_step_id);
      }
      if (child.status !== "complete" && child.status !== "failed") {
        allTerminal = false;
      }
    }
  }

  // Spawn newly unblocked steps
  const readySteps = getReadySteps(plan, completedStepIds, startedStepIds);
  const missionId = (parentRow.mission_id as string | null) ?? null;
  const issueId = (parentRow.issue_id as string | null) ?? null;
  const fromAgentId = String(parentRow.agent_id);

  for (const step of readySteps) {
    const target = db
      .prepare("SELECT * FROM agents WHERE lower(name) = lower(?) LIMIT 1")
      .get(step.agent) as Record<string, unknown> | undefined;
    if (!target || String(target.id) === fromAgentId) {
      continue;
    }

    const fromAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(fromAgentId) as Record<string, unknown> | undefined;
    const handoffMessage = fromAgent
      ? buildDelegationMessage(fromAgent, step.agent, { issueId, missionId, rawPrompt: step.task })
      : step.task;
    const delegatedPrompt = `Mission handoff from orchestrator:\n${handoffMessage}`;
    const existingRun = findExistingChildRun({
      parentRunId,
      agentId: String(target.id),
      prompt: delegatedPrompt,
      planStepId: step.id,
    });
    if (existingRun) {
      continue;
    }

    await createRunRecord({
      agentId: String(target.id),
      prompt: delegatedPrompt,
      missionId,
      issueId,
      parentRunId,
      planStepId: step.id,
    });
    db.prepare(
      `
      INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(randomUUID(), fromAgentId, String(target.id), missionId, parentRunId, step.task);
  }

  // Check if all plan steps are terminal
  if (allTerminal && readySteps.length === 0 && startedStepIds.size >= plan.plan.length) {
    const hasFailures = childRows.some((c) => c.status === "failed");
    const finalStatus = hasFailures ? "failed" : "complete";
    db.prepare(
      `
      UPDATE runs
      SET status = ?, finished_at = datetime('now')
      WHERE id = ? AND status = 'complete'
      `,
    ).run(finalStatus, parentRunId);
  }
}

// ── Run execution ───────────────────────────────────────────────────────

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

  const baseConfig = parseJson<Record<string, unknown>>(String(agentRow.connection_config ?? "{}"), {});
  const workingDir = typeof row.working_directory === "string" ? row.working_directory : null;
  const connectionConfig = workingDir ? { ...baseConfig, workingDirectory: workingDir } : { ...baseConfig };

  // Complexity gating: use sonnet for simple tasks on Claude Code engine
  if (String(agentRow.engine) === "claude-code" && isSimpleTask(String(row.prompt ?? ""))) {
    if (!connectionConfig.model || connectionConfig.model === "claude-opus-4-6") {
      connectionConfig.model = "claude-sonnet-4-6";
    }
  }

  try {
    const fullPrompt = buildRunPrompt(agentRow, String(row.prompt ?? ""));
    const rawPrompt = String(row.prompt ?? "");
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

    // Plan-based delegation for orchestrator agents
    const parsedOutput = stripPromptEcho(output, [fullPrompt, rawPrompt]);
    if (isDelegationOnlyAgent(agentRow)) {
      const plan = extractPlan(parsedOutput);
      if (plan) {
        const agentNames = (db.prepare("SELECT name FROM agents WHERE active = 1").all() as Array<{ name: string }>).map((a) => a.name);
        const validation = validatePlan(plan, agentNames);
        if (validation.valid) {
          delegatedCount = await processPlan(
            runId,
            plan,
            (row.mission_id as string | null) ?? null,
            (row.issue_id as string | null) ?? null,
            String(agentRow.id),
          );
        } else {
          console.warn(`[plan] Invalid plan from ${String(agentRow.name)}: ${validation.error}`);
        }
      }
    }

    // Fallback: legacy @agent: directive parsing (for non-plan agents or when plan extraction fails)
    if (delegatedCount === 0) {
      delegatedCount = await processAgentDirectives(
        runId,
        String(agentRow.id),
        (row.mission_id as string | null) ?? null,
        parsedOutput,
        rawPrompt,
      );
    }

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
              ? (db.prepare("SELECT title, github_number, issue_number FROM issues WHERE id = ?").get(String(row.issue_id)) as
                  | { title: string; github_number: number | null; issue_number: number | null }
                  | undefined)
              : undefined;
            const issuePrefixRow = db.prepare("SELECT value FROM settings WHERE key = 'issue_prefix'").get() as
              | { value: string }
              | undefined;
            const issueKey = row.issue_id ? formatIssueKey(issue?.issue_number, issuePrefixRow?.value, String(row.issue_id)) : null;

            const prTitle = buildPullRequestTitle(String(agentRow.name), issue?.title, issueKey, ghBranch);
            const ghIssueRef = issue?.github_number ? `\n\nCloses #${issue.github_number}` : "";
            const prBody = `Automated changes by agent **${String(agentRow.name)}**.${ghIssueRef}`;
            const baseBranch = mission.github_default_branch ?? "main";

            const pr = await createGitHubPR(owner, repo, ghBranch, baseBranch, prTitle, prBody);
            db.prepare("UPDATE runs SET github_pr_url = ? WHERE id = ?").run(pr.html_url, runId);

            if (row.issue_id) {
              db.prepare("UPDATE issues SET github_pr_number = ?, github_pr_url = ?, github_branch = ?, status = 'in_review' WHERE id = ?")
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

    // Advance parent plan if this run is a child step
    const parentRunId = row.parent_run_id as string | null;
    if (parentRunId) {
      await checkPlanProgress(parentRunId);
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

    // Even on failure, advance parent plan so it can detect blocked steps
    const parentRunId = row.parent_run_id as string | null;
    if (parentRunId) {
      await checkPlanProgress(parentRunId);
    }
  }
}
