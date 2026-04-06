import { asFlag, getDb } from "./db.js";
import { getNextRunAt, validateCronExpression } from "./schedules.js";
import { createRunRecord } from "./execution.js";
import { listRuns, listSchedules } from "./queries.js";

const activeScheduledRuns = new Set<string>();
let scheduleLoopTimer: NodeJS.Timeout | null = null;
let scheduleLoopInFlight = false;

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

  return numeric;
}

export function parseScheduleInput(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const cronExpression = typeof body.cron_expression === "string" ? body.cron_expression.trim() : "";
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
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

  const cronError = validateCronExpression(cronExpression);
  if (cronError) {
    throw new Error(cronError);
  }

  return { name, agentId, prompt, cronExpression, enabled, maxRuns };
}

export async function triggerScheduleRun(scheduleId: string, reason: "cron" | "manual") {
  const db = getDb();
  const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Schedule not found.");
  }

  const isEnabled = asFlag(typeof row.enabled === "number" ? row.enabled : 0);
  const cronExpression = String(row.cron_expression ?? "");
  const maxRuns = typeof row.max_runs === "number" ? row.max_runs : null;
  const runCount = Number(row.run_count ?? 0);

  if (reason === "cron" && !isEnabled) {
    return { run: null, schedule: listSchedules().find((entry) => entry.id === scheduleId) ?? null };
  }

  if (maxRuns !== null && runCount >= maxRuns) {
    db.prepare(
      `
      UPDATE schedules
      SET enabled = 0, next_run_at = NULL, updated_at = datetime('now')
      WHERE id = ?
      `,
    ).run(scheduleId);
    return { run: null, schedule: listSchedules().find((entry) => entry.id === scheduleId) ?? null };
  }

  try {
    const runId = await createRunRecord({
      agentId: String(row.agent_id),
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
      run: listRuns({}).find((item) => item.id === runId) ?? null,
      schedule: listSchedules().find((entry) => entry.id === scheduleId) ?? null,
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

async function pollSchedules(): Promise<void> {
  if (scheduleLoopInFlight) {
    return;
  }

  scheduleLoopInFlight = true;
  try {
    const dueSchedules = getDb()
      .prepare(
        `
        SELECT id
        FROM schedules
        WHERE enabled = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= datetime('now')
        ORDER BY next_run_at ASC
        `,
      )
      .all() as Array<{ id: string }>;

    for (const schedule of dueSchedules) {
      if (activeScheduledRuns.has(schedule.id)) {
        continue;
      }
      activeScheduledRuns.add(schedule.id);
      try {
        await triggerScheduleRun(schedule.id, "cron");
      } catch (error) {
        console.error(`[schedules] Failed to trigger ${schedule.id}:`, error);
      } finally {
        activeScheduledRuns.delete(schedule.id);
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
