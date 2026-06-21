import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getDb } from "../db.js";
import {
  isRunStreamLiveStatus,
  parseAgentMessageListQuery,
  parseRunListQuery,
  parseAgentMessagePayload,
  parseRunPayload,
  validateAgentMessageReferences,
  validateRunDeleteStatus,
  validateRunReferences,
  registerRunRoutes,
} from "./runs.js";

async function requestAgentMessages(query?: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerRunRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const suffix = query ? `?${query}` : "";
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/agent-messages${suffix}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestCreateAgentMessage(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerRunRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/agent-messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestCreateRun(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerRunRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestDeleteRun(runId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerRunRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/runs/${encodeURIComponent(runId)}`, {
      method: "DELETE",
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("parseRunPayload trims run fields", () => {
  assert.deepEqual(
    parseRunPayload({
      agent_id: "  agent-1  ",
      prompt: "  Ship the release  ",
      mission_id: "  mission-1  ",
      issue_id: "  issue-1  ",
    }),
    {
      ok: true,
      payload: {
        agentId: "agent-1",
        prompt: "Ship the release",
        missionId: "mission-1",
        issueId: "issue-1",
      },
    },
  );
});

test("parseRunPayload rejects missing agent or prompt", () => {
  assert.deepEqual(parseRunPayload({ agent_id: "agent-1", prompt: " " }), {
    ok: false,
    error: "agent_id and prompt are required.",
  });
});

test("parseRunPayload rejects oversized prompts", () => {
  assert.deepEqual(parseRunPayload({ agent_id: "agent-1", prompt: "a".repeat(20_001) }), {
    ok: false,
    error: "Prompt must be 20000 characters or fewer.",
  });
});

test("validateRunReferences rejects unknown agents", () => {
  assert.deepEqual(
    validateRunReferences({
      agentId: "agent-1",
      missionId: null,
      issueId: null,
      issueMissionId: null,
      agentExists: false,
      agentActive: false,
      agentEngineSupported: true,
      missionExists: false,
      issueExists: false,
    }),
    { ok: false, status: 404, error: "Agent not found." },
  );
});

test("validateRunReferences rejects inactive agents", () => {
  assert.deepEqual(
    validateRunReferences({
      agentId: "agent-1",
      missionId: null,
      issueId: null,
      issueMissionId: null,
      agentExists: true,
      agentActive: false,
      agentEngineSupported: true,
      missionExists: false,
      issueExists: false,
    }),
    { ok: false, status: 409, error: "Agent is inactive." },
  );
});

test("validateRunReferences rejects agents with unsupported engines", () => {
  assert.deepEqual(
    validateRunReferences({
      agentId: "agent-1",
      missionId: null,
      issueId: null,
      issueMissionId: null,
      agentExists: true,
      agentActive: true,
      agentEngineSupported: false,
      missionExists: false,
      issueExists: false,
    }),
    { ok: false, status: 409, error: "Agent engine is not supported." },
  );
});

test("validateRunReferences rejects unknown missions", () => {
  assert.deepEqual(
    validateRunReferences({
      agentId: "agent-1",
      missionId: "mission-1",
      issueId: null,
      issueMissionId: null,
      agentExists: true,
      agentActive: true,
      agentEngineSupported: true,
      missionExists: false,
      issueExists: false,
    }),
    { ok: false, status: 404, error: "Mission not found." },
  );
});

test("validateRunReferences rejects unknown issues", () => {
  assert.deepEqual(
    validateRunReferences({
      agentId: "agent-1",
      missionId: null,
      issueId: "issue-1",
      issueMissionId: null,
      agentExists: true,
      agentActive: true,
      agentEngineSupported: true,
      missionExists: false,
      issueExists: false,
    }),
    { ok: false, status: 404, error: "Issue not found." },
  );
});

test("validateRunReferences accepts known references", () => {
  assert.deepEqual(
    validateRunReferences({
      agentId: "agent-1",
      missionId: "mission-1",
      issueId: "issue-1",
      issueMissionId: "mission-1",
      agentExists: true,
      agentActive: true,
      agentEngineSupported: true,
      missionExists: true,
      issueExists: true,
    }),
    { ok: true },
  );
});

test("validateRunReferences rejects issue and mission mismatches", () => {
  assert.deepEqual(
    validateRunReferences({
      agentId: "agent-1",
      missionId: "mission-1",
      issueId: "issue-1",
      issueMissionId: "mission-2",
      agentExists: true,
      agentActive: true,
      agentEngineSupported: true,
      missionExists: true,
      issueExists: true,
    }),
    { ok: false, status: 409, error: "Issue does not belong to mission." },
  );
});

test("run creation inherits mission from issue references", async () => {
  const db = getDb();
  db.prepare("DELETE FROM runs WHERE id LIKE 'run_%' AND issue_id = 'run-inherit-issue-test'").run();
  db.prepare("DELETE FROM issues WHERE id = 'run-inherit-issue-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'run-inherit-mission-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'run-inherit-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('run-inherit-agent-test', 'Run Agent', NULL, 'openclaw', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, description, status, team_name)
    VALUES ('run-inherit-mission-test', 'Inherited Mission', NULL, 'planning', 'Engineering')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO issues (id, issue_number, title, status, priority, mission_id, labels)
    VALUES ('run-inherit-issue-test', 91001, 'Inherited issue', 'todo', 'medium', 'run-inherit-mission-test', '[]')
    `,
  ).run();
  db.prepare("INSERT INTO mission_agents (mission_id, agent_id) VALUES ('run-inherit-mission-test', 'run-inherit-agent-test')").run();

  try {
    const response = await requestCreateRun({
      agent_id: "run-inherit-agent-test",
      issue_id: "run-inherit-issue-test",
      prompt: "Resolve the inherited issue",
    });

    assert.equal(response.status, 201);
    const body = response.body as { run: { id: string; mission_id: string | null; issue_id: string | null } };
    assert.equal(body.run.issue_id, "run-inherit-issue-test");
    assert.equal(body.run.mission_id, "run-inherit-mission-test");
  } finally {
    db.prepare("DELETE FROM runs WHERE issue_id = 'run-inherit-issue-test'").run();
    db.prepare("DELETE FROM issues WHERE id = 'run-inherit-issue-test'").run();
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'run-inherit-mission-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'run-inherit-mission-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'run-inherit-agent-test'").run();
  }
});

test("run creation rejects mission agents that are not staffed on the mission", async () => {
  const db = getDb();
  db.prepare("DELETE FROM runs WHERE agent_id = 'run-unstaffed-agent-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'run-unstaffed-mission-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'run-unstaffed-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('run-unstaffed-agent-test', 'Unstaffed Run Agent', NULL, 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, description, status, team_name)
    VALUES ('run-unstaffed-mission-test', 'Unstaffed Mission', NULL, 'planning', 'Finance')
    `,
  ).run();

  try {
    const response = await requestCreateRun({
      agent_id: "run-unstaffed-agent-test",
      mission_id: "run-unstaffed-mission-test",
      prompt: "Run mission work",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Agent is not assigned to this mission." });
  } finally {
    db.prepare("DELETE FROM runs WHERE agent_id = 'run-unstaffed-agent-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'run-unstaffed-mission-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'run-unstaffed-agent-test'").run();
  }
});

test("run creation returns a controlled conflict for legacy unsupported agent engines", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agents WHERE id = 'run-unsupported-engine-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('run-unsupported-engine-agent-test', 'Legacy agent', NULL, 'legacy-engine', '[]', '[]', 1)
    `,
  ).run();

  try {
    const response = await requestCreateRun({
      agent_id: "run-unsupported-engine-agent-test",
      prompt: "Plan the launch.",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Agent engine is not supported." });
  } finally {
    db.prepare("DELETE FROM agents WHERE id = 'run-unsupported-engine-agent-test'").run();
  }
});

test("parseRunListQuery trims and limits run filters", () => {
  assert.deepEqual(
    parseRunListQuery({
      agent_id: "  agent-1  ",
      mission_id: "m".repeat(150),
      issue_id: "",
      parent_run_id: "  parent-1  ",
      status: "complete",
      q: "deploy",
    }),
    {
      agentId: "agent-1",
      missionId: "m".repeat(120),
      issueId: undefined,
      parentRunId: "parent-1",
      status: "complete",
      q: "deploy",
    },
  );
});

test("parseRunListQuery ignores unsupported status filters", () => {
  assert.equal(parseRunListQuery({ status: "deleted" }).status, undefined);
  assert.equal(parseRunListQuery({ status: "running" }).status, "running");
});

test("isRunStreamLiveStatus keeps only active run streams subscribed", () => {
  assert.equal(isRunStreamLiveStatus("running"), true);
  assert.equal(isRunStreamLiveStatus("planning"), true);
  assert.equal(isRunStreamLiveStatus("complete"), false);
  assert.equal(isRunStreamLiveStatus("failed"), false);
});

test("validateRunDeleteStatus rejects active runs", () => {
  assert.deepEqual(validateRunDeleteStatus("running"), {
    ok: false,
    status: 409,
    error: "Cannot delete an active run. Wait for it to finish before deleting it.",
  });
  assert.deepEqual(validateRunDeleteStatus("planning"), {
    ok: false,
    status: 409,
    error: "Cannot delete an active run. Wait for it to finish before deleting it.",
  });
  assert.deepEqual(validateRunDeleteStatus("complete"), { ok: true });
  assert.deepEqual(validateRunDeleteStatus("failed"), { ok: true });
});

test("run deletion rejects active runs", async () => {
  const db = getDb();
  db.prepare("DELETE FROM runs WHERE id = 'run-active-delete-test'").run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, engine, status, prompt, output, tool_calls)
    VALUES ('run-active-delete-test', NULL, NULL, NULL, 'codex', 'running', 'Do work', '', '[]')
    `,
  ).run();

  try {
    const response = await requestDeleteRun("run-active-delete-test");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: "Cannot delete an active run. Wait for it to finish before deleting it.",
    });
    assert.ok(db.prepare("SELECT 1 FROM runs WHERE id = 'run-active-delete-test'").get());
  } finally {
    db.prepare("DELETE FROM runs WHERE id = 'run-active-delete-test'").run();
  }
});

test("run deletion preserves child run history and removes deleted run messages", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agent_messages WHERE run_id IN ('run-delete-parent-test', 'run-delete-child-test')").run();
  db.prepare("DELETE FROM runs WHERE id IN ('run-delete-child-test', 'run-delete-parent-test')").run();
  db.prepare("DELETE FROM agents WHERE id IN ('run-delete-sender-test', 'run-delete-recipient-test')").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine)
    VALUES
      ('run-delete-sender-test', 'Sender', 'Coordinator', 'codex'),
      ('run-delete-recipient-test', 'Recipient', 'Specialist', 'codex')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, engine, status, prompt, output, tool_calls)
    VALUES ('run-delete-parent-test', NULL, NULL, NULL, 'codex', 'complete', 'Parent work', '', '[]')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, engine, status, prompt, output, tool_calls, parent_run_id)
    VALUES ('run-delete-child-test', NULL, NULL, NULL, 'codex', 'complete', 'Child work', '', '[]', 'run-delete-parent-test')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO agent_messages (id, from_agent_id, to_agent_id, run_id, message)
    VALUES
      ('run-delete-parent-message-test', 'run-delete-sender-test', 'run-delete-recipient-test', 'run-delete-parent-test', 'Parent message'),
      ('run-delete-child-message-test', 'run-delete-sender-test', 'run-delete-recipient-test', 'run-delete-child-test', 'Child message')
    `,
  ).run();

  try {
    const response = await requestDeleteRun("run-delete-parent-test");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM runs WHERE id = 'run-delete-parent-test'").get() as { count: number }).count,
      0,
    );
    assert.deepEqual(db.prepare("SELECT parent_run_id FROM runs WHERE id = 'run-delete-child-test'").get(), {
      parent_run_id: null,
    });
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM agent_messages WHERE id = 'run-delete-parent-message-test'").get() as { count: number }).count,
      0,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM agent_messages WHERE id = 'run-delete-child-message-test'").get() as { count: number }).count,
      1,
    );
  } finally {
    db.prepare("DELETE FROM agent_messages WHERE run_id IN ('run-delete-parent-test', 'run-delete-child-test')").run();
    db.prepare("DELETE FROM runs WHERE id IN ('run-delete-child-test', 'run-delete-parent-test')").run();
    db.prepare("DELETE FROM agents WHERE id IN ('run-delete-sender-test', 'run-delete-recipient-test')").run();
  }
});

test("parseAgentMessageListQuery trims and limits mission filters", () => {
  assert.deepEqual(parseAgentMessageListQuery({ mission_id: "  mission-1  " }), {
    missionId: "mission-1",
  });
  assert.deepEqual(parseAgentMessageListQuery({ mission_id: "m".repeat(150) }), {
    missionId: "m".repeat(120),
  });
  assert.deepEqual(parseAgentMessageListQuery({ mission_id: " " }), {
    missionId: undefined,
  });
});

test("parseAgentMessagePayload trims message fields", () => {
  assert.deepEqual(
    parseAgentMessagePayload({
      from_agent_id: "  sender  ",
      to_agent_id: "  recipient  ",
      mission_id: "  mission-1  ",
      run_id: "  run-1  ",
      message: "  Please review  ",
    }),
    {
      ok: true,
      payload: {
        fromAgentId: "sender",
        toAgentId: "recipient",
        missionId: "mission-1",
        runId: "run-1",
        message: "Please review",
      },
    },
  );
});

test("parseAgentMessagePayload rejects missing sender, recipient, or message", () => {
  assert.deepEqual(parseAgentMessagePayload({ from_agent_id: "sender", to_agent_id: "recipient", message: " " }), {
    ok: false,
    error: "from_agent_id, to_agent_id and message are required.",
  });
});

test("parseAgentMessagePayload rejects oversized messages", () => {
  assert.deepEqual(
    parseAgentMessagePayload({
      from_agent_id: "sender",
      to_agent_id: "recipient",
      message: "a".repeat(5_001),
    }),
    { ok: false, error: "Message must be 5000 characters or fewer." },
  );
});

test("validateAgentMessageReferences rejects unknown sender agents", () => {
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: null,
      runId: null,
      runMissionId: null,
      fromAgentExists: false,
      fromAgentActive: false,
      fromAgentEngineSupported: false,
      toAgentExists: true,
      toAgentActive: true,
      toAgentEngineSupported: true,
      missionExists: false,
      runExists: false,
    }),
    { ok: false, status: 404, error: "Sender agent not found." },
  );
});

test("validateAgentMessageReferences rejects unknown recipient agents", () => {
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: null,
      runId: null,
      runMissionId: null,
      fromAgentExists: true,
      fromAgentActive: true,
      fromAgentEngineSupported: true,
      toAgentExists: false,
      toAgentActive: false,
      toAgentEngineSupported: false,
      missionExists: false,
      runExists: false,
    }),
    { ok: false, status: 404, error: "Recipient agent not found." },
  );
});

test("validateAgentMessageReferences rejects inactive or unsupported message participants", () => {
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: null,
      runId: null,
      runMissionId: null,
      fromAgentExists: true,
      fromAgentActive: false,
      fromAgentEngineSupported: true,
      toAgentExists: true,
      toAgentActive: true,
      toAgentEngineSupported: true,
      missionExists: false,
      runExists: false,
    }),
    { ok: false, status: 409, error: "Sender agent is inactive." },
  );
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: null,
      runId: null,
      runMissionId: null,
      fromAgentExists: true,
      fromAgentActive: true,
      fromAgentEngineSupported: false,
      toAgentExists: true,
      toAgentActive: true,
      toAgentEngineSupported: true,
      missionExists: false,
      runExists: false,
    }),
    { ok: false, status: 409, error: "Sender agent engine is not supported." },
  );
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: null,
      runId: null,
      runMissionId: null,
      fromAgentExists: true,
      fromAgentActive: true,
      fromAgentEngineSupported: true,
      toAgentExists: true,
      toAgentActive: false,
      toAgentEngineSupported: true,
      missionExists: false,
      runExists: false,
    }),
    { ok: false, status: 409, error: "Recipient agent is inactive." },
  );
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: null,
      runId: null,
      runMissionId: null,
      fromAgentExists: true,
      fromAgentActive: true,
      fromAgentEngineSupported: true,
      toAgentExists: true,
      toAgentActive: true,
      toAgentEngineSupported: false,
      missionExists: false,
      runExists: false,
    }),
    { ok: false, status: 409, error: "Recipient agent engine is not supported." },
  );
});

test("validateAgentMessageReferences rejects unknown mission or run links", () => {
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: "mission-1",
      runId: null,
      runMissionId: null,
      fromAgentExists: true,
      fromAgentActive: true,
      fromAgentEngineSupported: true,
      toAgentExists: true,
      toAgentActive: true,
      toAgentEngineSupported: true,
      missionExists: false,
      runExists: false,
    }),
    { ok: false, status: 404, error: "Mission not found." },
  );
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: null,
      runId: "run-1",
      runMissionId: null,
      fromAgentExists: true,
      fromAgentActive: true,
      fromAgentEngineSupported: true,
      toAgentExists: true,
      toAgentActive: true,
      toAgentEngineSupported: true,
      missionExists: false,
      runExists: false,
    }),
    { ok: false, status: 404, error: "Run not found." },
  );
});

test("validateAgentMessageReferences accepts known references", () => {
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: "mission-1",
      runId: "run-1",
      runMissionId: "mission-1",
      fromAgentExists: true,
      fromAgentActive: true,
      fromAgentEngineSupported: true,
      toAgentExists: true,
      toAgentActive: true,
      toAgentEngineSupported: true,
      missionExists: true,
      runExists: true,
    }),
    { ok: true },
  );
});

test("validateAgentMessageReferences rejects run and mission mismatches", () => {
  assert.deepEqual(
    validateAgentMessageReferences({
      fromAgentId: "sender",
      toAgentId: "recipient",
      missionId: "mission-1",
      runId: "run-1",
      runMissionId: "mission-2",
      fromAgentExists: true,
      fromAgentActive: true,
      fromAgentEngineSupported: true,
      toAgentExists: true,
      toAgentActive: true,
      toAgentEngineSupported: true,
      missionExists: true,
      runExists: true,
    }),
    { ok: false, status: 409, error: "Run does not belong to mission." },
  );
});

test("agent message creation inherits mission from run references", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agent_messages WHERE run_id = 'message-inherit-run-test'").run();
  db.prepare("DELETE FROM runs WHERE id = 'message-inherit-run-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'message-inherit-mission-test'").run();
  db.prepare("DELETE FROM agents WHERE id IN ('message-inherit-sender-test', 'message-inherit-recipient-test')").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine)
    VALUES
      ('message-inherit-sender-test', 'Sender', 'Coordinator', 'codex'),
      ('message-inherit-recipient-test', 'Recipient', 'Specialist', 'codex')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('message-inherit-mission-test', 'Message inherit mission', 'planning', 'Engineering')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, engine, status, prompt, output, tool_calls)
    VALUES ('message-inherit-run-test', 'message-inherit-sender-test', 'message-inherit-mission-test', NULL, 'codex', 'complete', 'Do work', '', '[]')
    `,
  ).run();

  try {
    const createResponse = await requestCreateAgentMessage({
      from_agent_id: "message-inherit-sender-test",
      to_agent_id: "message-inherit-recipient-test",
      run_id: "message-inherit-run-test",
      message: "Review the completed work.",
    });

    assert.equal(createResponse.status, 201);
    const createBody = createResponse.body as { agent_message: { mission_id: string | null; run_id: string | null } };
    assert.equal(createBody.agent_message.mission_id, "message-inherit-mission-test");
    assert.equal(createBody.agent_message.run_id, "message-inherit-run-test");

    const listResponse = await requestAgentMessages("mission_id=message-inherit-mission-test");
    assert.equal(listResponse.status, 200);
    const listBody = listResponse.body as { messages: Array<{ mission_id: string | null; run_id: string | null }> };
    assert.equal(listBody.messages.length, 1);
    assert.equal(listBody.messages[0]?.mission_id, "message-inherit-mission-test");
    assert.equal(listBody.messages[0]?.run_id, "message-inherit-run-test");
  } finally {
    db.prepare("DELETE FROM agent_messages WHERE run_id = 'message-inherit-run-test'").run();
    db.prepare("DELETE FROM runs WHERE id = 'message-inherit-run-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'message-inherit-mission-test'").run();
    db.prepare("DELETE FROM agents WHERE id IN ('message-inherit-sender-test', 'message-inherit-recipient-test')").run();
  }
});

test("agent message creation rejects inactive recipients", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agents WHERE id IN ('message-active-sender-test', 'message-inactive-recipient-test')").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, active)
    VALUES
      ('message-active-sender-test', 'Sender', 'Coordinator', 'codex', 1),
      ('message-inactive-recipient-test', 'Inactive recipient', 'Specialist', 'codex', 0)
    `,
  ).run();

  try {
    const response = await requestCreateAgentMessage({
      from_agent_id: "message-active-sender-test",
      to_agent_id: "message-inactive-recipient-test",
      message: "Can you review this?",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Recipient agent is inactive." });
  } finally {
    db.prepare("DELETE FROM agent_messages WHERE from_agent_id = 'message-active-sender-test' OR to_agent_id = 'message-inactive-recipient-test'").run();
    db.prepare("DELETE FROM agents WHERE id IN ('message-active-sender-test', 'message-inactive-recipient-test')").run();
  }
});

test("agent message creation rejects unsupported sender engines", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agents WHERE id IN ('message-unsupported-sender-test', 'message-supported-recipient-test')").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, active)
    VALUES
      ('message-unsupported-sender-test', 'Legacy sender', 'Coordinator', 'legacy-engine', 1),
      ('message-supported-recipient-test', 'Recipient', 'Specialist', 'codex', 1)
    `,
  ).run();

  try {
    const response = await requestCreateAgentMessage({
      from_agent_id: "message-unsupported-sender-test",
      to_agent_id: "message-supported-recipient-test",
      message: "Can you review this?",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Sender agent engine is not supported." });
  } finally {
    db.prepare("DELETE FROM agent_messages WHERE from_agent_id = 'message-unsupported-sender-test' OR to_agent_id = 'message-supported-recipient-test'").run();
    db.prepare("DELETE FROM agents WHERE id IN ('message-unsupported-sender-test', 'message-supported-recipient-test')").run();
  }
});

test("agent message list returns 404 for missing mission filters", async () => {
  const response = await requestAgentMessages("mission_id=missing-message-mission-test");

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "Mission not found." });
});

test("agent message list returns an empty list for active when no active mission exists", async () => {
  const db = getDb();
  db.prepare("UPDATE missions SET status = 'planning' WHERE status = 'active'").run();

  const response = await requestAgentMessages("mission_id=active");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { messages: [] });
});

test("agent message list returns an empty list for existing missions with no messages", async () => {
  const db = getDb();
  db.prepare("DELETE FROM missions WHERE id = 'message-empty-mission-test'").run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('message-empty-mission-test', 'Message empty mission', 'planning', 'Engineering')
    `,
  ).run();

  try {
    const response = await requestAgentMessages("mission_id=message-empty-mission-test");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { messages: [] });
  } finally {
    db.prepare("DELETE FROM missions WHERE id = 'message-empty-mission-test'").run();
  }
});
