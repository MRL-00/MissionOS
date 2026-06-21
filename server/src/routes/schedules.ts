import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getDb } from "../db.js";
import { engineMap } from "../engines/index.js";
import { getScheduleById, listSchedules, parseListLimit } from "../queries.js";
import { computeNextRunAt, parseScheduleInput, triggerScheduleRun, validateScheduleAgent } from "../scheduling.js";

const DEFAULT_SCHEDULE_LIST_LIMIT = 500;
const MAX_SCHEDULE_LIST_LIMIT = 1_000;
const MAX_SCHEDULE_FILTER_LENGTH = 120;

type ScheduleDeleteInput = {
  activeRunCount: number;
};
type ScheduleDeleteResult = { ok: true } | { ok: false; status: number; error: string };
type ScheduleMissionUpdateInput = {
  missionChanged: boolean;
  activeRunCount: number;
};
type ScheduleMissionUpdateResult = { ok: true } | { ok: false; status: number; error: string };

function optionalFilterString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_SCHEDULE_FILTER_LENGTH) : undefined;
}

export function parseScheduleListQuery(query: Record<string, unknown>) {
  return {
    missionId: optionalFilterString(query.mission_id),
    limit: parseListLimit(typeof query.limit === "string" ? query.limit : undefined, {
      defaultLimit: DEFAULT_SCHEDULE_LIST_LIMIT,
      maxLimit: MAX_SCHEDULE_LIST_LIMIT,
    }),
  };
}

export function validateScheduleDeletion(input: ScheduleDeleteInput): ScheduleDeleteResult {
  if (input.activeRunCount > 0) {
    return {
      ok: false,
      status: 409,
      error: "Schedule has active runs. Wait for them to finish before deleting it.",
    };
  }
  return { ok: true };
}

export function validateScheduleMissionUpdate(input: ScheduleMissionUpdateInput): ScheduleMissionUpdateResult {
  if (input.missionChanged && input.activeRunCount > 0) {
    return {
      ok: false,
      status: 409,
      error: "Schedule has active runs. Wait for them to finish before changing its mission.",
    };
  }
  return { ok: true };
}

export function registerScheduleRoutes(app: Express) {
  app.get("/api/schedules", (req, res) => {
    const filters = parseScheduleListQuery(req.query);
    res.json({ schedules: listSchedules(filters) });
  });

  app.post("/api/schedules", (req, res) => {
    try {
      const input = parseScheduleInput(req.body as Record<string, unknown>);
      const agent = getDb().prepare("SELECT active, engine FROM agents WHERE id = ?").get(input.agentId) as
        | { active: number | null; engine: string | null }
        | undefined;
      const agentValidation = validateScheduleAgent({
        agentExists: Boolean(agent),
        agentActive: agent?.active === 1,
        agentEngineSupported: agent ? engineMap.has(String(agent.engine)) : false,
      });
      if (!agentValidation.ok) {
        res.status(agentValidation.status).json({ error: agentValidation.error });
        return;
      }
      if (input.missionId && !getDb().prepare("SELECT 1 FROM missions WHERE id = ?").get(input.missionId)) {
        res.status(404).json({ error: "Mission not found." });
        return;
      }
      const agentAssignedToMission = input.missionId
        ? Boolean(getDb().prepare("SELECT 1 FROM mission_agents WHERE mission_id = ? AND agent_id = ?").get(input.missionId, input.agentId))
        : undefined;
      const missionAssignmentValidation = validateScheduleAgent({
        agentExists: Boolean(agent),
        agentActive: agent?.active === 1,
        agentEngineSupported: agent ? engineMap.has(String(agent.engine)) : false,
        agentAssignedToMission,
      });
      if (!missionAssignmentValidation.ok) {
        res.status(missionAssignmentValidation.status).json({ error: missionAssignmentValidation.error });
        return;
      }

      const schedule = {
        id: randomUUID(),
        name: input.name,
        mission_id: input.missionId,
        agent_id: input.agentId,
        prompt: input.prompt,
        cron_expression: input.cronExpression,
        enabled: input.enabled,
        max_runs: input.maxRuns,
        next_run_at: input.enabled ? computeNextRunAt(input.cronExpression, new Date()) : null,
      };

      getDb().prepare(
        `
        INSERT INTO schedules (
          id, name, mission_id, agent_id, prompt, cron_expression, enabled, max_runs, next_run_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `,
      ).run(
        schedule.id,
        schedule.name,
        schedule.mission_id,
        schedule.agent_id,
        schedule.prompt,
        schedule.cron_expression,
        schedule.enabled ? 1 : 0,
        schedule.max_runs,
        schedule.next_run_at,
      );

      res.status(201).json({ schedule: getScheduleById(schedule.id) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid schedule payload." });
    }
  });

  app.put("/api/schedules/:id", (req, res) => {
    const existing = getDb().prepare("SELECT * FROM schedules WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: "Schedule not found." });
      return;
    }

    try {
      const input = parseScheduleInput(req.body as Record<string, unknown>);
      const agent = getDb().prepare("SELECT active, engine FROM agents WHERE id = ?").get(input.agentId) as
        | { active: number | null; engine: string | null }
        | undefined;
      const agentValidation = validateScheduleAgent({
        agentExists: Boolean(agent),
        agentActive: agent?.active === 1,
        agentEngineSupported: agent ? engineMap.has(String(agent.engine)) : false,
      });
      if (!agentValidation.ok) {
        res.status(agentValidation.status).json({ error: agentValidation.error });
        return;
      }
      if (input.missionId && !getDb().prepare("SELECT 1 FROM missions WHERE id = ?").get(input.missionId)) {
        res.status(404).json({ error: "Mission not found." });
        return;
      }
      const agentAssignedToMission = input.missionId
        ? Boolean(getDb().prepare("SELECT 1 FROM mission_agents WHERE mission_id = ? AND agent_id = ?").get(input.missionId, input.agentId))
        : undefined;
      const missionAssignmentValidation = validateScheduleAgent({
        agentExists: Boolean(agent),
        agentActive: agent?.active === 1,
        agentEngineSupported: agent ? engineMap.has(String(agent.engine)) : false,
        agentAssignedToMission,
      });
      if (!missionAssignmentValidation.ok) {
        res.status(missionAssignmentValidation.status).json({ error: missionAssignmentValidation.error });
        return;
      }

      const currentMissionId = typeof existing.mission_id === "string" ? existing.mission_id : null;
      const activeRuns = getDb().prepare(
        "SELECT COUNT(*) AS count FROM runs WHERE schedule_id = ? AND status IN ('running', 'planning')",
      ).get(req.params.id) as { count: number };
      const missionUpdateValidation = validateScheduleMissionUpdate({
        missionChanged: currentMissionId !== input.missionId,
        activeRunCount: activeRuns.count,
      });
      if (!missionUpdateValidation.ok) {
        res.status(missionUpdateValidation.status).json({ error: missionUpdateValidation.error });
        return;
      }

      const runCount = Number(existing.run_count ?? 0);
      const reachedLimit = input.maxRuns !== null && runCount >= input.maxRuns;
      const enabled = input.enabled && !reachedLimit;
      const nextRunAt = enabled ? computeNextRunAt(input.cronExpression, new Date()) : null;
      const limitError = reachedLimit ? "Run limit reached. Increase max runs or run manually." : null;

      const db = getDb();
      db.transaction(() => {
        db.prepare(
          `
          UPDATE schedules
          SET
            name = ?,
            mission_id = ?,
            agent_id = ?,
            prompt = ?,
            cron_expression = ?,
            enabled = ?,
            max_runs = ?,
            next_run_at = ?,
            last_error = ?,
            updated_at = datetime('now')
          WHERE id = ?
          `,
        ).run(
          input.name,
          input.missionId,
          input.agentId,
          input.prompt,
          input.cronExpression,
          enabled ? 1 : 0,
          input.maxRuns,
          nextRunAt,
          limitError,
          req.params.id,
        );
        db.prepare("UPDATE runs SET mission_id = ? WHERE schedule_id = ?").run(input.missionId, req.params.id);
        db.prepare(
          `
          UPDATE agent_messages
          SET mission_id = ?
          WHERE run_id IN (SELECT id FROM runs WHERE schedule_id = ?)
          `,
        ).run(input.missionId, req.params.id);
      })();

      res.json({ schedule: getScheduleById(req.params.id) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid schedule payload." });
    }
  });

  app.delete("/api/schedules/:id", (req, res) => {
    const db = getDb();
    const existing = db.prepare("SELECT id FROM schedules WHERE id = ?").get(req.params.id) as { id: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: "Schedule not found." });
      return;
    }

    const activeRuns = db.prepare(
      "SELECT COUNT(*) AS count FROM runs WHERE schedule_id = ? AND status IN ('running', 'planning')",
    ).get(req.params.id) as { count: number };
    const validation = validateScheduleDeletion({ activeRunCount: activeRuns.count });
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    db.transaction(() => {
      db.prepare("UPDATE runs SET schedule_id = NULL WHERE schedule_id = ?").run(req.params.id);
      db.prepare("DELETE FROM schedules WHERE id = ?").run(req.params.id);
    })();

    res.json({ ok: true });
  });

  app.post("/api/schedules/:id/run", async (req, res) => {
    try {
      const result = await triggerScheduleRun(req.params.id, "manual");
      if (!result.schedule) {
        res.status(404).json({ error: "Schedule not found." });
        return;
      }
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to run schedule." });
    }
  });
}
