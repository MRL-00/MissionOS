import { randomUUID } from "node:crypto";
import type { Express, Response } from "express";
import { getDb } from "../db.js";
import { createRunRecord, getRunSubscribers } from "../execution.js";
import { listRuns } from "../queries.js";

export function registerRunRoutes(app: Express) {
  app.get("/api/runs", (req, res) => {
    res.json({
      runs: listRuns({
        agentId: typeof req.query.agent_id === "string" ? req.query.agent_id : undefined,
        missionId: typeof req.query.mission_id === "string" ? req.query.mission_id : undefined,
        issueId: typeof req.query.issue_id === "string" ? req.query.issue_id : undefined,
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
      }),
    });
  });

  app.post("/api/runs", async (req, res) => {
    const { agent_id: rawAgentId, prompt: rawPrompt, mission_id: missionId, issue_id: issueId } = req.body as {
      agent_id?: string;
      prompt?: string;
      mission_id?: string;
      issue_id?: string;
    };
    const agentId = typeof rawAgentId === "string" ? rawAgentId.trim() : "";
    const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
    if (!agentId || !prompt) {
      res.status(400).json({ error: "agent_id and prompt are required." });
      return;
    }

    const runId = await createRunRecord({ agentId, prompt, missionId, issueId });
    const run = listRuns({}).find((item) => item.id === runId);
    res.status(201).json({ run });
  });

  app.get("/api/runs/:id", (req, res) => {
    const run = listRuns({}).find((item) => item.id === req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    res.json({ run });
  });

  app.delete("/api/runs/:id", (req, res) => {
    const database = getDb();
    database.prepare("DELETE FROM agent_messages WHERE run_id = ?").run(req.params.id);
    const result = database.prepare("DELETE FROM runs WHERE id = ?").run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/runs/:id/stream", (req, res) => {
    const run = getDb().prepare("SELECT id, output, status FROM runs WHERE id = ?").get(req.params.id) as
      | { id: string; output: string; status: string }
      | undefined;
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "snapshot", output: run.output, status: run.status })}\n\n`);

    const runSubscribers = getRunSubscribers();
    const subscribers = runSubscribers.get(run.id) ?? new Set<Response>();
    subscribers.add(res);
    runSubscribers.set(run.id, subscribers);

    req.on("close", () => {
      const current = runSubscribers.get(run.id);
      current?.delete(res);
      if (current && current.size === 0) {
        runSubscribers.delete(run.id);
      }
    });
  });

  // ── Agent messages ──

  app.get("/api/agent-messages", (req, res) => {
    let missionId = typeof req.query.mission_id === "string" ? req.query.mission_id : undefined;
    if (missionId === "active") {
      const active = getDb()
        .prepare("SELECT id FROM missions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1")
        .get() as { id: string } | undefined;
      missionId = active?.id;
    }

    const conditions = missionId ? "WHERE agent_messages.mission_id = ?" : "";
    const params = missionId ? [missionId] : [];
    const messages = getDb()
      .prepare(
        `
        SELECT
          agent_messages.*,
          sender.name AS from_agent_name,
          sender.emoji AS from_agent_emoji,
          recipient.name AS to_agent_name,
          recipient.emoji AS to_agent_emoji
        FROM agent_messages
        LEFT JOIN agents AS sender ON sender.id = agent_messages.from_agent_id
        LEFT JOIN agents AS recipient ON recipient.id = agent_messages.to_agent_id
        ${conditions}
        ORDER BY agent_messages.created_at DESC
        LIMIT 100
        `,
      )
      .all(...params);
    res.json({ messages });
  });

  app.post("/api/agent-messages", (req, res) => {
    const { from_agent_id: fromAgentId, to_agent_id: toAgentId, mission_id: missionId, run_id: runId, message } = req.body as {
      from_agent_id?: string;
      to_agent_id?: string;
      mission_id?: string;
      run_id?: string;
      message?: string;
    };
    if (!fromAgentId || !toAgentId || !message) {
      res.status(400).json({ error: "from_agent_id, to_agent_id and message are required." });
      return;
    }

    const payload = {
      id: randomUUID(),
      from_agent_id: fromAgentId,
      to_agent_id: toAgentId,
      mission_id: missionId ?? null,
      run_id: runId ?? null,
      message,
    };
    getDb()
      .prepare(
        `
        INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(payload.id, payload.from_agent_id, payload.to_agent_id, payload.mission_id, payload.run_id, payload.message);
    res.status(201).json({ agent_message: payload });
  });
}
