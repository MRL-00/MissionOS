import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getDb } from "../db.js";
import { parseScheduleListQuery, registerScheduleRoutes, validateScheduleDeletion, validateScheduleMissionUpdate } from "./schedules.js";

async function requestCreateSchedule(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerScheduleRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/schedules`, {
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

async function requestUpdateSchedule(scheduleId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerScheduleRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/schedules/${encodeURIComponent(scheduleId)}`, {
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

async function requestDeleteSchedule(scheduleId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerScheduleRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/schedules/${encodeURIComponent(scheduleId)}`, {
      method: "DELETE",
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("parseScheduleListQuery defaults and caps schedule list limits", () => {
  assert.deepEqual(parseScheduleListQuery({}), { missionId: undefined, limit: 500 });
  assert.deepEqual(parseScheduleListQuery({ limit: "50" }), { missionId: undefined, limit: 50 });
  assert.deepEqual(parseScheduleListQuery({ limit: "5000" }), { missionId: undefined, limit: 1_000 });
  assert.deepEqual(parseScheduleListQuery({ limit: "0" }), { missionId: undefined, limit: 500 });
  assert.deepEqual(parseScheduleListQuery({ limit: 42 }), { missionId: undefined, limit: 500 });
});

test("parseScheduleListQuery trims mission filters", () => {
  assert.deepEqual(parseScheduleListQuery({ mission_id: "  mission-1  " }), { missionId: "mission-1", limit: 500 });
  assert.deepEqual(parseScheduleListQuery({ mission_id: "m".repeat(150) }), { missionId: "m".repeat(120), limit: 500 });
  assert.deepEqual(parseScheduleListQuery({ mission_id: " " }), { missionId: undefined, limit: 500 });
});

test("validateScheduleDeletion rejects active linked runs", () => {
  assert.deepEqual(validateScheduleDeletion({ activeRunCount: 1 }), {
    ok: false,
    status: 409,
    error: "Schedule has active runs. Wait for them to finish before deleting it.",
  });
  assert.deepEqual(validateScheduleDeletion({ activeRunCount: 0 }), { ok: true });
});

test("validateScheduleMissionUpdate rejects mission changes with active linked runs", () => {
  assert.deepEqual(validateScheduleMissionUpdate({ missionChanged: true, activeRunCount: 1 }), {
    ok: false,
    status: 409,
    error: "Schedule has active runs. Wait for them to finish before changing its mission.",
  });
  assert.deepEqual(validateScheduleMissionUpdate({ missionChanged: false, activeRunCount: 1 }), { ok: true });
  assert.deepEqual(validateScheduleMissionUpdate({ missionChanged: true, activeRunCount: 0 }), { ok: true });
});

test("schedule creation returns a controlled conflict for legacy unsupported agent engines", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agents WHERE id = 'schedule-unsupported-engine-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('schedule-unsupported-engine-agent-test', 'Legacy schedule agent', NULL, 'legacy-engine', '[]', '[]', 1)
    `,
  ).run();

  try {
    const response = await requestCreateSchedule({
      name: "Legacy schedule",
      agent_id: "schedule-unsupported-engine-agent-test",
      prompt: "Run reporting.",
      cron_expression: "0 9 * * *",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Schedule agent engine is not supported." });
  } finally {
    db.prepare("DELETE FROM agents WHERE id = 'schedule-unsupported-engine-agent-test'").run();
  }
});

test("schedule creation stores optional mission ownership", async () => {
  const db = getDb();
  db.prepare("DELETE FROM schedules WHERE id IN (SELECT id FROM schedules WHERE name = 'Mission schedule')").run();
  db.prepare("DELETE FROM mission_agents WHERE mission_id = 'schedule-mission-owner-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'schedule-mission-owner-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'schedule-mission-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('schedule-mission-agent-test', 'Mission schedule agent', NULL, 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('schedule-mission-owner-test', 'Schedule mission', 'planning', 'Finance')
    `,
  ).run();
  db.prepare("INSERT INTO mission_agents (mission_id, agent_id) VALUES ('schedule-mission-owner-test', 'schedule-mission-agent-test')").run();

  try {
    const response = await requestCreateSchedule({
      name: "Mission schedule",
      mission_id: "schedule-mission-owner-test",
      agent_id: "schedule-mission-agent-test",
      prompt: "Run reporting.",
      cron_expression: "0 9 * * *",
    });

    assert.equal(response.status, 201);
    const body = response.body as { schedule: { mission_id: string | null; mission_title?: string | null } };
    assert.equal(body.schedule.mission_id, "schedule-mission-owner-test");
    assert.equal(body.schedule.mission_title, "Schedule mission");
  } finally {
    db.prepare("DELETE FROM schedules WHERE agent_id = 'schedule-mission-agent-test'").run();
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'schedule-mission-owner-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'schedule-mission-owner-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'schedule-mission-agent-test'").run();
  }
});

test("schedule creation rejects unknown mission ownership", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agents WHERE id = 'schedule-missing-mission-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('schedule-missing-mission-agent-test', 'Missing mission schedule agent', NULL, 'codex', '[]', '[]', 1)
    `,
  ).run();

  try {
    const response = await requestCreateSchedule({
      name: "Missing mission schedule",
      mission_id: "missing-schedule-mission-test",
      agent_id: "schedule-missing-mission-agent-test",
      prompt: "Run reporting.",
      cron_expression: "0 9 * * *",
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Mission not found." });
  } finally {
    db.prepare("DELETE FROM agents WHERE id = 'schedule-missing-mission-agent-test'").run();
  }
});

test("schedule creation rejects mission agents that are not staffed on the mission", async () => {
  const db = getDb();
  db.prepare("DELETE FROM schedules WHERE name = 'Unstaffed mission schedule'").run();
  db.prepare("DELETE FROM mission_agents WHERE mission_id = 'schedule-unstaffed-mission-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'schedule-unstaffed-mission-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'schedule-unstaffed-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('schedule-unstaffed-agent-test', 'Unstaffed schedule agent', NULL, 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('schedule-unstaffed-mission-test', 'Unstaffed schedule mission', 'planning', 'Finance')
    `,
  ).run();

  try {
    const response = await requestCreateSchedule({
      name: "Unstaffed mission schedule",
      mission_id: "schedule-unstaffed-mission-test",
      agent_id: "schedule-unstaffed-agent-test",
      prompt: "Run reporting.",
      cron_expression: "0 9 * * *",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Schedule agent is not assigned to this mission." });
  } finally {
    db.prepare("DELETE FROM schedules WHERE name = 'Unstaffed mission schedule'").run();
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'schedule-unstaffed-mission-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'schedule-unstaffed-mission-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'schedule-unstaffed-agent-test'").run();
  }
});

test("schedule mission updates propagate to linked runs and run messages", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agent_messages WHERE run_id = 'schedule-move-run-test'").run();
  db.prepare("DELETE FROM runs WHERE id = 'schedule-move-run-test'").run();
  db.prepare("DELETE FROM schedules WHERE id = 'schedule-move-test'").run();
  db.prepare("DELETE FROM mission_agents WHERE mission_id IN ('schedule-move-from-mission-test', 'schedule-move-to-mission-test')").run();
  db.prepare("DELETE FROM missions WHERE id IN ('schedule-move-from-mission-test', 'schedule-move-to-mission-test')").run();
  db.prepare("DELETE FROM agents WHERE id IN ('schedule-move-agent-test', 'schedule-move-recipient-test')").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES
      ('schedule-move-agent-test', 'Schedule move agent', NULL, 'codex', '[]', '[]', 1),
      ('schedule-move-recipient-test', 'Schedule move recipient', NULL, 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES
      ('schedule-move-from-mission-test', 'Source schedule mission', 'planning', 'Finance'),
      ('schedule-move-to-mission-test', 'Target schedule mission', 'planning', 'Sales')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO mission_agents (mission_id, agent_id)
    VALUES
      ('schedule-move-from-mission-test', 'schedule-move-agent-test'),
      ('schedule-move-to-mission-test', 'schedule-move-agent-test')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, mission_id, agent_id, prompt, cron_expression, enabled)
    VALUES ('schedule-move-test', 'Move schedule', 'schedule-move-from-mission-test', 'schedule-move-agent-test', 'Run', '0 9 * * *', 0)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, schedule_id, engine, status, prompt, output, tool_calls)
    VALUES (
      'schedule-move-run-test',
      'schedule-move-agent-test',
      'schedule-move-from-mission-test',
      NULL,
      'schedule-move-test',
      'codex',
      'complete',
      'Run',
      '',
      '[]'
    )
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
    VALUES (
      'schedule-move-message-test',
      'schedule-move-agent-test',
      'schedule-move-recipient-test',
      'schedule-move-from-mission-test',
      'schedule-move-run-test',
      'Review'
    )
    `,
  ).run();

  try {
    const response = await requestUpdateSchedule("schedule-move-test", {
      name: "Move schedule",
      mission_id: "schedule-move-to-mission-test",
      agent_id: "schedule-move-agent-test",
      prompt: "Run",
      cron_expression: "0 9 * * *",
      enabled: false,
    });

    assert.equal(response.status, 200);
    const run = db.prepare("SELECT mission_id FROM runs WHERE id = 'schedule-move-run-test'").get() as { mission_id: string | null };
    assert.deepEqual(run, { mission_id: "schedule-move-to-mission-test" });
    const message = db.prepare("SELECT mission_id FROM agent_messages WHERE id = 'schedule-move-message-test'").get() as {
      mission_id: string | null;
    };
    assert.deepEqual(message, { mission_id: "schedule-move-to-mission-test" });
  } finally {
    db.prepare("DELETE FROM agent_messages WHERE run_id = 'schedule-move-run-test'").run();
    db.prepare("DELETE FROM runs WHERE id = 'schedule-move-run-test'").run();
    db.prepare("DELETE FROM schedules WHERE id = 'schedule-move-test'").run();
    db.prepare("DELETE FROM mission_agents WHERE mission_id IN ('schedule-move-from-mission-test', 'schedule-move-to-mission-test')").run();
    db.prepare("DELETE FROM missions WHERE id IN ('schedule-move-from-mission-test', 'schedule-move-to-mission-test')").run();
    db.prepare("DELETE FROM agents WHERE id IN ('schedule-move-agent-test', 'schedule-move-recipient-test')").run();
  }
});

test("schedule mission updates reject active linked runs without moving history", async () => {
  const db = getDb();
  db.prepare("DELETE FROM runs WHERE id = 'schedule-active-move-run-test'").run();
  db.prepare("DELETE FROM schedules WHERE id = 'schedule-active-move-test'").run();
  db.prepare("DELETE FROM mission_agents WHERE mission_id IN ('schedule-active-move-from-mission-test', 'schedule-active-move-to-mission-test')").run();
  db.prepare("DELETE FROM missions WHERE id IN ('schedule-active-move-from-mission-test', 'schedule-active-move-to-mission-test')").run();
  db.prepare("DELETE FROM agents WHERE id = 'schedule-active-move-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('schedule-active-move-agent-test', 'Schedule active move agent', NULL, 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES
      ('schedule-active-move-from-mission-test', 'Source active schedule mission', 'planning', 'Finance'),
      ('schedule-active-move-to-mission-test', 'Target active schedule mission', 'planning', 'Sales')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO mission_agents (mission_id, agent_id)
    VALUES
      ('schedule-active-move-from-mission-test', 'schedule-active-move-agent-test'),
      ('schedule-active-move-to-mission-test', 'schedule-active-move-agent-test')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, mission_id, agent_id, prompt, cron_expression, enabled)
    VALUES (
      'schedule-active-move-test',
      'Active move schedule',
      'schedule-active-move-from-mission-test',
      'schedule-active-move-agent-test',
      'Run',
      '0 9 * * *',
      0
    )
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, schedule_id, engine, status, prompt, output, tool_calls)
    VALUES (
      'schedule-active-move-run-test',
      'schedule-active-move-agent-test',
      'schedule-active-move-from-mission-test',
      'schedule-active-move-test',
      'codex',
      'running',
      'Run',
      '',
      '[]'
    )
    `,
  ).run();

  try {
    const response = await requestUpdateSchedule("schedule-active-move-test", {
      name: "Active move schedule",
      mission_id: "schedule-active-move-to-mission-test",
      agent_id: "schedule-active-move-agent-test",
      prompt: "Run",
      cron_expression: "0 9 * * *",
      enabled: false,
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Schedule has active runs. Wait for them to finish before changing its mission." });
    assert.deepEqual(db.prepare("SELECT mission_id FROM schedules WHERE id = 'schedule-active-move-test'").get(), {
      mission_id: "schedule-active-move-from-mission-test",
    });
    assert.deepEqual(db.prepare("SELECT mission_id FROM runs WHERE id = 'schedule-active-move-run-test'").get(), {
      mission_id: "schedule-active-move-from-mission-test",
    });
  } finally {
    db.prepare("DELETE FROM runs WHERE id = 'schedule-active-move-run-test'").run();
    db.prepare("DELETE FROM schedules WHERE id = 'schedule-active-move-test'").run();
    db.prepare("DELETE FROM mission_agents WHERE mission_id IN ('schedule-active-move-from-mission-test', 'schedule-active-move-to-mission-test')").run();
    db.prepare("DELETE FROM missions WHERE id IN ('schedule-active-move-from-mission-test', 'schedule-active-move-to-mission-test')").run();
    db.prepare("DELETE FROM agents WHERE id = 'schedule-active-move-agent-test'").run();
  }
});

test("schedule deletion rejects schedules with active linked runs", async () => {
  const db = getDb();
  db.prepare("DELETE FROM runs WHERE schedule_id = 'schedule-active-delete-test'").run();
  db.prepare("DELETE FROM schedules WHERE id = 'schedule-active-delete-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'schedule-active-delete-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('schedule-active-delete-agent-test', 'Schedule active delete agent', NULL, 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, agent_id, prompt, cron_expression, enabled)
    VALUES ('schedule-active-delete-test', 'Active delete schedule', 'schedule-active-delete-agent-test', 'Run', '0 9 * * *', 0)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, schedule_id, engine, status, prompt, output, tool_calls)
    VALUES ('schedule-active-delete-run-test', 'schedule-active-delete-agent-test', 'schedule-active-delete-test', 'codex', 'running', 'Run', '', '[]')
    `,
  ).run();

  try {
    const response = await requestDeleteSchedule("schedule-active-delete-test");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Schedule has active runs. Wait for them to finish before deleting it." });
    assert.deepEqual(
      db.prepare("SELECT id FROM schedules WHERE id = 'schedule-active-delete-test'").get(),
      { id: "schedule-active-delete-test" },
    );
  } finally {
    db.prepare("DELETE FROM runs WHERE schedule_id = 'schedule-active-delete-test'").run();
    db.prepare("DELETE FROM schedules WHERE id = 'schedule-active-delete-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'schedule-active-delete-agent-test'").run();
  }
});

test("schedule deletion detaches completed linked run history", async () => {
  const db = getDb();
  db.prepare("DELETE FROM runs WHERE id = 'schedule-complete-delete-run-test'").run();
  db.prepare("DELETE FROM schedules WHERE id = 'schedule-complete-delete-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'schedule-complete-delete-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('schedule-complete-delete-agent-test', 'Schedule complete delete agent', NULL, 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, agent_id, prompt, cron_expression, enabled)
    VALUES ('schedule-complete-delete-test', 'Complete delete schedule', 'schedule-complete-delete-agent-test', 'Run', '0 9 * * *', 0)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, schedule_id, engine, status, prompt, output, tool_calls)
    VALUES ('schedule-complete-delete-run-test', 'schedule-complete-delete-agent-test', 'schedule-complete-delete-test', 'codex', 'complete', 'Run', '', '[]')
    `,
  ).run();

  try {
    const response = await requestDeleteSchedule("schedule-complete-delete-test");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
    assert.equal(db.prepare("SELECT id FROM schedules WHERE id = 'schedule-complete-delete-test'").get(), undefined);
    assert.deepEqual(
      db.prepare("SELECT schedule_id FROM runs WHERE id = 'schedule-complete-delete-run-test'").get(),
      { schedule_id: null },
    );
  } finally {
    db.prepare("DELETE FROM runs WHERE id = 'schedule-complete-delete-run-test'").run();
    db.prepare("DELETE FROM schedules WHERE id = 'schedule-complete-delete-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'schedule-complete-delete-agent-test'").run();
  }
});
