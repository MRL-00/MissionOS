import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getDb, parseJson } from "../db.js";
import { engineAdapters, engineMap } from "../engines/index.js";
import { listAgents, listRuns } from "../queries.js";

export function registerAgentRoutes(app: Express) {
  app.get("/api/engines", (_req, res) => {
    res.json({
      engines: engineAdapters.map(({ test: _test, run: _run, ...definition }) => definition),
    });
  });

  app.post("/api/engines/:id/test", async (req, res) => {
    const adapter = engineMap.get(req.params.id);
    if (!adapter) {
      res.status(404).json({ error: "Unknown engine." });
      return;
    }

    const startedAt = Date.now();
    const result = await adapter.test((req.body as { config?: Record<string, unknown> }).config ?? {});
    res.json({
      ...result,
      latency_ms: Date.now() - startedAt,
    });
  });

  app.get("/api/agents", (_req, res) => {
    res.json({ agents: listAgents() });
  });

  app.post("/api/agents", (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (typeof body.name !== "string" || !body.name || typeof body.engine !== "string" || !body.engine) {
      res.status(400).json({ error: "Agent name and engine are required." });
      return;
    }

    const id = randomUUID();
    getDb()
      .prepare(
        `
        INSERT INTO agents (
          id, name, role, emoji, color, engine, skills, tools, connection_type, connection_config,
          soul_md, agents_md, external_config, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        body.name,
        typeof body.role === "string" ? body.role : null,
        typeof body.emoji === "string" ? body.emoji : "🤖",
        typeof body.color === "string" ? body.color : "#5E4AE3",
        body.engine,
        JSON.stringify(Array.isArray(body.skills) ? body.skills : []),
        JSON.stringify(Array.isArray(body.tools) ? body.tools : []),
        typeof body.connection_type === "string" ? body.connection_type : null,
        JSON.stringify(typeof body.connection_config === "object" && body.connection_config ? body.connection_config : {}),
        typeof body.soul_md === "string" ? body.soul_md : "",
        typeof body.agents_md === "string" ? body.agents_md : "",
        body.external_config ? 1 : 0,
        body.active === false ? 0 : 1,
      );

    getDb().prepare("INSERT OR IGNORE INTO agent_positions (agent_id, x, y) VALUES (?, 0, 0)").run(id);

    const agent = listAgents().find((item) => item.id === id);
    res.status(201).json({ agent });
  });

  app.put("/api/agents/:id", (req, res) => {
    const body = req.body as Record<string, unknown>;
    getDb()
      .prepare(
        `
        UPDATE agents
        SET
          name = ?,
          role = ?,
          emoji = ?,
          color = ?,
          engine = ?,
          skills = ?,
          tools = ?,
          connection_type = ?,
          connection_config = ?,
          soul_md = ?,
          agents_md = ?,
          external_config = ?,
          active = ?
        WHERE id = ?
        `,
      )
      .run(
        body.name,
        typeof body.role === "string" ? body.role : null,
        typeof body.emoji === "string" ? body.emoji : "🤖",
        typeof body.color === "string" ? body.color : "#5E4AE3",
        body.engine,
        JSON.stringify(Array.isArray(body.skills) ? body.skills : []),
        JSON.stringify(Array.isArray(body.tools) ? body.tools : []),
        typeof body.connection_type === "string" ? body.connection_type : null,
        JSON.stringify(typeof body.connection_config === "object" && body.connection_config ? body.connection_config : {}),
        typeof body.soul_md === "string" ? body.soul_md : "",
        typeof body.agents_md === "string" ? body.agents_md : "",
        body.external_config ? 1 : 0,
        body.active === false ? 0 : 1,
        req.params.id,
      );

    const agent = listAgents().find((item) => item.id === req.params.id);
    res.json({ agent });
  });

  app.delete("/api/agents/:id", (req, res) => {
    getDb().prepare("DELETE FROM agents WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/agents/:id/test", async (req, res) => {
    const row = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }

    const adapter = engineMap.get(String(row.engine));
    if (!adapter) {
      res.status(400).json({ ok: false, message: `Unsupported engine: ${row.engine}` });
      return;
    }

    const startedAt = Date.now();
    const result = await adapter.test(parseJson<Record<string, unknown>>(String(row.connection_config ?? "{}"), {}));
    res.json({ ...result, latency_ms: Date.now() - startedAt });
  });

  app.get("/api/agents/:id/runs", (req, res) => {
    res.json({ runs: listRuns({ agentId: req.params.id }) });
  });

  // ── Relationships ──

  app.get("/api/relationships", (_req, res) => {
    const relationships = getDb()
      .prepare("SELECT * FROM agent_relationships ORDER BY parent_id, child_id")
      .all();
    res.json({ relationships });
  });

  app.post("/api/relationships", (req, res) => {
    const { parent_id: parentId, child_id: childId } = req.body as { parent_id?: string; child_id?: string };
    if (!parentId || !childId) {
      res.status(400).json({ error: "parent_id and child_id are required." });
      return;
    }

    const relationship = {
      id: randomUUID(),
      parent_id: parentId,
      child_id: childId,
    };

    getDb()
      .prepare("INSERT INTO agent_relationships (id, parent_id, child_id) VALUES (?, ?, ?)")
      .run(relationship.id, relationship.parent_id, relationship.child_id);
    res.status(201).json({ relationship });
  });

  app.delete("/api/relationships/:id", (req, res) => {
    getDb().prepare("DELETE FROM agent_relationships WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── Positions ──

  app.put("/api/positions", (req, res) => {
    const positions = Array.isArray(req.body) ? req.body : (req.body as { positions?: unknown[] }).positions;
    if (!Array.isArray(positions)) {
      res.status(400).json({ error: "Positions payload must be an array." });
      return;
    }

    const insert = getDb().prepare(
      `
      INSERT INTO agent_positions (agent_id, x, y)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET x = excluded.x, y = excluded.y
      `,
    );
    const transaction = getDb().transaction((items: unknown[]) => {
      for (const item of items as Array<{ agent_id: string; x: number; y: number }>) {
        insert.run(item.agent_id, item.x, item.y);
      }
    });
    transaction(positions);
    res.json({ ok: true });
  });
}
