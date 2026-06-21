import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getDb } from "../db.js";
import {
  formatEngineTestError,
  parseAgentListQuery,
  parseAgentPayload,
  parseAgentRunListQuery,
  parsePositionPayload,
  parseRelationshipListQuery,
  relationshipWouldCreateCycle,
  validateAgentDeleteBlockers,
  validateAgentDeleteResult,
  validateRelationshipPayload,
  registerAgentRoutes,
} from "./agents.js";

const engines = new Set(["codex", "claude-code"]);

async function requestAgentRuns(agentId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/agents/${encodeURIComponent(agentId)}/runs`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestDeleteAgent(agentId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/agents/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestCreateRelationship(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/relationships`, {
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

test("parseAgentListQuery defaults and caps agent list limits", () => {
  assert.deepEqual(parseAgentListQuery({}), { limit: 1_000 });
  assert.deepEqual(parseAgentListQuery({ limit: "50" }), { limit: 50 });
  assert.deepEqual(parseAgentListQuery({ limit: "999999" }), { limit: 5_000 });
  assert.deepEqual(parseAgentListQuery({ limit: "0" }), { limit: 1_000 });
  assert.deepEqual(parseAgentListQuery({ limit: 42 }), { limit: 1_000 });
});

test("parseAgentRunListQuery defaults and caps run history limits", () => {
  assert.deepEqual(parseAgentRunListQuery({}), { limit: 200 });
  assert.deepEqual(parseAgentRunListQuery({ limit: "25" }), { limit: 25 });
  assert.deepEqual(parseAgentRunListQuery({ limit: "5000" }), { limit: 1_000 });
  assert.deepEqual(parseAgentRunListQuery({ limit: "oops" }), { limit: 200 });
});

test("parseRelationshipListQuery defaults and caps relationship list limits", () => {
  assert.deepEqual(parseRelationshipListQuery({}), { limit: 5_000 });
  assert.deepEqual(parseRelationshipListQuery({ limit: "500" }), { limit: 500 });
  assert.deepEqual(parseRelationshipListQuery({ limit: "999999" }), { limit: 10_000 });
  assert.deepEqual(parseRelationshipListQuery({ limit: "0" }), { limit: 5_000 });
  assert.deepEqual(parseRelationshipListQuery({ limit: 42 }), { limit: 5_000 });
});

test("parseAgentPayload trims names and keeps only string skills/tools", () => {
  const result = parseAgentPayload(
    {
      name: "  Claudy  ",
      role: "  Engineer  ",
      engine: "claude-code",
      skills: [" planning ", 42, "testing", " "],
      tools: ["code-exec", null, " file-system ", ""],
      connection_config: { model: "sonnet" },
    },
    engines,
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.name, "Claudy");
    assert.equal(result.payload.role, "Engineer");
    assert.equal(result.payload.engine, "claude-code");
    assert.deepEqual(result.payload.skills, ["planning", "testing"]);
    assert.deepEqual(result.payload.tools, ["code-exec", "file-system"]);
    assert.deepEqual(result.payload.connectionConfig, { model: "sonnet" });
  }
});

test("parseAgentPayload rejects blank agent names", () => {
  assert.deepEqual(parseAgentPayload({ name: " ", engine: "codex" }, engines), {
    ok: false,
    error: "Agent name is required.",
  });
});

test("parseAgentPayload rejects missing engines", () => {
  assert.deepEqual(parseAgentPayload({ name: "Boss" }, engines), {
    ok: false,
    error: "Agent engine is required.",
  });
});

test("parseAgentPayload rejects unsupported engines", () => {
  assert.deepEqual(parseAgentPayload({ name: "Boss", engine: "unknown" }, engines), {
    ok: false,
    error: "Unsupported engine: unknown",
  });
});

test("parseAgentPayload rejects oversized text fields", () => {
  assert.deepEqual(parseAgentPayload({ name: "a".repeat(121), engine: "codex" }, engines), {
    ok: false,
    error: "Agent name must be 120 characters or fewer.",
  });
  assert.deepEqual(parseAgentPayload({ name: "Boss", role: "a".repeat(241), engine: "codex" }, engines), {
    ok: false,
    error: "Agent role must be 240 characters or fewer.",
  });
  assert.deepEqual(parseAgentPayload({ name: "Boss", emoji: "a".repeat(17), engine: "codex" }, engines), {
    ok: false,
    error: "Agent emoji must be 16 characters or fewer.",
  });
  assert.deepEqual(parseAgentPayload({ name: "Boss", color: "a".repeat(65), engine: "codex" }, engines), {
    ok: false,
    error: "Agent color must be 64 characters or fewer.",
  });
  assert.deepEqual(parseAgentPayload({ name: "Boss", connection_type: "a".repeat(81), engine: "codex" }, engines), {
    ok: false,
    error: "Connection type must be 80 characters or fewer.",
  });
});

test("parseAgentPayload rejects oversized skills and tools", () => {
  assert.deepEqual(parseAgentPayload({ name: "Boss", engine: "codex", skills: Array.from({ length: 51 }, (_, index) => `skill-${index}`) }, engines), {
    ok: false,
    error: "Agent skills must include 50 or fewer entries.",
  });
  assert.deepEqual(parseAgentPayload({ name: "Boss", engine: "codex", skills: ["a".repeat(81)] }, engines), {
    ok: false,
    error: "Agent skills entries must be 80 characters or fewer.",
  });
  assert.deepEqual(parseAgentPayload({ name: "Boss", engine: "codex", tools: Array.from({ length: 51 }, (_, index) => `tool-${index}`) }, engines), {
    ok: false,
    error: "Agent tools must include 50 or fewer entries.",
  });
  assert.deepEqual(parseAgentPayload({ name: "Boss", engine: "codex", tools: ["a".repeat(81)] }, engines), {
    ok: false,
    error: "Agent tools entries must be 80 characters or fewer.",
  });
});

test("parseAgentPayload rejects oversized configuration and markdown fields", () => {
  assert.deepEqual(parseAgentPayload({ name: "Boss", engine: "codex", connection_config: { prompt: "a".repeat(20_000) } }, engines), {
    ok: false,
    error: "Connection config must be 20000 characters or fewer.",
  });
  assert.deepEqual(parseAgentPayload({ name: "Boss", engine: "codex", soul_md: "a".repeat(50_001) }, engines), {
    ok: false,
    error: "Agent instructions must be 50000 characters or fewer.",
  });
  assert.deepEqual(parseAgentPayload({ name: "Boss", engine: "codex", agents_md: "a".repeat(50_001) }, engines), {
    ok: false,
    error: "Agent collaboration instructions must be 50000 characters or fewer.",
  });
});

test("parseAgentPayload applies safe defaults", () => {
  const result = parseAgentPayload({ name: "Boss", engine: "codex" }, engines);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.emoji, "🤖");
    assert.equal(result.payload.color, "#5E4AE3");
    assert.equal(result.payload.active, 1);
    assert.deepEqual(result.payload.connectionConfig, {});
  }
});

test("validateRelationshipPayload rejects missing ids", () => {
  assert.deepEqual(
    validateRelationshipPayload({ parentId: null, childId: "child", parentExists: false, childExists: true }),
    { ok: false, status: 400, error: "parent_id and child_id are required." },
  );
});

test("validateRelationshipPayload rejects self reporting", () => {
  assert.deepEqual(
    validateRelationshipPayload({ parentId: "agent-1", childId: "agent-1", parentExists: true, childExists: true }),
    { ok: false, status: 400, error: "An agent cannot report to itself." },
  );
});

test("validateRelationshipPayload rejects unknown parent agents", () => {
  assert.deepEqual(
    validateRelationshipPayload({ parentId: "parent", childId: "child", parentExists: false, childExists: true }),
    { ok: false, status: 404, error: "Parent agent not found." },
  );
});

test("validateRelationshipPayload rejects unknown child agents", () => {
  assert.deepEqual(
    validateRelationshipPayload({ parentId: "parent", childId: "child", parentExists: true, childExists: false }),
    { ok: false, status: 404, error: "Child agent not found." },
  );
});

test("validateRelationshipPayload accepts known parent-child pairs", () => {
  assert.deepEqual(
    validateRelationshipPayload({ parentId: "parent", childId: "child", parentExists: true, childExists: true }),
    { ok: true },
  );
});

test("validateRelationshipPayload rejects inactive or unsupported relationship agents", () => {
  assert.deepEqual(
    validateRelationshipPayload({
      parentId: "parent",
      childId: "child",
      parentExists: true,
      childExists: true,
      parentActive: false,
      childActive: true,
      parentEngineSupported: true,
      childEngineSupported: true,
    }),
    { ok: false, status: 409, error: "Parent agent is inactive." },
  );
  assert.deepEqual(
    validateRelationshipPayload({
      parentId: "parent",
      childId: "child",
      parentExists: true,
      childExists: true,
      parentActive: true,
      childActive: false,
      parentEngineSupported: true,
      childEngineSupported: true,
    }),
    { ok: false, status: 409, error: "Child agent is inactive." },
  );
  assert.deepEqual(
    validateRelationshipPayload({
      parentId: "parent",
      childId: "child",
      parentExists: true,
      childExists: true,
      parentActive: true,
      childActive: true,
      parentEngineSupported: false,
      childEngineSupported: true,
    }),
    { ok: false, status: 409, error: "Parent agent engine is not supported." },
  );
  assert.deepEqual(
    validateRelationshipPayload({
      parentId: "parent",
      childId: "child",
      parentExists: true,
      childExists: true,
      parentActive: true,
      childActive: true,
      parentEngineSupported: true,
      childEngineSupported: false,
    }),
    { ok: false, status: 409, error: "Child agent engine is not supported." },
  );
});

test("validateRelationshipPayload rejects duplicates", () => {
  assert.deepEqual(
    validateRelationshipPayload({ parentId: "parent", childId: "child", parentExists: true, childExists: true, relationshipExists: true }),
    { ok: false, status: 409, error: "Relationship already exists." },
  );
});

test("validateRelationshipPayload rejects reporting cycles", () => {
  assert.deepEqual(
    validateRelationshipPayload({ parentId: "parent", childId: "child", parentExists: true, childExists: true, createsCycle: true }),
    { ok: false, status: 409, error: "Relationship would create a reporting cycle." },
  );
});

test("relationshipWouldCreateCycle detects direct and indirect cycles", () => {
  const relationships = [
    { parent_id: "lead", child_id: "manager" },
    { parent_id: "manager", child_id: "engineer" },
  ];

  assert.equal(relationshipWouldCreateCycle("engineer", "lead", relationships), true);
  assert.equal(relationshipWouldCreateCycle("engineer", "manager", relationships), true);
  assert.equal(relationshipWouldCreateCycle("lead", "engineer", relationships), false);
});

test("relationship creation rejects cycles", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agent_relationships WHERE parent_id LIKE 'cycle-%' OR child_id LIKE 'cycle-%'").run();
  db.prepare("DELETE FROM agents WHERE id IN ('cycle-parent-agent', 'cycle-child-agent')").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES
      ('cycle-parent-agent', 'Cycle Parent', 'Lead', 'codex', '[]', '[]', 1),
      ('cycle-child-agent', 'Cycle Child', 'Engineer', 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO agent_relationships (id, parent_id, child_id)
    VALUES ('cycle-existing-relationship', 'cycle-parent-agent', 'cycle-child-agent')
    `,
  ).run();

  try {
    const response = await requestCreateRelationship({
      parent_id: "cycle-child-agent",
      child_id: "cycle-parent-agent",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Relationship would create a reporting cycle." });
  } finally {
    db.prepare("DELETE FROM agent_relationships WHERE parent_id LIKE 'cycle-%' OR child_id LIKE 'cycle-%'").run();
    db.prepare("DELETE FROM agents WHERE id IN ('cycle-parent-agent', 'cycle-child-agent')").run();
  }
});

test("relationship creation rejects inactive child agents", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agent_relationships WHERE parent_id LIKE 'inactive-rel-%' OR child_id LIKE 'inactive-rel-%'").run();
  db.prepare("DELETE FROM agents WHERE id IN ('inactive-rel-parent-agent', 'inactive-rel-child-agent')").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES
      ('inactive-rel-parent-agent', 'Relationship Parent', 'Lead', 'codex', '[]', '[]', 1),
      ('inactive-rel-child-agent', 'Relationship Child', 'Engineer', 'codex', '[]', '[]', 0)
    `,
  ).run();

  try {
    const response = await requestCreateRelationship({
      parent_id: "inactive-rel-parent-agent",
      child_id: "inactive-rel-child-agent",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Child agent is inactive." });
    assert.equal(db.prepare("SELECT 1 FROM agent_relationships WHERE child_id = 'inactive-rel-child-agent'").get(), undefined);
  } finally {
    db.prepare("DELETE FROM agent_relationships WHERE parent_id LIKE 'inactive-rel-%' OR child_id LIKE 'inactive-rel-%'").run();
    db.prepare("DELETE FROM agents WHERE id IN ('inactive-rel-parent-agent', 'inactive-rel-child-agent')").run();
  }
});

test("relationship creation rejects unsupported parent engines", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agent_relationships WHERE parent_id LIKE 'unsupported-rel-%' OR child_id LIKE 'unsupported-rel-%'").run();
  db.prepare("DELETE FROM agents WHERE id IN ('unsupported-rel-parent-agent', 'unsupported-rel-child-agent')").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES
      ('unsupported-rel-parent-agent', 'Relationship Parent', 'Lead', 'legacy-engine', '[]', '[]', 1),
      ('unsupported-rel-child-agent', 'Relationship Child', 'Engineer', 'codex', '[]', '[]', 1)
    `,
  ).run();

  try {
    const response = await requestCreateRelationship({
      parent_id: "unsupported-rel-parent-agent",
      child_id: "unsupported-rel-child-agent",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Parent agent engine is not supported." });
    assert.equal(db.prepare("SELECT 1 FROM agent_relationships WHERE parent_id = 'unsupported-rel-parent-agent'").get(), undefined);
  } finally {
    db.prepare("DELETE FROM agent_relationships WHERE parent_id LIKE 'unsupported-rel-%' OR child_id LIKE 'unsupported-rel-%'").run();
    db.prepare("DELETE FROM agents WHERE id IN ('unsupported-rel-parent-agent', 'unsupported-rel-child-agent')").run();
  }
});

test("parsePositionPayload accepts finite coordinates for known agents", () => {
  assert.deepEqual(
    parsePositionPayload([{ agent_id: "agent-1", x: 12.5, y: -4 }], new Set(["agent-1"])),
    { ok: true, positions: [{ agent_id: "agent-1", x: 12.5, y: -4 }] },
  );
});

test("parsePositionPayload rejects non-object entries", () => {
  assert.deepEqual(parsePositionPayload([null], new Set(["agent-1"])), {
    ok: false,
    status: 400,
    error: "Position 1 must be an object.",
  });
});

test("parsePositionPayload rejects missing agent ids", () => {
  assert.deepEqual(parsePositionPayload([{ x: 0, y: 0 }], new Set(["agent-1"])), {
    ok: false,
    status: 400,
    error: "Position 1 requires agent_id.",
  });
});

test("parsePositionPayload rejects unknown agents", () => {
  assert.deepEqual(parsePositionPayload([{ agent_id: "agent-2", x: 0, y: 0 }], new Set(["agent-1"])), {
    ok: false,
    status: 404,
    error: "Agent not found for position 1.",
  });
});

test("parsePositionPayload rejects duplicate agent ids", () => {
  assert.deepEqual(
    parsePositionPayload(
      [
        { agent_id: "agent-1", x: 0, y: 0 },
        { agent_id: "agent-1", x: 1, y: 1 },
      ],
      new Set(["agent-1"]),
    ),
    {
      ok: false,
      status: 400,
      error: "Position 2 duplicates agent_id agent-1.",
    },
  );
});

test("parsePositionPayload rejects oversized position batches", () => {
  assert.deepEqual(parsePositionPayload(Array.from({ length: 5_001 }, () => ({ agent_id: "agent-1", x: 0, y: 0 })), new Set(["agent-1"])), {
    ok: false,
    status: 413,
    error: "Positions payload must include 5000 or fewer entries.",
  });
});

test("parsePositionPayload rejects non-finite coordinates", () => {
  assert.deepEqual(parsePositionPayload([{ agent_id: "agent-1", x: Number.NaN, y: 0 }], new Set(["agent-1"])), {
    ok: false,
    status: 400,
    error: "Position 1 requires finite x and y coordinates.",
  });
});

test("validateAgentDeleteResult rejects missing agents", () => {
  assert.deepEqual(validateAgentDeleteResult(0), {
    ok: false,
    status: 404,
    error: "Agent not found.",
  });
});

test("validateAgentDeleteResult accepts deleted agents", () => {
  assert.deepEqual(validateAgentDeleteResult(1), { ok: true });
});

test("validateAgentDeleteBlockers rejects agents linked to work", () => {
  assert.deepEqual(
    validateAgentDeleteBlockers({
      leadMissionCount: 1,
      assignedMissionCount: 0,
      assignedIssueCount: 0,
      runCount: 0,
      messageCount: 0,
      scheduleCount: 0,
    }),
    {
      ok: false,
      status: 409,
      error: "Cannot delete this agent while it is linked to missions, issues, runs, messages, or schedules. Reassign or remove the linked work first.",
    },
  );
  assert.deepEqual(
    validateAgentDeleteBlockers({
      leadMissionCount: 0,
      assignedMissionCount: 1,
      assignedIssueCount: 0,
      runCount: 0,
      messageCount: 0,
      scheduleCount: 0,
    }),
    {
      ok: false,
      status: 409,
      error: "Cannot delete this agent while it is linked to missions, issues, runs, messages, or schedules. Reassign or remove the linked work first.",
    },
  );
  assert.deepEqual(
    validateAgentDeleteBlockers({
      leadMissionCount: 0,
      assignedMissionCount: 0,
      assignedIssueCount: 0,
      runCount: 2,
      messageCount: 0,
      scheduleCount: 0,
    }),
    {
      ok: false,
      status: 409,
      error: "Cannot delete this agent while it is linked to missions, issues, runs, messages, or schedules. Reassign or remove the linked work first.",
    },
  );
  assert.deepEqual(
    validateAgentDeleteBlockers({
      leadMissionCount: 0,
      assignedMissionCount: 0,
      assignedIssueCount: 0,
      runCount: 0,
      messageCount: 0,
      scheduleCount: 1,
    }),
    {
      ok: false,
      status: 409,
      error: "Cannot delete this agent while it is linked to missions, issues, runs, messages, or schedules. Reassign or remove the linked work first.",
    },
  );
});

test("validateAgentDeleteBlockers accepts unlinked agents", () => {
  assert.deepEqual(
    validateAgentDeleteBlockers({
      leadMissionCount: 0,
      assignedMissionCount: 0,
      assignedIssueCount: 0,
      runCount: 0,
      messageCount: 0,
      scheduleCount: 0,
    }),
    { ok: true },
  );
});

test("agent deletion rejects mission-assigned agents", async () => {
  const db = getDb();
  db.prepare("DELETE FROM mission_agents WHERE agent_id = 'agent-assigned-delete-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'agent-assigned-delete-mission-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'agent-assigned-delete-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('agent-assigned-delete-test', 'Assigned Agent', 'Contributor', 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, description, status, team_name)
    VALUES ('agent-assigned-delete-mission-test', 'Assigned Mission', NULL, 'planning', 'Marketing')
    `,
  ).run();
  db.prepare("INSERT INTO mission_agents (mission_id, agent_id) VALUES ('agent-assigned-delete-mission-test', 'agent-assigned-delete-test')").run();

  try {
    const response = await requestDeleteAgent("agent-assigned-delete-test");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: "Cannot delete this agent while it is linked to missions, issues, runs, messages, or schedules. Reassign or remove the linked work first.",
    });
    assert.ok(db.prepare("SELECT 1 FROM mission_agents WHERE agent_id = 'agent-assigned-delete-test'").get());
  } finally {
    db.prepare("DELETE FROM mission_agents WHERE agent_id = 'agent-assigned-delete-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'agent-assigned-delete-mission-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'agent-assigned-delete-test'").run();
  }
});

test("agent deletion rejects scheduled agents", async () => {
  const db = getDb();
  db.prepare("DELETE FROM schedules WHERE id = 'agent-schedule-delete-schedule-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'agent-schedule-delete-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('agent-schedule-delete-test', 'Scheduled Agent', 'Operator', 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, agent_id, prompt, cron_expression, enabled, max_runs)
    VALUES ('agent-schedule-delete-schedule-test', 'Daily check', 'agent-schedule-delete-test', 'Check pipeline', '0 9 * * *', 1, NULL)
    `,
  ).run();

  try {
    const response = await requestDeleteAgent("agent-schedule-delete-test");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: "Cannot delete this agent while it is linked to missions, issues, runs, messages, or schedules. Reassign or remove the linked work first.",
    });
    assert.ok(db.prepare("SELECT 1 FROM schedules WHERE id = 'agent-schedule-delete-schedule-test'").get());
  } finally {
    db.prepare("DELETE FROM schedules WHERE id = 'agent-schedule-delete-schedule-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'agent-schedule-delete-test'").run();
  }
});

test("formatEngineTestError preserves provider messages and falls back for unknown errors", () => {
  assert.equal(formatEngineTestError(new Error("API key is missing.")), "API key is missing.");
  assert.equal(formatEngineTestError("failed"), "Engine connection test failed.");
});

test("agent run history returns 404 for missing parent agents", async () => {
  const response = await requestAgentRuns("missing-agent-runs-test");

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "Agent not found." });
});

test("agent run history returns an empty list for existing agents with no runs", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agents WHERE id = 'agent-runs-empty-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('agent-runs-empty-test', 'Runs Agent', 'Tester', 'codex', '[]', '[]', 1)
    `,
  ).run();

  try {
    const response = await requestAgentRuns("agent-runs-empty-test");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { runs: [] });
  } finally {
    db.prepare("DELETE FROM agents WHERE id = 'agent-runs-empty-test'").run();
  }
});
