import { asFlag, getDb } from "./db.js";
import { engineMap } from "./engines/index.js";
import { getNextRunAt, validateCronExpression } from "./schedules.js";
import { createRunRecord } from "./execution.js";
import { getRunById, getScheduleById } from "./queries.js";

const activeScheduledRuns = new Set<string>();
let scheduleLoopTimer: NodeJS.Timeout | null = null;
let scheduleLoopInFlight = false;

const MAX_SCHEDULE_NAME_LENGTH = 120;
const MAX_SCHEDULE_PROMPT_LENGTH = 20_000;
const MAX_SCHEDULE_CRON_LENGTH = 120;
const MAX_SCHEDULE_RUN_LIMIT = 1_000_000;
export const DUE_SCHEDULE_POLL_LIMIT = 100;
type ScheduleAgentValidationResult = { ok: true } | { ok: false; status: number; error: string };

function formatSqliteDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function computeNextRunAt(expression: string, from: Date): string | null {
  const next = getNextRunAt(expression, from);
  return next ? formatSqliteDateTime(next) : null;
}

export function normalizeScheduleMaxRuns(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error("max_runs must be a positive whole number.");
  }
  if (numeric > MAX_SCHEDULE_RUN_LIMIT) {
    throw new Error(`max_runs must be ${MAX_SCHEDULE_RUN_LIMIT} or fewer.`);
  }

  return numeric;
}

export function normalizeScheduleEnabled(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return Boolean(value);
}

export function parseScheduleInput(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const missionId = typeof body.mission_id === "string" && body.mission_id.trim() ? body.mission_id.trim() : null;
  const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const cronExpression = typeof body.cron_expression === "string" ? body.cron_expression.trim() : "";
  const enabled = normalizeScheduleEnabled(body.enabled);
  const maxRuns = normalizeScheduleMaxRuns(body.max_runs);

  if (!name) {
    throw new Error("Schedule name is required.");
  }
  if (!agentId) {
    throw new Error("agent_id is required.");
  }
  if (!prompt) {
    throw new Error("prompt is required.");
  }
  if (!cronExpression) {
    throw new Error("cron_expression is required.");
  }
  if (name.length > MAX_SCHEDULE_NAME_LENGTH) {
    throw new Error(`Schedule name must be ${MAX_SCHEDULE_NAME_LENGTH} characters or fewer.`);
  }
  if (prompt.length > MAX_SCHEDULE_PROMPT_LENGTH) {
    throw new Error(`prompt must be ${MAX_SCHEDULE_PROMPT_LENGTH} characters or fewer.`);
  }
  if (cronExpression.length > MAX_SCHEDULE_CRON_LENGTH) {
    throw new Error(`cron_expression must be ${MAX_SCHEDULE_CRON_LENGTH} characters or fewer.`);
  }

  const cronError = validateCronExpression(cronExpression);
  if (cronError) {
    throw new Error(cronError);
  }

  return { name, missionId, agentId, prompt, cronExpression, enabled, maxRuns };
}

export function validateScheduleAgent(input: {
  agentExists: boolean;
  agentActive: boolean;
  agentEngineSupported: boolean;
  agentAssignedToMission?: boolean | undefined;
}): ScheduleAgentValidationResult {
  if (!input.agentExists) {
    return { ok: false, status: 404, error: "Agent not found." };
  }
  if (!input.agentActive) {
    return { ok: false, status: 409, error: "Schedule agent is inactive." };
  }
  if (!input.agentEngineSupported) {
    return { ok: false, status: 409, error: "Schedule agent engine is not supported." };
  }
  if (input.agentAssignedToMission === false) {
    return { ok: false, status: 409, error: "Schedule agent is not assigned to this mission." };
  }
  return { ok: true };
}

export async function triggerScheduleRun(scheduleId: string, reason: "cron" | "manual") {
  const db = getDb();
  const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as Record<string, unknown> | undefined;
  if (!row) {
    return { run: null, schedule: null };
  }

  const isEnabled = asFlag(typeof row.enabled === "number" ? row.enabled : 0);
  const cronExpression = String(row.cron_expression ?? "");
  const maxRuns = typeof row.max_runs === "number" ? row.max_runs : null;
  const runCount = Number(row.run_count ?? 0);

  if (reason === "cron" && !isEnabled) {
    return { run: null, schedule: getScheduleById(scheduleId) };
  }

  if (reason === "cron" && maxRuns !== null && runCount >= maxRuns) {
    db.prepare(
      `
      UPDATE schedules
      SET enabled = 0, next_run_at = NULL, updated_at = datetime('now')
      WHERE id = ?
      `,
    ).run(scheduleId);
    return { run: null, schedule: getScheduleById(scheduleId) };
  }

  try {
    const agent = db.prepare("SELECT active, engine FROM agents WHERE id = ?").get(String(row.agent_id)) as
      | { active: number | null; engine: string | null }
      | undefined;
    const missionId = typeof row.mission_id === "string" ? row.mission_id : null;
    const agentAssignedToMission = missionId
      ? Boolean(db.prepare("SELECT 1 FROM mission_agents WHERE mission_id = ? AND agent_id = ?").get(missionId, String(row.agent_id)))
      : undefined;
    const agentValidation = validateScheduleAgent({
      agentExists: Boolean(agent),
      agentActive: agent?.active === 1,
      agentEngineSupported: agent ? engineMap.has(String(agent.engine)) : false,
      agentAssignedToMission,
    });
    if (!agentValidation.ok) {
      throw new Error(agentValidation.error);
    }

    const runId = await createRunRecord({
      agentId: String(row.agent_id),
      missionId,
      prompt: String(row.prompt ?? ""),
      scheduleId,
    });
    const nextRunCount = runCount + 1;
    const reachedLimit = maxRuns !== null && nextRunCount >= maxRuns;
    const nextEnabled = reachedLimit ? false : isEnabled;
    const nextRunAt = nextEnabled ? computeNextRunAt(cronExpression, new Date()) : null;

    db.prepare(
      `
      UPDATE schedules
      SET
        run_count = ?,
        last_run_at = datetime('now'),
        next_run_at = ?,
        last_error = NULL,
        enabled = ?,
        updated_at = datetime('now')
      WHERE id = ?
      `,
    ).run(nextRunCount, nextRunAt, nextEnabled ? 1 : 0, scheduleId);

    return {
      run: getRunById(runId),
      schedule: getScheduleById(scheduleId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start scheduled run.";
    const nextRunAt = isEnabled ? computeNextRunAt(cronExpression, new Date()) : null;
    db.prepare(
      `
      UPDATE schedules
      SET next_run_at = ?, last_error = ?, updated_at = datetime('now')
      WHERE id = ?
      `,
    ).run(nextRunAt, message, scheduleId);
    throw error;
  }
}

export function listDueScheduleIds(limit = DUE_SCHEDULE_POLL_LIMIT): string[] {
  return (getDb()
    .prepare(
      `
      SELECT id
      FROM schedules
      WHERE enabled = 1
        AND next_run_at IS NOT NULL
        AND next_run_at <= datetime('now')
      ORDER BY next_run_at ASC
      LIMIT ?
      `,
    )
    .all(limit) as Array<{ id: string }>).map((schedule) => schedule.id);
}

async function pollSchedules(): Promise<void> {
  if (scheduleLoopInFlight) {
    return;
  }

  scheduleLoopInFlight = true;
  try {
    for (const scheduleId of listDueScheduleIds()) {
      if (activeScheduledRuns.has(scheduleId)) {
        continue;
      }
      activeScheduledRuns.add(scheduleId);
      try {
        await triggerScheduleRun(scheduleId, "cron");
      } catch (error) {
        console.error(`[schedules] Failed to trigger ${scheduleId}:`, error);
      } finally {
        activeScheduledRuns.delete(scheduleId);
      }
    }
  } finally {
    scheduleLoopInFlight = false;
  }
}

export function startScheduleLoop(): void {
  if (scheduleLoopTimer) {
    clearInterval(scheduleLoopTimer);
  }
  scheduleLoopTimer = setInterval(() => {
    void pollSchedules();
  }, 30_000);
  void pollSchedules();
}
