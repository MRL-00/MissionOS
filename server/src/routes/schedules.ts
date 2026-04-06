import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getDb } from "../db.js";
import { listSchedules } from "../queries.js";
import { computeNextRunAt, parseScheduleInput, triggerScheduleRun } from "../scheduling.js";

export function registerScheduleRoutes(app: Express) {
  app.get("/api/schedules", (_req, res) => {
    res.json({ schedules: listSchedules() });
  });

  app.post("/api/schedules", (req, res) => {
    try {
      const input = parseScheduleInput(req.body as Record<string, unknown>);
      const agent = getDb().prepare("SELECT id FROM agents WHERE id = ?").get(input.agentId) as { id: string } | undefined;
      if (!agent) {
        res.status(404).json({ error: "Agent not found." });
        return;
      }

      const schedule = {
        id: randomUUID(),
        name: input.name,
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
          id, name, agent_id, prompt, cron_expression, enabled, max_runs, next_run_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `,
      ).run(
        schedule.id,
        schedule.name,
        schedule.agent_id,
        schedule.prompt,
        schedule.cron_expression,
        schedule.enabled ? 1 : 0,
        schedule.max_runs,
        schedule.next_run_at,
      );

      res.status(201).json({ schedule: listSchedules().find((entry) => entry.id === schedule.id) ?? null });
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
      const agent = getDb().prepare("SELECT id FROM agents WHERE id = ?").get(input.agentId) as { id: string } | undefined;
      if (!agent) {
        res.status(404).json({ error: "Agent not found." });
        return;
      }

      const runCount = Number(existing.run_count ?? 0);
      const reachedLimit = input.maxRuns !== null && runCount >= input.maxRuns;
      const enabled = input.enabled && !reachedLimit;
      const nextRunAt = enabled ? computeNextRunAt(input.cronExpression, new Date()) : null;
      const limitError = reachedLimit ? "Run limit reached. Increase max runs or run manually." : null;

      getDb().prepare(
        `
        UPDATE schedules
        SET
          name = ?,
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
        input.agentId,
        input.prompt,
        input.cronExpression,
        enabled ? 1 : 0,
        input.maxRuns,
        nextRunAt,
        limitError,
        req.params.id,
      );

      res.json({ schedule: listSchedules().find((entry) => entry.id === req.params.id) ?? null });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid schedule payload." });
    }
  });

  app.delete("/api/schedules/:id", (req, res) => {
    const result = getDb().prepare("DELETE FROM schedules WHERE id = ?").run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "Schedule not found." });
      return;
    }
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
