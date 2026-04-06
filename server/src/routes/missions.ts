import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getDb } from "../db.js";
import { createRunRecord } from "../execution.js";
import { listMissions } from "../queries.js";

export function registerMissionRoutes(app: Express) {
  app.get("/api/missions", (_req, res) => {
    res.json({ missions: listMissions() });
  });

  app.post("/api/missions", (req, res) => {
    const {
      title,
      description,
      color,
      lead_agent_id: leadAgentId,
      linear_project_id: linearProjectId,
      github_repo: githubRepo,
      github_default_branch: githubDefaultBranch,
    } = req.body as {
      title?: string;
      description?: string;
      color?: string;
      lead_agent_id?: string;
      linear_project_id?: string;
      github_repo?: string;
      github_default_branch?: string;
    };
    if (!title) {
      res.status(400).json({ error: "Mission title is required." });
      return;
    }

    const id = randomUUID();
    getDb()
      .prepare(
        `
        INSERT INTO missions (id, title, description, status, color, lead_agent_id, linear_project_id, github_repo, github_default_branch, updated_at)
        VALUES (?, ?, ?, 'planning', ?, ?, ?, ?, ?, datetime('now'))
        `,
      )
      .run(id, title, description ?? null, color ?? null, leadAgentId ?? null, linearProjectId ?? null, githubRepo ?? null, githubDefaultBranch ?? "main");

    if (leadAgentId) {
      getDb().prepare("INSERT OR IGNORE INTO mission_agents (mission_id, agent_id) VALUES (?, ?)").run(id, leadAgentId);
    }

    const mission = listMissions().find((item) => item.id === id);
    res.status(201).json({ mission });
  });

  app.put("/api/missions/:id", (req, res) => {
    const {
      title,
      description,
      status,
      color,
      lead_agent_id: leadAgentId,
      linear_project_id: linearProjectId,
      github_repo: githubRepo,
      github_default_branch: githubDefaultBranch,
    } = req.body as {
      title?: string;
      description?: string;
      status?: string;
      color?: string;
      lead_agent_id?: string;
      linear_project_id?: string;
      github_repo?: string;
      github_default_branch?: string;
    };

    getDb()
      .prepare(
        `
        UPDATE missions
        SET title = ?, description = ?, status = ?, color = ?, lead_agent_id = ?, linear_project_id = ?,
            github_repo = ?, github_default_branch = ?, updated_at = datetime('now')
        WHERE id = ?
        `,
      )
      .run(title, description ?? null, status ?? "planning", color ?? null, leadAgentId ?? null, linearProjectId ?? null,
        githubRepo ?? null, githubDefaultBranch ?? "main", req.params.id);

    if (leadAgentId) {
      getDb().prepare("INSERT OR IGNORE INTO mission_agents (mission_id, agent_id) VALUES (?, ?)").run(req.params.id, leadAgentId);
    }

    const mission = listMissions().find((item) => item.id === req.params.id);
    res.json({ mission });
  });

  app.delete("/api/missions/:id", (req, res) => {
    getDb().prepare("DELETE FROM missions WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/missions/:id/agents", (req, res) => {
    const { agent_id: agentId } = req.body as { agent_id?: string };
    if (!agentId) {
      res.status(400).json({ error: "agent_id is required." });
      return;
    }

    getDb().prepare("INSERT OR IGNORE INTO mission_agents (mission_id, agent_id) VALUES (?, ?)").run(req.params.id, agentId);
    res.status(201).json({ ok: true });
  });

  app.delete("/api/missions/:id/agents/:agentId", (req, res) => {
    getDb().prepare("DELETE FROM mission_agents WHERE mission_id = ? AND agent_id = ?").run(req.params.id, req.params.agentId);
    res.json({ ok: true });
  });

  app.post("/api/missions/:id/start", async (req, res) => {
    const mission = getDb().prepare("SELECT * FROM missions WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!mission) {
      res.status(404).json({ error: "Mission not found." });
      return;
    }

    const leadAgentId = typeof mission.lead_agent_id === "string" ? mission.lead_agent_id : null;
    if (!leadAgentId) {
      res.status(400).json({ error: "Mission has no lead agent." });
      return;
    }

    getDb().prepare("UPDATE missions SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    const assignedAgents = getDb()
      .prepare(
        `
        SELECT agents.name
        FROM mission_agents
        JOIN agents ON agents.id = mission_agents.agent_id
        WHERE mission_agents.mission_id = ?
        ORDER BY agents.name COLLATE NOCASE
        `,
      )
      .all(req.params.id) as Array<{ name: string }>;

    const runId = await createRunRecord({
      agentId: leadAgentId,
      missionId: req.params.id,
      prompt: `You are leading mission: ${String(mission.title)}. Goal: ${String(
        mission.description ?? "",
      )}. Your team: ${assignedAgents.map((item) => item.name).join(", ")}. Begin planning.`,
    });

    res.json({ ok: true, runId });
  });
}
