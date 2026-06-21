import { getDb } from "./db.js";
import {
  serializeAgent,
  serializeIssue,
  serializeMission,
  serializeRun,
  serializeSchedule,
} from "./serializers.js";

export function parseListSearchTerm(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  return `%${raw.slice(0, 100).replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

export function parseListLimit(value: string | undefined, options: { defaultLimit: number; maxLimit: number }): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return options.defaultLimit;
  }
  return Math.min(parsed, options.maxLimit);
}

export function listAgents(filters: { limit?: number | undefined } = {}) {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT agents.*, agent_positions.x AS pos_x, agent_positions.y AS pos_y
      FROM agents
      LEFT JOIN agent_positions ON agent_positions.agent_id = agents.id
      ORDER BY agents.created_at ASC
      ${filters.limit ? "LIMIT ?" : ""}
      `,
    )
    .all(...(filters.limit ? [filters.limit] : []))
    .map((row) => serializeAgent(row as Record<string, unknown>));
}

export function getAgentById(id: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT agents.*, agent_positions.x AS pos_x, agent_positions.y AS pos_y
      FROM agents
      LEFT JOIN agent_positions ON agent_positions.agent_id = agents.id
      WHERE agents.id = ?
      `,
    )
    .get(id) as Record<string, unknown> | undefined;

  return row ? serializeAgent(row) : null;
}

export function listMissions(filters: { teamName?: string | undefined; limit?: number | undefined } = {}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.teamName) {
    conditions.push("missions.team_name = ?");
    params.push(filters.teamName);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const missions = db
    .prepare(
      `
      SELECT
        missions.*,
        lead.name AS lead_agent_name,
        lead.emoji AS lead_agent_emoji,
        COUNT(DISTINCT issues.id) AS total_issues,
        COUNT(DISTINCT CASE WHEN issues.status = 'done' OR issues.status = 'complete' THEN issues.id END) AS done_issues,
        MAX(runs.started_at) AS last_active_at
      FROM missions
      LEFT JOIN agents AS lead ON lead.id = missions.lead_agent_id
      LEFT JOIN issues ON issues.mission_id = missions.id
      LEFT JOIN runs ON runs.mission_id = missions.id
      ${where}
      GROUP BY missions.id
      ORDER BY missions.updated_at DESC
      ${filters.limit ? "LIMIT ?" : ""}
      `,
    )
    .all(...params, ...(filters.limit ? [filters.limit] : [])) as Array<Record<string, unknown>>;

  if (missions.length === 0) {
    return [];
  }

  const missionIds = missions.map((row) => String(row.id));
  const placeholders = missionIds.map(() => "?").join(", ");
  const assignments = db
    .prepare(
      `
      SELECT mission_agents.mission_id, agents.id, agents.name, agents.role, agents.emoji, agents.color
      FROM mission_agents
      JOIN agents ON agents.id = mission_agents.agent_id
      WHERE mission_agents.mission_id IN (${placeholders})
      ORDER BY agents.name COLLATE NOCASE
      `,
    )
    .all(...missionIds) as Array<Record<string, unknown>>;

  const assignmentMap = new Map<string, Array<Record<string, unknown>>>();
  for (const row of assignments) {
    const bucket = assignmentMap.get(String(row.mission_id)) ?? [];
    bucket.push({
      id: row.id,
      name: row.name,
      role: row.role,
      emoji: row.emoji,
      color: row.color,
    });
    assignmentMap.set(String(row.mission_id), bucket);
  }

  return missions.map((row) => serializeMission(row, assignmentMap.get(String(row.id)) ?? []));
}

export function getMissionById(id: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        missions.*,
        lead.name AS lead_agent_name,
        lead.emoji AS lead_agent_emoji,
        COUNT(DISTINCT issues.id) AS total_issues,
        COUNT(DISTINCT CASE WHEN issues.status = 'done' OR issues.status = 'complete' THEN issues.id END) AS done_issues,
        MAX(runs.started_at) AS last_active_at
      FROM missions
      LEFT JOIN agents AS lead ON lead.id = missions.lead_agent_id
      LEFT JOIN issues ON issues.mission_id = missions.id
      LEFT JOIN runs ON runs.mission_id = missions.id
      WHERE missions.id = ?
      GROUP BY missions.id
      `,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }

  const assignments = db
    .prepare(
      `
      SELECT agents.id, agents.name, agents.role, agents.emoji, agents.color
      FROM mission_agents
      JOIN agents ON agents.id = mission_agents.agent_id
      WHERE mission_agents.mission_id = ?
      ORDER BY agents.name COLLATE NOCASE
      `,
    )
    .all(id) as Array<Record<string, unknown>>;

  return serializeMission(row, assignments);
}

export function listIssues(filters: {
  status?: string | undefined;
  assignee?: string | undefined;
  missionId?: string | undefined;
  q?: string | undefined;
  priority?: string | undefined;
  limit?: number | undefined;
}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("issues.status = ?");
    params.push(filters.status);
  }
  if (filters.assignee) {
    conditions.push("issues.assignee_agent_id = ?");
    params.push(filters.assignee);
  }
  if (filters.missionId) {
    conditions.push("issues.mission_id = ?");
    params.push(filters.missionId);
  }
  if (filters.priority) {
    conditions.push("issues.priority = ?");
    params.push(filters.priority);
  }
  const issueSearchTerm = parseListSearchTerm(filters.q);
  if (issueSearchTerm) {
    conditions.push("(issues.title LIKE ? ESCAPE '\\' OR issues.description LIKE ? ESCAPE '\\')");
    params.push(issueSearchTerm, issueSearchTerm);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(
      `
      SELECT
        issues.*,
        assignee.name AS assignee_name,
        assignee.emoji AS assignee_emoji,
        missions.title AS mission_title,
        missions.color AS mission_color
      FROM issues
      LEFT JOIN agents AS assignee ON assignee.id = issues.assignee_agent_id
      LEFT JOIN missions ON missions.id = issues.mission_id
      ${where}
      ORDER BY issues.updated_at DESC
      ${filters.limit ? "LIMIT ?" : ""}
      `,
    )
    .all(...params, ...(filters.limit ? [filters.limit] : []))
    .map((row) => serializeIssue(row as Record<string, unknown>));
}

export function getIssueById(id: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        issues.*,
        assignee.name AS assignee_name,
        assignee.emoji AS assignee_emoji,
        missions.title AS mission_title,
        missions.color AS mission_color
      FROM issues
      LEFT JOIN agents AS assignee ON assignee.id = issues.assignee_agent_id
      LEFT JOIN missions ON missions.id = issues.mission_id
      WHERE issues.id = ?
      `,
    )
    .get(id) as Record<string, unknown> | undefined;

  return row ? serializeIssue(row) : null;
}

export function listRuns(filters: {
  agentId?: string | undefined;
  missionId?: string | undefined;
  issueId?: string | undefined;
  status?: string | undefined;
  q?: string | undefined;
  parentRunId?: string | undefined;
  limit?: number | undefined;
}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.agentId) {
    conditions.push("runs.agent_id = ?");
    params.push(filters.agentId);
  }
  if (filters.missionId) {
    conditions.push("runs.mission_id = ?");
    params.push(filters.missionId);
  }
  if (filters.issueId) {
    conditions.push("runs.issue_id = ?");
    params.push(filters.issueId);
  }
  if (filters.status) {
    conditions.push("runs.status = ?");
    params.push(filters.status);
  }
  const runSearchTerm = parseListSearchTerm(filters.q);
  if (runSearchTerm) {
    conditions.push("(runs.prompt LIKE ? ESCAPE '\\' OR runs.output LIKE ? ESCAPE '\\')");
    params.push(runSearchTerm, runSearchTerm);
  }
  if (filters.parentRunId) {
    conditions.push("runs.parent_run_id = ?");
    params.push(filters.parentRunId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(
      `
      SELECT
        runs.*,
        agents.name AS agent_name,
        agents.emoji AS agent_emoji,
        agents.color AS agent_color,
        missions.title AS mission_title,
        issues.title AS issue_title
      FROM runs
      LEFT JOIN agents ON agents.id = runs.agent_id
      LEFT JOIN missions ON missions.id = runs.mission_id
      LEFT JOIN issues ON issues.id = runs.issue_id
      ${where}
      ORDER BY runs.started_at DESC
      ${filters.limit ? "LIMIT ?" : ""}
      `,
    )
    .all(...params, ...(filters.limit ? [filters.limit] : []))
    .map((row) => serializeRun(row as Record<string, unknown>));
}

export function getRunById(id: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        runs.*,
        agents.name AS agent_name,
        agents.emoji AS agent_emoji,
        agents.color AS agent_color,
        missions.title AS mission_title,
        issues.title AS issue_title
      FROM runs
      LEFT JOIN agents ON agents.id = runs.agent_id
      LEFT JOIN missions ON missions.id = runs.mission_id
      LEFT JOIN issues ON issues.id = runs.issue_id
      WHERE runs.id = ?
      `,
    )
    .get(id) as Record<string, unknown> | undefined;

  return row ? serializeRun(row) : null;
}

export function listSchedules(filters: { limit?: number | undefined; missionId?: string | undefined } = {}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.missionId) {
    conditions.push("schedules.mission_id = ?");
    params.push(filters.missionId);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = filters.limit ? "LIMIT ?" : "";
  if (filters.limit) {
    params.push(filters.limit);
  }
  return db
    .prepare(
      `
      SELECT
        schedules.*,
        agents.name AS agent_name,
        agents.emoji AS agent_emoji,
        missions.title AS mission_title,
        missions.color AS mission_color
      FROM schedules
      JOIN agents ON agents.id = schedules.agent_id
      LEFT JOIN missions ON missions.id = schedules.mission_id
      ${whereClause}
      ORDER BY
        schedules.enabled DESC,
        CASE WHEN schedules.next_run_at IS NULL THEN 1 ELSE 0 END,
        schedules.next_run_at ASC,
        schedules.created_at DESC
      ${limitClause}
      `,
    )
    .all(...params)
    .map((row) => serializeSchedule(row as Record<string, unknown>));
}

export function getScheduleById(id: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        schedules.*,
        agents.name AS agent_name,
        agents.emoji AS agent_emoji,
        missions.title AS mission_title,
        missions.color AS mission_color
      FROM schedules
      JOIN agents ON agents.id = schedules.agent_id
      LEFT JOIN missions ON missions.id = schedules.mission_id
      WHERE schedules.id = ?
      `,
    )
    .get(id) as Record<string, unknown> | undefined;

  return row ? serializeSchedule(row) : null;
}
