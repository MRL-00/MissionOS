import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDelegationMessage,
  buildPullRequestTitle,
  formatRunFailureOutput,
  recordRunFailure,
  getRunSubscribers,
  isAgentRowActive,
  isDelegationOnlyAgent,
  isImplementationAgent,
  isIosSpecificTask,
  listActiveAgentNamesForMission,
  publishRunEvent,
  resolveActiveAgentByName,
  stripPromptEcho,
} from "./execution.js";
import { getDb, resetDatabase } from "./db.js";

test("identifies implementation-capable agents by tool access", () => {
  assert.equal(isImplementationAgent({ tools: JSON.stringify(["code-exec"]) }), true);
  assert.equal(isImplementationAgent({ tools: JSON.stringify(["file-system"]) }), true);
  assert.equal(isImplementationAgent({ tools: JSON.stringify(["web-search"]) }), false);
});

test("identifies delegation-only agents from role/prompt identity when they lack implementation tools", () => {
  assert.equal(
    isDelegationOnlyAgent({
      name: "Boss",
      role: "Orchestrator",
      soul_md: "You are delegation-only by default.",
      tools: JSON.stringify([]),
    }),
    true,
  );

  assert.equal(
    isDelegationOnlyAgent({
      name: "Analyst",
      role: "Researcher",
      soul_md: "Read docs and summarize findings.",
      tools: JSON.stringify([]),
    }),
    false,
  );
});

test("identifies iOS-specific tasks from platform keywords", () => {
  assert.equal(isIosSpecificTask("Build the SwiftUI onboarding screen for TestFlight"), true);
  assert.equal(isIosSpecificTask("Tighten dashboard filters for the web app"), false);
});

test("buildDelegationMessage includes issue, repo, acceptance, and verification context", () => {
  const message = buildDelegationMessage(
    { name: "Boss" },
    "Claudy",
    {
      issueId: "issue-1",
      missionId: "mission-1",
      issueTitle: "Change login button to be ORANGE",
      issueDescription: "Change the login button to be ORANGE on the main login page.",
      missionTitle: "EpicZone",
      githubRepo: "acme/portal",
      baseBranch: "main",
      rawPrompt: "fallback prompt",
    },
  );

  assert.match(message, /Implement issue issue-1: Change login button to be ORANGE\./);
  assert.match(message, /Repository context: acme\/portal on base branch main\./);
  assert.match(message, /Acceptance criteria:/);
  assert.match(message, /Verification:/);
  assert.match(message, /general product engineering work/i);
});

test("stripPromptEcho removes echoed orchestrator prompt before delegation parsing", () => {
  const prompt = [
    "[OUTPUT FORMAT]",
    "Use one single-line directive to hand work off:",
    "@agent:Claudy: Implement EPIC-002 in the linked repo. Change the main login button to black.",
    "",
    "[TASK]",
    "Resolve the following issue.",
  ].join("\n");
  const modelOutput = [
    prompt,
    "",
    "```json:plan",
    JSON.stringify(
      {
        plan: [
          {
            id: "step-1",
            agent: "Claudy",
            task: "Issue ID: issue-1. Change login button text to WASSSSSUP.",
          },
        ],
        summary: "Delegate the requested login page copy change to Claudy.",
      },
      null,
      2,
    ),
    "```",
  ].join("\n");

  const stripped = stripPromptEcho(modelOutput, [prompt]);

  assert.doesNotMatch(stripped, /@agent:Claudy: Implement EPIC-002/i);
  assert.match(stripped, /```json:plan/);
  assert.match(stripped, /WASSSSSUP/);
});

test("resolveActiveAgentByName prefers mission-assigned agents for duplicate team names", () => {
  const db = resetDatabase();
  db.prepare(
    `
    INSERT INTO agents (id, name, engine, active, created_at)
    VALUES
      ('engineering-researcher', 'Researcher', 'codex', 1, '2026-05-06T00:00:00.000Z'),
      ('finance-researcher', 'Researcher', 'codex', 1, '2026-05-06T00:01:00.000Z')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('finance-mission', 'Finance mission', 'active', 'Finance')
    `,
  ).run();
  db.prepare("INSERT INTO mission_agents (mission_id, agent_id) VALUES ('finance-mission', 'finance-researcher')").run();

  const missionScoped = resolveActiveAgentByName(db, "Researcher", "finance-mission");
  const global = resolveActiveAgentByName(db, "Researcher", null);

  assert.equal(missionScoped?.id, "finance-researcher");
  assert.equal(global?.id, "engineering-researcher");
});

test("listActiveAgentNamesForMission only includes active mission assignees", () => {
  const db = resetDatabase();
  db.prepare(
    `
    INSERT INTO agents (id, name, engine, active)
    VALUES
      ('finance-active', 'Finance Analyst', 'codex', 1),
      ('finance-inactive', 'Dormant Analyst', 'codex', 0),
      ('engineering-active', 'Engineering Analyst', 'codex', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('finance-mission', 'Finance mission', 'active', 'Finance')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO mission_agents (mission_id, agent_id)
    VALUES
      ('finance-mission', 'finance-active'),
      ('finance-mission', 'finance-inactive')
    `,
  ).run();

  assert.deepEqual(listActiveAgentNamesForMission(db, "finance-mission"), ["Finance Analyst"]);
  assert.deepEqual(listActiveAgentNamesForMission(db, null), ["Engineering Analyst", "Finance Analyst"]);
});

test("buildPullRequestTitle includes agent name and issue key when available", () => {
  assert.equal(
    buildPullRequestTitle("Claudy", "Update image source", "EPIC-001", "claudy/EPIC-001/update-image-source"),
    "[Claudy] EPIC-001: Update image source",
  );
});

test("buildPullRequestTitle falls back cleanly when issue context is missing", () => {
  assert.equal(
    buildPullRequestTitle("Claudy", null, null, "claudy/EPIC-001/update-image-source"),
    "[Claudy] claudy/EPIC-001/update-image-source",
  );
});

test("publishRunEvent removes failed subscribers and continues publishing", () => {
  const subscribers = getRunSubscribers();
  const runId = "run-test-publish";
  const writes: string[] = [];
  const failedSubscriber = {
    write() {
      throw new Error("closed");
    },
  };
  const healthySubscriber = {
    write(data: string) {
      writes.push(data);
    },
  };

  subscribers.set(runId, new Set([failedSubscriber, healthySubscriber] as never));
  publishRunEvent(runId, { type: "output", output: "hello" });

  assert.deepEqual(writes, ['data: {"type":"output","output":"hello"}\n\n']);
  assert.equal(subscribers.get(runId)?.has(failedSubscriber as never), false);
  assert.equal(subscribers.get(runId)?.has(healthySubscriber as never), true);

  subscribers.delete(runId);
});

test("publishRunEvent closes terminal run subscribers", () => {
  const subscribers = getRunSubscribers();
  const runId = "run-test-terminal-publish";
  const writes: string[] = [];
  let ended = false;
  const subscriber = {
    write(data: string) {
      writes.push(data);
    },
    end() {
      ended = true;
    },
  };

  subscribers.set(runId, new Set([subscriber] as never));
  publishRunEvent(runId, { type: "complete", output: "done" });

  assert.deepEqual(writes, ['data: {"type":"complete","output":"done"}\n\n']);
  assert.equal(ended, true);
  assert.equal(subscribers.has(runId), false);
});

test("formatRunFailureOutput appends errors without dropping existing output", () => {
  assert.equal(formatRunFailureOutput("", "boom"), "[error] boom");
  assert.equal(formatRunFailureOutput("partial", "boom"), "partial\n\n[error] boom");
});

test("recordRunFailure marks running runs terminal with timing metadata", () => {
  const db = resetDatabase();
  const runId = "run-record-failure";
  db.prepare(
    `
    INSERT INTO agents (id, name, engine)
    VALUES ('agent-record-failure', 'Agent', 'codex')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, engine, status, prompt, output, tool_calls, started_at)
    VALUES (?, 'agent-record-failure', 'codex', 'running', 'prompt', 'partial', '[]', datetime('now'))
    `,
  ).run(runId);

  recordRunFailure(runId, "adapter crashed", Date.now() - 1_000, "partial");

  const row = db.prepare("SELECT status, output, finished_at, duration_ms FROM runs WHERE id = ?").get(runId) as {
    status: string;
    output: string;
    finished_at: string | null;
    duration_ms: number | null;
  };
  assert.equal(row.status, "failed");
  assert.equal(row.output, "partial\n\n[error] adapter crashed");
  assert.equal(typeof row.finished_at, "string");
  assert.equal(typeof row.duration_ms, "number");
});

test("isAgentRowActive only accepts active database rows", () => {
  assert.equal(isAgentRowActive({ active: 1 }), true);
  assert.equal(isAgentRowActive({ active: 0 }), false);
  assert.equal(isAgentRowActive(undefined), false);
});
