import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getDb } from "../db.js";
import {
  parseMissionListQuery,
  parseMissionPayload,
  registerMissionRoutes,
  validateMissionAgentAssignment,
  validateMissionAgentRemoval,
  validateMissionDeleteBlockers,
  validateMissionDeleteResult,
  validateMissionCompletion,
  validateMissionReferences,
  validateMissionStartLead,
  validateMissionStartStatus,
} from "./missions.js";

async function requestStartMission(missionId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerMissionRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/missions/${missionId}/start`, {
      method: "POST",
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestDeleteMission(missionId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerMissionRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/missions/${missionId}`, {
      method: "DELETE",
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestUpdateMission(missionId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerMissionRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/missions/${encodeURIComponent(missionId)}`, {
      method: "PUT",
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

async function requestAssignMissionAgent(missionId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerMissionRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/missions/${encodeURIComponent(missionId)}/agents`, {
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

async function requestRemoveMissionAgent(missionId: string, agentId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerMissionRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(
      `http://127.0.0.1:${(address as AddressInfo).port}/api/missions/${encodeURIComponent(missionId)}/agents/${encodeURIComponent(agentId)}`,
      {
        method: "DELETE",
      },
    );
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("parseMissionListQuery trims and limits team filters", () => {
  assert.deepEqual(parseMissionListQuery({ team_name: "  Finance  " }), { teamName: "Finance", limit: 500 });
  assert.deepEqual(parseMissionListQuery({ team_name: "a".repeat(90) }), { teamName: "a".repeat(80), limit: 500 });
  assert.deepEqual(parseMissionListQuery({ team_name: " " }), { teamName: undefined, limit: 500 });
  assert.deepEqual(parseMissionListQuery({ team_name: 42 }), { teamName: undefined, limit: 500 });
});

test("parseMissionListQuery defaults and caps mission list limits", () => {
  assert.deepEqual(parseMissionListQuery({}), { teamName: undefined, limit: 500 });
  assert.deepEqual(parseMissionListQuery({ limit: "50" }), { teamName: undefined, limit: 50 });
  assert.deepEqual(parseMissionListQuery({ limit: "5000" }), { teamName: undefined, limit: 2_000 });
  assert.deepEqual(parseMissionListQuery({ limit: "0" }), { teamName: undefined, limit: 500 });
  assert.deepEqual(parseMissionListQuery({ limit: 42 }), { teamName: undefined, limit: 500 });
});

test("parseMissionPayload trims mission fields and defaults branch/status", () => {
  const result = parseMissionPayload(
    {
      title: "  Finance close  ",
      description: "  Monthly reporting  ",
      lead_agent_id: "  agent-1  ",
      team_name: "  Finance  ",
      github_default_branch: "",
    },
    { requireTitle: true },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.title, "Finance close");
    assert.equal(result.payload.description, "Monthly reporting");
    assert.equal(result.payload.leadAgentId, "agent-1");
    assert.equal(result.payload.teamName, "Finance");
    assert.equal(result.payload.status, "planning");
    assert.equal(result.payload.githubDefaultBranch, "main");
  }
});

test("parseMissionPayload defaults blank team names to General", () => {
  const result = parseMissionPayload({ title: "Pipeline", team_name: "" }, { requireTitle: true });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.teamName, "General");
  }
});

test("parseMissionPayload rejects blank titles for writes", () => {
  const result = parseMissionPayload({ title: "  " }, { requireTitle: true });

  assert.deepEqual(result, { ok: false, error: "Mission title is required." });
});

test("parseMissionPayload rejects unknown mission statuses", () => {
  const result = parseMissionPayload({ title: "Launch", status: "blocked" }, { requireTitle: true });

  assert.deepEqual(result, { ok: false, error: "Mission status must be planning, active, paused, or complete." });
});

test("parseMissionPayload rejects oversized mission fields", () => {
  assert.deepEqual(parseMissionPayload({ title: "a".repeat(161) }, { requireTitle: true }), {
    ok: false,
    error: "Mission title must be 160 characters or fewer.",
  });
  assert.deepEqual(parseMissionPayload({ title: "Launch", description: "a".repeat(5_001) }, { requireTitle: true }), {
    ok: false,
    error: "Mission description must be 5000 characters or fewer.",
  });
  assert.deepEqual(parseMissionPayload({ title: "Launch", team_name: "a".repeat(81) }, { requireTitle: true }), {
    ok: false,
    error: "Team name must be 80 characters or fewer.",
  });
  assert.deepEqual(parseMissionPayload({ title: "Launch", github_default_branch: "a".repeat(121) }, { requireTitle: true }), {
    ok: false,
    error: "Default branch must be 120 characters or fewer.",
  });
});

test("parseMissionPayload validates GitHub repository and default branch fields", () => {
  const valid = parseMissionPayload(
    {
      title: "Launch",
      github_repo: "  openai/mission.os_repo-1  ",
      github_default_branch: "release/2026.05",
    },
    { requireTitle: true },
  );

  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.payload.githubRepo, "openai/mission.os_repo-1");
    assert.equal(valid.payload.githubDefaultBranch, "release/2026.05");
  }

  assert.deepEqual(parseMissionPayload({ title: "Launch", github_repo: "openai/mission/os" }, { requireTitle: true }), {
    ok: false,
    error: "GitHub repository must use owner/repo format with supported characters.",
  });
  assert.deepEqual(parseMissionPayload({ title: "Launch", github_repo: "../mission" }, { requireTitle: true }), {
    ok: false,
    error: "GitHub repository must use owner/repo format with supported characters.",
  });
  assert.deepEqual(parseMissionPayload({ title: "Launch", github_default_branch: "../main" }, { requireTitle: true }), {
    ok: false,
    error: "Default branch contains unsupported characters.",
  });
  assert.deepEqual(parseMissionPayload({ title: "Launch", github_default_branch: "-main" }, { requireTitle: true }), {
    ok: false,
    error: "Default branch contains unsupported characters.",
  });
});

test("validateMissionAgentAssignment rejects missing agent ids", () => {
  assert.deepEqual(
    validateMissionAgentAssignment({ agentId: null, missionExists: true, agentExists: false }),
    { ok: false, status: 400, error: "agent_id is required." },
  );
});

test("validateMissionAgentAssignment rejects missing missions before assignment", () => {
  assert.deepEqual(
    validateMissionAgentAssignment({ agentId: "agent-1", missionExists: false, agentExists: true }),
    { ok: false, status: 404, error: "Mission not found." },
  );
});

test("validateMissionAgentAssignment rejects unknown agents before assignment", () => {
  assert.deepEqual(
    validateMissionAgentAssignment({ agentId: "agent-1", missionExists: true, agentExists: false }),
    { ok: false, status: 404, error: "Agent not found." },
  );
});

test("validateMissionAgentAssignment rejects inactive or unsupported agents before assignment", () => {
  assert.deepEqual(
    validateMissionAgentAssignment({ agentId: "agent-1", missionExists: true, agentExists: true, agentActive: false, agentEngineSupported: true }),
    { ok: false, status: 409, error: "Agent is inactive." },
  );
  assert.deepEqual(
    validateMissionAgentAssignment({ agentId: "agent-1", missionExists: true, agentExists: true, agentActive: true, agentEngineSupported: false }),
    { ok: false, status: 409, error: "Agent engine is not supported." },
  );
});

test("validateMissionAgentAssignment accepts known mission-agent pairs", () => {
  assert.deepEqual(
    validateMissionAgentAssignment({ agentId: "agent-1", missionExists: true, agentExists: true }),
    { ok: true },
  );
});

test("mission agent assignment rejects inactive agents", async () => {
  const db = getDb();
  db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-inactive-assign-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'mission-inactive-assign-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'mission-inactive-assign-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, active)
    VALUES ('mission-inactive-assign-agent-test', 'Inactive Worker', 'Specialist', 'codex', 0)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('mission-inactive-assign-test', 'Inactive assignment mission', 'planning', 'Finance')
    `,
  ).run();

  try {
    const response = await requestAssignMissionAgent("mission-inactive-assign-test", {
      agent_id: "mission-inactive-assign-agent-test",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Agent is inactive." });
    assert.equal(db.prepare("SELECT 1 FROM mission_agents WHERE agent_id = 'mission-inactive-assign-agent-test'").get(), undefined);
  } finally {
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-inactive-assign-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'mission-inactive-assign-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'mission-inactive-assign-agent-test'").run();
  }
});

test("mission agent assignment rejects unsupported agent engines", async () => {
  const db = getDb();
  db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-unsupported-assign-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'mission-unsupported-assign-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'mission-unsupported-assign-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, active)
    VALUES ('mission-unsupported-assign-agent-test', 'Unsupported Worker', 'Specialist', 'legacy-engine', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('mission-unsupported-assign-test', 'Unsupported assignment mission', 'planning', 'Finance')
    `,
  ).run();

  try {
    const response = await requestAssignMissionAgent("mission-unsupported-assign-test", {
      agent_id: "mission-unsupported-assign-agent-test",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Agent engine is not supported." });
    assert.equal(db.prepare("SELECT 1 FROM mission_agents WHERE agent_id = 'mission-unsupported-assign-agent-test'").get(), undefined);
  } finally {
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-unsupported-assign-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'mission-unsupported-assign-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'mission-unsupported-assign-agent-test'").run();
  }
});

test("validateMissionAgentRemoval rejects active linked runs", () => {
  assert.deepEqual(validateMissionAgentRemoval({ activeRunCount: 1 }), {
    ok: false,
    status: 409,
    error: "Mission agent has active runs. Wait for them to finish before removing the agent.",
  });
  assert.deepEqual(validateMissionAgentRemoval({ activeRunCount: 0 }), { ok: true });
});

test("removing a mission agent clears matching lead assignment", async () => {
  const db = getDb();
  db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-remove-lead-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'mission-remove-lead-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'mission-remove-lead-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine)
    VALUES ('mission-remove-lead-agent-test', 'Lead', 'Coordinator', 'codex')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name, lead_agent_id)
    VALUES ('mission-remove-lead-test', 'Remove lead mission', 'planning', 'Sales', 'mission-remove-lead-agent-test')
    `,
  ).run();
  db.prepare("INSERT INTO mission_agents (mission_id, agent_id) VALUES ('mission-remove-lead-test', 'mission-remove-lead-agent-test')").run();

  try {
    const response = await requestRemoveMissionAgent("mission-remove-lead-test", "mission-remove-lead-agent-test");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
    const mission = db.prepare("SELECT lead_agent_id FROM missions WHERE id = 'mission-remove-lead-test'").get() as {
      lead_agent_id: string | null;
    };
    assert.deepEqual(mission, { lead_agent_id: null });
  } finally {
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-remove-lead-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'mission-remove-lead-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'mission-remove-lead-agent-test'").run();
  }
});

test("removing a mission agent rejects active linked runs", async () => {
  const db = getDb();
  db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-active-agent-remove-test'").run();
  db.prepare("DELETE FROM runs WHERE id = 'mission-active-agent-remove-run-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'mission-active-agent-remove-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'mission-active-agent-remove-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine)
    VALUES ('mission-active-agent-remove-agent-test', 'Active Worker', 'Specialist', 'codex')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name, lead_agent_id)
    VALUES ('mission-active-agent-remove-test', 'Active agent mission', 'active', 'Finance', 'mission-active-agent-remove-agent-test')
    `,
  ).run();
  db.prepare(
    "INSERT INTO mission_agents (mission_id, agent_id) VALUES ('mission-active-agent-remove-test', 'mission-active-agent-remove-agent-test')",
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, engine, status, prompt, output, tool_calls)
    VALUES (
      'mission-active-agent-remove-run-test',
      'mission-active-agent-remove-agent-test',
      'mission-active-agent-remove-test',
      'codex',
      'running',
      'Run',
      '',
      '[]'
    )
    `,
  ).run();

  try {
    const response = await requestRemoveMissionAgent("mission-active-agent-remove-test", "mission-active-agent-remove-agent-test");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Mission agent has active runs. Wait for them to finish before removing the agent." });
    assert.ok(
      db
        .prepare("SELECT 1 FROM mission_agents WHERE mission_id = 'mission-active-agent-remove-test' AND agent_id = 'mission-active-agent-remove-agent-test'")
        .get(),
    );
    assert.deepEqual(db.prepare("SELECT lead_agent_id FROM missions WHERE id = 'mission-active-agent-remove-test'").get(), {
      lead_agent_id: "mission-active-agent-remove-agent-test",
    });
  } finally {
    db.prepare("DELETE FROM runs WHERE id = 'mission-active-agent-remove-run-test'").run();
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-active-agent-remove-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'mission-active-agent-remove-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'mission-active-agent-remove-agent-test'").run();
  }
});

test("validateMissionReferences rejects missing lead agents", () => {
  assert.deepEqual(validateMissionReferences({ leadAgentId: "agent-1", leadAgentExists: false }), {
    ok: false,
    status: 404,
    error: "Lead agent not found.",
  });
});

test("validateMissionReferences rejects inactive or unsupported lead agents", () => {
  assert.deepEqual(
    validateMissionReferences({ leadAgentId: "agent-1", leadAgentExists: true, leadAgentActive: false, leadAgentEngineSupported: true }),
    {
      ok: false,
      status: 409,
      error: "Lead agent is inactive.",
    },
  );
  assert.deepEqual(
    validateMissionReferences({ leadAgentId: "agent-1", leadAgentExists: true, leadAgentActive: true, leadAgentEngineSupported: false }),
    {
      ok: false,
      status: 409,
      error: "Lead agent engine is not supported.",
    },
  );
});

test("validateMissionReferences accepts empty or known lead agents", () => {
  assert.deepEqual(validateMissionReferences({ leadAgentId: null, leadAgentExists: false }), { ok: true });
  assert.deepEqual(validateMissionReferences({ leadAgentId: "agent-1", leadAgentExists: true }), { ok: true });
});

test("validateMissionDeleteResult rejects missing missions", () => {
  assert.deepEqual(validateMissionDeleteResult(0), {
    ok: false,
    status: 404,
    error: "Mission not found.",
  });
});

test("validateMissionDeleteResult accepts deleted missions", () => {
  assert.deepEqual(validateMissionDeleteResult(1), { ok: true });
});

test("validateMissionDeleteBlockers rejects missions with linked issues, runs, messages, or schedules", () => {
  const error = "Cannot delete this mission while it has linked issues, runs, messages, or schedules. Remove the linked work first.";
  assert.deepEqual(validateMissionDeleteBlockers({ issueCount: 1, runCount: 0, messageCount: 0, scheduleCount: 0 }), {
    ok: false,
    status: 409,
    error,
  });
  assert.deepEqual(validateMissionDeleteBlockers({ issueCount: 0, runCount: 2, messageCount: 0, scheduleCount: 0 }), {
    ok: false,
    status: 409,
    error,
  });
  assert.deepEqual(validateMissionDeleteBlockers({ issueCount: 0, runCount: 0, messageCount: 3, scheduleCount: 0 }), {
    ok: false,
    status: 409,
    error,
  });
  assert.deepEqual(validateMissionDeleteBlockers({ issueCount: 0, runCount: 0, messageCount: 0, scheduleCount: 1 }), {
    ok: false,
    status: 409,
    error,
  });
});

test("validateMissionDeleteBlockers accepts missions without linked work", () => {
  assert.deepEqual(validateMissionDeleteBlockers({ issueCount: 0, runCount: 0, messageCount: 0, scheduleCount: 0 }), { ok: true });
});

test("mission deletion rejects missions with linked messages", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agent_messages WHERE mission_id = 'mission-message-delete-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'mission-message-delete-test'").run();
  db.prepare(
    `
    INSERT INTO missions (id, title, description, status, team_name)
    VALUES ('mission-message-delete-test', 'Message mission', NULL, 'planning', 'Sales')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
    VALUES ('mission-message-delete-message-test', NULL, NULL, 'mission-message-delete-test', NULL, 'Keep this context')
    `,
  ).run();

  try {
    const response = await requestDeleteMission("mission-message-delete-test");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: "Cannot delete this mission while it has linked issues, runs, messages, or schedules. Remove the linked work first.",
    });
    assert.ok(db.prepare("SELECT 1 FROM missions WHERE id = 'mission-message-delete-test'").get());
  } finally {
    db.prepare("DELETE FROM agent_messages WHERE mission_id = 'mission-message-delete-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'mission-message-delete-test'").run();
  }
});

test("mission deletion rejects missions with linked schedules", async () => {
  const db = getDb();
  db.prepare("DELETE FROM schedules WHERE mission_id = 'mission-schedule-delete-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'mission-schedule-delete-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'mission-schedule-delete-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine)
    VALUES ('mission-schedule-delete-agent-test', 'Schedule agent', 'Operations', 'codex')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, description, status, team_name)
    VALUES ('mission-schedule-delete-test', 'Schedule mission', NULL, 'planning', 'Finance')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, mission_id, agent_id, prompt, cron_expression, enabled)
    VALUES (
      'mission-schedule-delete-schedule-test',
      'Finance schedule',
      'mission-schedule-delete-test',
      'mission-schedule-delete-agent-test',
      'Run',
      '0 9 * * *',
      0
    )
    `,
  ).run();

  try {
    const response = await requestDeleteMission("mission-schedule-delete-test");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: "Cannot delete this mission while it has linked issues, runs, messages, or schedules. Remove the linked work first.",
    });
    assert.ok(db.prepare("SELECT 1 FROM missions WHERE id = 'mission-schedule-delete-test'").get());
  } finally {
    db.prepare("DELETE FROM schedules WHERE mission_id = 'mission-schedule-delete-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'mission-schedule-delete-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'mission-schedule-delete-agent-test'").run();
  }
});

test("validateMissionStartLead rejects missions without an active lead agent", () => {
  assert.deepEqual(validateMissionStartLead({ leadAgentId: null, leadAgentExists: false, leadAgentActive: false, leadAgentEngineSupported: true }), {
    ok: false,
    status: 400,
    error: "Mission has no lead agent.",
  });
  assert.deepEqual(validateMissionStartLead({ leadAgentId: "agent-1", leadAgentExists: false, leadAgentActive: false, leadAgentEngineSupported: true }), {
    ok: false,
    status: 404,
    error: "Lead agent not found.",
  });
  assert.deepEqual(validateMissionStartLead({ leadAgentId: "agent-1", leadAgentExists: true, leadAgentActive: false, leadAgentEngineSupported: true }), {
    ok: false,
    status: 409,
    error: "Mission lead agent is inactive.",
  });
});

test("validateMissionStartLead accepts active lead agents", () => {
  assert.deepEqual(validateMissionStartLead({ leadAgentId: "agent-1", leadAgentExists: true, leadAgentActive: true, leadAgentEngineSupported: true }), {
    ok: true,
  });
});

test("validateMissionStartLead rejects unsupported lead agent engines", () => {
  assert.deepEqual(
    validateMissionStartLead({
      leadAgentId: "agent-1",
      leadAgentExists: true,
      leadAgentActive: true,
      leadAgentEngineSupported: false,
    }),
    { ok: false, status: 409, error: "Mission lead agent engine is not supported." },
  );
});

test("mission start returns a controlled conflict for legacy unsupported lead engines", async () => {
  const db = getDb();
  db.prepare("DELETE FROM missions WHERE id = 'mission-unsupported-engine-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'mission-unsupported-engine-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('mission-unsupported-engine-agent-test', 'Legacy lead', NULL, 'legacy-engine', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, description, status, team_name, lead_agent_id)
    VALUES ('mission-unsupported-engine-test', 'Legacy mission', NULL, 'planning', 'Engineering', 'mission-unsupported-engine-agent-test')
    `,
  ).run();

  try {
    const response = await requestStartMission("mission-unsupported-engine-test");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Mission lead agent engine is not supported." });
  } finally {
    db.prepare("DELETE FROM missions WHERE id = 'mission-unsupported-engine-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'mission-unsupported-engine-agent-test'").run();
  }
});

test("validateMissionStartStatus rejects already active missions", () => {
  assert.deepEqual(validateMissionStartStatus({ status: "active" }), {
    ok: false,
    status: 409,
    error: "Mission is already active.",
  });
  assert.deepEqual(validateMissionStartStatus({ status: "complete" }), {
    ok: false,
    status: 409,
    error: "Mission is already complete.",
  });
  assert.deepEqual(validateMissionStartStatus({ status: "planning" }), { ok: true });
  assert.deepEqual(validateMissionStartStatus({ status: "paused" }), { ok: true });
});

test("validateMissionCompletion rejects completion while runs are active", () => {
  assert.deepEqual(validateMissionCompletion({ status: "complete", activeRunCount: 1 }), {
    ok: false,
    status: 409,
    error: "Mission has active runs. Wait for them to finish before marking it complete.",
  });
  assert.deepEqual(validateMissionCompletion({ status: "complete", activeRunCount: 0 }), { ok: true });
  assert.deepEqual(validateMissionCompletion({ status: "active", activeRunCount: 1 }), { ok: true });
});

test("mission update rejects completion while linked runs are active", async () => {
  const db = getDb();
  db.prepare("DELETE FROM runs WHERE mission_id = 'mission-active-complete-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'mission-active-complete-test'").run();
  db.prepare(
    `
    INSERT INTO missions (id, title, description, status, team_name)
    VALUES ('mission-active-complete-test', 'Active completion mission', NULL, 'active', 'Engineering')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, engine, status, prompt, output, tool_calls)
    VALUES ('mission-active-complete-run-test', NULL, 'mission-active-complete-test', NULL, 'codex', 'running', 'Run', '', '[]')
    `,
  ).run();

  try {
    const response = await requestUpdateMission("mission-active-complete-test", {
      title: "Active completion mission",
      status: "complete",
      team_name: "Engineering",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: "Mission has active runs. Wait for them to finish before marking it complete.",
    });
    const mission = db.prepare("SELECT status FROM missions WHERE id = 'mission-active-complete-test'").get() as { status: string };
    assert.deepEqual(mission, { status: "active" });
  } finally {
    db.prepare("DELETE FROM runs WHERE mission_id = 'mission-active-complete-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'mission-active-complete-test'").run();
  }
});

test("mission start rejects completed missions", async () => {
  const db = getDb();
  db.prepare("DELETE FROM missions WHERE id = 'mission-complete-start-test'").run();
  db.prepare(
    `
    INSERT INTO missions (id, title, description, status, team_name)
    VALUES ('mission-complete-start-test', 'Completed mission', NULL, 'complete', 'Engineering')
    `,
  ).run();

  try {
    const response = await requestStartMission("mission-complete-start-test");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Mission is already complete." });
  } finally {
    db.prepare("DELETE FROM missions WHERE id = 'mission-complete-start-test'").run();
  }
});
