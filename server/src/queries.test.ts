import assert from "node:assert/strict";
import { test } from "node:test";
import { resetDatabase } from "./db.js";
import {
  getAgentById,
  getIssueById,
  getMissionById,
  getRunById,
  getScheduleById,
  listAgents,
  listIssues,
  listMissions,
  listSchedules,
  parseListLimit,
  parseListSearchTerm,
} from "./queries.js";

test("parseListSearchTerm trims and wraps terms for LIKE", () => {
  assert.equal(parseListSearchTerm("  deploy  "), "%deploy%");
});

test("parseListSearchTerm limits long terms", () => {
  assert.equal(parseListSearchTerm("x".repeat(150)), `%${"x".repeat(100)}%`);
});

test("parseListSearchTerm escapes sqlite LIKE wildcard characters", () => {
  assert.equal(parseListSearchTerm(String.raw`100%_done\ok`), String.raw`%100\%\_done\\ok%`);
});

test("parseListSearchTerm ignores blank terms", () => {
  assert.equal(parseListSearchTerm(undefined), null);
  assert.equal(parseListSearchTerm("   "), null);
});

test("parseListLimit defaults invalid values and caps oversized requests", () => {
  assert.equal(parseListLimit(undefined, { defaultLimit: 200, maxLimit: 1_000 }), 200);
  assert.equal(parseListLimit("0", { defaultLimit: 200, maxLimit: 1_000 }), 200);
  assert.equal(parseListLimit("50", { defaultLimit: 200, maxLimit: 1_000 }), 50);
  assert.equal(parseListLimit("5000", { defaultLimit: 200, maxLimit: 1_000 }), 1_000);
});

test("single-record query helpers return joined serialized records without scanning lists", () => {
  const db = resetDatabase();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('agent-query', 'Query Agent', 'Lead', 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare("INSERT INTO agent_positions (agent_id, x, y) VALUES ('agent-query', 12, 24)").run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name, lead_agent_id)
    VALUES ('mission-query', 'Scale Mission', 'planning', 'Finance', 'agent-query')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('mission-marketing', 'Marketing Mission', 'planning', 'Marketing')
    `,
  ).run();
  db.prepare("INSERT INTO mission_agents (mission_id, agent_id) VALUES ('mission-query', 'agent-query')").run();
  db.prepare(
    `
    INSERT INTO issues (id, title, status, priority, assignee_agent_id, mission_id)
    VALUES ('issue-query', 'Scale Issue', 'todo', 'high', 'agent-query', 'mission-query')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO issues (id, title, status, priority, mission_id, updated_at)
    VALUES ('issue-marketing', 'Marketing Issue', 'todo', 'medium', 'mission-marketing', datetime('now', '+1 minute'))
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, engine, status, prompt, output, tool_calls)
    VALUES ('run-query', 'agent-query', 'mission-query', 'issue-query', 'codex', 'running', 'prompt', '', '[]')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, agent_id, prompt, cron_expression)
    VALUES ('schedule-query', 'Daily scale check', 'agent-query', 'prompt', '* * * * *')
    `,
  ).run();

  assert.equal(getAgentById("agent-query")?.position.x, 12);
  assert.equal(getMissionById("mission-query")?.team_name, "Finance");
  assert.equal(getMissionById("mission-query")?.assigned_agents.length, 1);
  assert.equal(getIssueById("issue-query")?.mission_title, "Scale Mission");
  assert.deepEqual(listIssues({ limit: 1 }).map((issue) => issue.id), ["issue-marketing"]);
  assert.equal(getRunById("run-query")?.agent_name, "Query Agent");
  assert.equal(getScheduleById("schedule-query")?.agent_name, "Query Agent");
  assert.deepEqual(listMissions({ teamName: "Finance" }).map((mission) => mission.id), ["mission-query"]);
  assert.equal(getRunById("missing-run"), null);
});

test("listAgents applies database limits", () => {
  const db = resetDatabase();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active, created_at)
    VALUES ('agent-a', 'Agent A', 'Lead', 'codex', '[]', '[]', 1, datetime('now', '-2 minutes'))
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active, created_at)
    VALUES ('agent-b', 'Agent B', 'Lead', 'codex', '[]', '[]', 1, datetime('now', '-1 minute'))
    `,
  ).run();

  assert.deepEqual(listAgents({ limit: 1 }).map((agent) => agent.id), ["agent-a"]);
});

test("listMissions applies database limits", () => {
  const db = resetDatabase();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name, updated_at)
    VALUES ('mission-new', 'New Mission', 'planning', 'Engineering', datetime('now'))
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name, updated_at)
    VALUES ('mission-old', 'Old Mission', 'planning', 'Engineering', datetime('now', '-1 minute'))
    `,
  ).run();

  assert.deepEqual(listMissions({ limit: 1 }).map((mission) => mission.id), ["mission-new"]);
});

test("listSchedules applies database limits", () => {
  const db = resetDatabase();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('agent-schedule', 'Schedule Agent', 'Lead', 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, agent_id, prompt, cron_expression, enabled, next_run_at, created_at)
    VALUES ('schedule-a', 'A', 'agent-schedule', 'prompt', '* * * * *', 1, datetime('now', '+1 minute'), datetime('now', '-2 minutes'))
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, agent_id, prompt, cron_expression, enabled, next_run_at, created_at)
    VALUES ('schedule-b', 'B', 'agent-schedule', 'prompt', '* * * * *', 1, datetime('now', '+2 minutes'), datetime('now', '-1 minute'))
    `,
  ).run();

  assert.deepEqual(listSchedules({ limit: 1 }).map((schedule) => schedule.id), ["schedule-a"]);
});

test("listSchedules filters by mission", () => {
  const db = resetDatabase();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, skills, tools, active)
    VALUES ('agent-schedule-filter', 'Schedule Agent', 'Lead', 'codex', '[]', '[]', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES
      ('schedule-filter-finance', 'Finance Mission', 'planning', 'Finance'),
      ('schedule-filter-sales', 'Sales Mission', 'planning', 'Sales')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO schedules (id, name, mission_id, agent_id, prompt, cron_expression, enabled)
    VALUES
      ('schedule-finance', 'Finance schedule', 'schedule-filter-finance', 'agent-schedule-filter', 'prompt', '* * * * *', 1),
      ('schedule-sales', 'Sales schedule', 'schedule-filter-sales', 'agent-schedule-filter', 'prompt', '* * * * *', 1),
      ('schedule-global', 'Global schedule', NULL, 'agent-schedule-filter', 'prompt', '* * * * *', 1)
    `,
  ).run();

  assert.deepEqual(listSchedules({ missionId: "schedule-filter-finance" }).map((schedule) => schedule.id), ["schedule-finance"]);
});
