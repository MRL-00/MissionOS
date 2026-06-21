import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeNextRunAt,
  DUE_SCHEDULE_POLL_LIMIT,
  listDueScheduleIds,
  normalizeScheduleEnabled,
  normalizeScheduleMaxRuns,
  parseScheduleInput,
  triggerScheduleRun,
  validateScheduleAgent,
} from "./scheduling.js";
import { getDb } from "./db.js";
import { engineMap } from "./engines/index.js";
import type { EngineAdapter } from "./engines/types.js";

function ensureScheduleTestAgent() {
  getDb()
    .prepare(
      `
      INSERT INTO agents (id, name, role, engine, skills, tools, active)
      VALUES ('schedule-test-agent', 'Schedule Test Agent', 'Operations', 'codex', '[]', '[]', 1)
      ON CONFLICT(id) DO NOTHING
      `,
    )
    .run();
}

test("parseScheduleInput trims fields and defaults enabled to true", () => {
  assert.deepEqual(
    parseScheduleInput({
      name: "  Daily review  ",
      agent_id: "  agent-1  ",
      prompt: "  Summarize open issues  ",
      cron_expression: "  0 9 * * 1  ",
      max_runs: "3",
    }),
    {
      name: "Daily review",
      missionId: null,
      agentId: "agent-1",
      prompt: "Summarize open issues",
      cronExpression: "0 9 * * 1",
      enabled: true,
      maxRuns: 3,
    },
  );
});

test("parseScheduleInput trims optional mission links", () => {
  assert.equal(
    parseScheduleInput({
      name: "Daily review",
      mission_id: "  mission-1  ",
      agent_id: "agent-1",
      prompt: "Run",
      cron_expression: "0 9 * * *",
    }).missionId,
    "mission-1",
  );
});

test("parseScheduleInput preserves disabled schedules", () => {
  const input = parseScheduleInput({
    name: "Paused job",
    agent_id: "agent-1",
    prompt: "Wait",
    cron_expression: "0 12 * * *",
    enabled: false,
  });

  assert.equal(input.enabled, false);
});

test("parseScheduleInput treats string false as disabled", () => {
  const input = parseScheduleInput({
    name: "Paused job",
    agent_id: "agent-1",
    prompt: "Wait",
    cron_expression: "0 12 * * *",
    enabled: "false",
  });

  assert.equal(input.enabled, false);
});

test("parseScheduleInput rejects missing required fields", () => {
  assert.throws(
    () => parseScheduleInput({ agent_id: "agent-1", prompt: "Run", cron_expression: "0 9 * * *" }),
    /Schedule name is required\./,
  );
  assert.throws(
    () => parseScheduleInput({ name: "Job", prompt: "Run", cron_expression: "0 9 * * *" }),
    /agent_id is required\./,
  );
  assert.throws(
    () => parseScheduleInput({ name: "Job", agent_id: "agent-1", cron_expression: "0 9 * * *" }),
    /prompt is required\./,
  );
  assert.throws(
    () => parseScheduleInput({ name: "Job", agent_id: "agent-1", prompt: "Run" }),
    /cron_expression is required\./,
  );
});

test("parseScheduleInput rejects invalid cron expressions", () => {
  assert.throws(
    () => parseScheduleInput({ name: "Job", agent_id: "agent-1", prompt: "Run", cron_expression: "0 9 * *" }),
    /Cron expressions must use 5 fields/,
  );
});

test("parseScheduleInput rejects oversized fields", () => {
  assert.throws(
    () => parseScheduleInput({ name: "a".repeat(121), agent_id: "agent-1", prompt: "Run", cron_expression: "0 9 * * *" }),
    /Schedule name must be 120 characters or fewer\./,
  );
  assert.throws(
    () => parseScheduleInput({ name: "Job", agent_id: "agent-1", prompt: "a".repeat(20_001), cron_expression: "0 9 * * *" }),
    /prompt must be 20000 characters or fewer\./,
  );
  assert.throws(
    () => parseScheduleInput({ name: "Job", agent_id: "agent-1", prompt: "Run", cron_expression: "* ".repeat(61).trim() }),
    /cron_expression must be 120 characters or fewer\./,
  );
});

test("normalizeScheduleMaxRuns accepts empty values and positive integers", () => {
  assert.equal(normalizeScheduleMaxRuns(undefined), null);
  assert.equal(normalizeScheduleMaxRuns(""), null);
  assert.equal(normalizeScheduleMaxRuns("5"), 5);
});

test("normalizeScheduleMaxRuns rejects invalid limits", () => {
  assert.throws(() => normalizeScheduleMaxRuns("0"), /max_runs must be a positive whole number\./);
  assert.throws(() => normalizeScheduleMaxRuns("1.5"), /max_runs must be a positive whole number\./);
  assert.throws(() => normalizeScheduleMaxRuns("1000001"), /max_runs must be 1000000 or fewer\./);
});

test("normalizeScheduleEnabled accepts booleans and string booleans", () => {
  assert.equal(normalizeScheduleEnabled(undefined), true);
  assert.equal(normalizeScheduleEnabled(true), true);
  assert.equal(normalizeScheduleEnabled(false), false);
  assert.equal(normalizeScheduleEnabled("true"), true);
  assert.equal(normalizeScheduleEnabled(" false "), false);
});

test("computeNextRunAt returns the next matching sqlite timestamp", () => {
  assert.equal(computeNextRunAt("* * * * *", new Date("2026-05-06T08:30:00.000Z")), "2026-05-06 08:31:00");
});

test("validateScheduleAgent rejects missing, inactive, or unsupported-engine agents", () => {
  assert.deepEqual(validateScheduleAgent({ agentExists: false, agentActive: false, agentEngineSupported: true }), {
    ok: false,
    status: 404,
    error: "Agent not found.",
  });
  assert.deepEqual(validateScheduleAgent({ agentExists: true, agentActive: false, agentEngineSupported: true }), {
    ok: false,
    status: 409,
    error: "Schedule agent is inactive.",
  });
  assert.deepEqual(validateScheduleAgent({ agentExists: true, agentActive: true, agentEngineSupported: false }), {
    ok: false,
    status: 409,
    error: "Schedule agent engine is not supported.",
  });
  assert.deepEqual(validateScheduleAgent({ agentExists: true, agentActive: true, agentEngineSupported: true, agentAssignedToMission: false }), {
    ok: false,
    status: 409,
    error: "Schedule agent is not assigned to this mission.",
  });
  assert.deepEqual(validateScheduleAgent({ agentExists: true, agentActive: true, agentEngineSupported: true }), { ok: true });
});

test("triggerScheduleRun returns a null result for missing schedules", async () => {
  await assert.doesNotReject(async () => {
    assert.deepEqual(await triggerScheduleRun("missing-schedule-for-test", "manual"), {
      run: null,
      schedule: null,
    });
  });
});

test("triggerScheduleRun does not treat manual runs as max-run no-ops", async () => {
  const db = getDb();
  db.prepare("DELETE FROM schedules WHERE id = 'manual-max-run-schedule'").run();
  db.prepare("DELETE FROM agents WHERE id = 'manual-max-run-agent'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('manual-max-run-agent', 'Manual Max Agent', 'Operations', 'unsupported-engine', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, agent_id, prompt, cron_expression, enabled, max_runs, run_count, next_run_at, created_at)
    VALUES ('manual-max-run-schedule', 'Manual Max', 'manual-max-run-agent', 'Run', '* * * * *', 0, 1, 1, NULL, datetime('now'))
    `,
  ).run();

  try {
    await assert.rejects(() => triggerScheduleRun("manual-max-run-schedule", "manual"), /Schedule agent engine is not supported\./);
  } finally {
    db.prepare("DELETE FROM schedules WHERE id = 'manual-max-run-schedule'").run();
    db.prepare("DELETE FROM agents WHERE id = 'manual-max-run-agent'").run();
  }
});

test("triggerScheduleRun disables cron schedules that reached max runs", async () => {
  const db = getDb();
  db.prepare("DELETE FROM schedules WHERE id = 'cron-max-run-schedule'").run();
  db.prepare("DELETE FROM agents WHERE id = 'cron-max-run-agent'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('cron-max-run-agent', 'Cron Max Agent', 'Operations', 'unsupported-engine', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, agent_id, prompt, cron_expression, enabled, max_runs, run_count, next_run_at, created_at)
    VALUES ('cron-max-run-schedule', 'Cron Max', 'cron-max-run-agent', 'Run', '* * * * *', 1, 1, 1, datetime('now'), datetime('now'))
    `,
  ).run();

  try {
    const result = await triggerScheduleRun("cron-max-run-schedule", "cron");
    assert.equal(result.run, null);
    assert.equal(result.schedule?.enabled, false);
    assert.equal(result.schedule?.next_run_at, null);
  } finally {
    db.prepare("DELETE FROM schedules WHERE id = 'cron-max-run-schedule'").run();
    db.prepare("DELETE FROM agents WHERE id = 'cron-max-run-agent'").run();
  }
});

test("triggerScheduleRun carries schedule mission ownership into runs", async () => {
  const db = getDb();
  const testAdapter: EngineAdapter = {
    id: "test-schedule-engine",
    label: "Test Schedule Engine",
    description: "Test adapter",
    connectionType: "local",
    fields: [],
    async test() {
      return { ok: true, message: "ok" };
    },
    async *run() {
      yield "done";
    },
  };
  engineMap.set(testAdapter.id, testAdapter);
  db.prepare("DELETE FROM runs WHERE schedule_id = 'mission-owned-schedule-test'").run();
  db.prepare("DELETE FROM schedules WHERE id = 'mission-owned-schedule-test'").run();
  db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-owned-schedule-mission-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'mission-owned-schedule-mission-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'mission-owned-schedule-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('mission-owned-schedule-agent-test', 'Mission Owned Schedule Agent', 'Operations', 'test-schedule-engine', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('mission-owned-schedule-mission-test', 'Mission owned schedule', 'planning', 'Marketing')
    `,
  ).run();
  db.prepare("INSERT INTO mission_agents (mission_id, agent_id) VALUES ('mission-owned-schedule-mission-test', 'mission-owned-schedule-agent-test')").run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, mission_id, agent_id, prompt, cron_expression, enabled, next_run_at, created_at)
    VALUES (
      'mission-owned-schedule-test',
      'Mission owned',
      'mission-owned-schedule-mission-test',
      'mission-owned-schedule-agent-test',
      'Run',
      '* * * * *',
      0,
      NULL,
      datetime('now')
    )
    `,
  ).run();

  try {
    const result = await triggerScheduleRun("mission-owned-schedule-test", "manual");

    assert.equal(result.run?.mission_id, "mission-owned-schedule-mission-test");
    assert.equal(result.run?.schedule_id, "mission-owned-schedule-test");
    const row = db.prepare("SELECT mission_id FROM runs WHERE schedule_id = 'mission-owned-schedule-test'").get() as {
      mission_id: string | null;
    };
    assert.deepEqual(row, { mission_id: "mission-owned-schedule-mission-test" });
  } finally {
    db.prepare("DELETE FROM runs WHERE schedule_id = 'mission-owned-schedule-test'").run();
    db.prepare("DELETE FROM schedules WHERE id = 'mission-owned-schedule-test'").run();
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'mission-owned-schedule-mission-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'mission-owned-schedule-mission-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'mission-owned-schedule-agent-test'").run();
    engineMap.delete(testAdapter.id);
  }
});

test("triggerScheduleRun rejects mission schedules whose agents are no longer staffed", async () => {
  const db = getDb();
  const testAdapter: EngineAdapter = {
    id: "test-unstaffed-schedule-engine",
    label: "Test Unstaffed Schedule Engine",
    description: "Test",
    connectionType: "local",
    fields: [],
    async test() {
      return { ok: true, message: "ok" };
    },
    async *run() {
      yield "done";
    },
  };
  engineMap.set(testAdapter.id, testAdapter);
  db.prepare("DELETE FROM runs WHERE schedule_id = 'unstaffed-owned-schedule-test'").run();
  db.prepare("DELETE FROM schedules WHERE id = 'unstaffed-owned-schedule-test'").run();
  db.prepare("DELETE FROM mission_agents WHERE mission_id = 'unstaffed-owned-schedule-mission-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'unstaffed-owned-schedule-mission-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'unstaffed-owned-schedule-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('unstaffed-owned-schedule-agent-test', 'Unstaffed Schedule Agent', 'Operations', 'test-unstaffed-schedule-engine', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('unstaffed-owned-schedule-mission-test', 'Unstaffed schedule mission', 'planning', 'Marketing')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, mission_id, agent_id, prompt, cron_expression, enabled, next_run_at, created_at)
    VALUES ('unstaffed-owned-schedule-test', 'Unstaffed owned', 'unstaffed-owned-schedule-mission-test', 'unstaffed-owned-schedule-agent-test', 'Run', '* * * * *', 0, NULL, datetime('now'))
    `,
  ).run();

  try {
    await assert.rejects(() => triggerScheduleRun("unstaffed-owned-schedule-test", "manual"), /Schedule agent is not assigned to this mission\./);

    const schedule = db.prepare("SELECT last_error FROM schedules WHERE id = 'unstaffed-owned-schedule-test'").get() as { last_error: string | null };
    assert.equal(schedule.last_error, "Schedule agent is not assigned to this mission.");
  } finally {
    db.prepare("DELETE FROM runs WHERE schedule_id = 'unstaffed-owned-schedule-test'").run();
    db.prepare("DELETE FROM schedules WHERE id = 'unstaffed-owned-schedule-test'").run();
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'unstaffed-owned-schedule-mission-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'unstaffed-owned-schedule-mission-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'unstaffed-owned-schedule-agent-test'").run();
    engineMap.delete(testAdapter.id);
  }
});

test("listDueScheduleIds limits each scheduler poll batch", () => {
  ensureScheduleTestAgent();
  const db = getDb();
  db.prepare("DELETE FROM schedules WHERE id LIKE 'due-schedule-%'").run();
  const insert = db.prepare(
    `
    INSERT INTO schedules (id, name, agent_id, prompt, cron_expression, enabled, next_run_at, created_at)
    VALUES (?, ?, 'schedule-test-agent', 'Run', '* * * * *', 1, datetime('now', '-1 minute'), datetime('now', ?))
    `,
  );
  const transaction = db.transaction(() => {
    for (let index = 0; index < DUE_SCHEDULE_POLL_LIMIT + 5; index++) {
      insert.run(`due-schedule-${String(index).padStart(3, "0")}`, `Due ${index}`, `-${DUE_SCHEDULE_POLL_LIMIT + 5 - index} minutes`);
    }
  });
  transaction();

  try {
    const ids = listDueScheduleIds();
    assert.equal(ids.length, DUE_SCHEDULE_POLL_LIMIT);
    assert.equal(ids[0], "due-schedule-000");
    assert.equal(ids.at(-1), `due-schedule-${String(DUE_SCHEDULE_POLL_LIMIT - 1).padStart(3, "0")}`);
    assert.deepEqual(listDueScheduleIds(2), ["due-schedule-000", "due-schedule-001"]);
  } finally {
    db.prepare("DELETE FROM schedules WHERE id LIKE 'due-schedule-%'").run();
  }
});
