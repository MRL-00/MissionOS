import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getDb } from "../db.js";
import { engineMap } from "../engines/index.js";
import { createRunRecord } from "../execution.js";
import { parseGitHubRepoFullName } from "../git-workspace.js";
import { getMissionById, listMissions, parseListLimit } from "../queries.js";

const MISSION_STATUSES = new Set(["planning", "active", "paused", "complete"]);
const MAX_MISSION_TITLE_LENGTH = 160;
const MAX_MISSION_DESCRIPTION_LENGTH = 5_000;
const MAX_TEAM_NAME_LENGTH = 80;
const MAX_BRANCH_LENGTH = 120;
const DEFAULT_MISSION_LIST_LIMIT = 500;
const MAX_MISSION_LIST_LIMIT = 2_000;
const GIT_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/u;

type MissionPayload = {
  title: string;
  description: string | null;
  status: string;
  teamName: string;
  color: string | null;
  leadAgentId: string | null;
  linearProjectId: string | null;
  githubRepo: string | null;
  githubDefaultBranch: string;
};

type MissionPayloadResult = { ok: true; payload: MissionPayload } | { ok: false; error: string };
type MissionAgentValidationInput = {
  agentId: string | null;
  missionExists: boolean;
  agentExists: boolean;
  agentActive?: boolean | undefined;
  agentEngineSupported?: boolean | undefined;
};
type MissionAgentValidationResult = { ok: true } | { ok: false; status: number; error: string };
type MissionReferenceValidationInput = {
  leadAgentId: string | null;
  leadAgentExists: boolean;
  leadAgentActive?: boolean | undefined;
  leadAgentEngineSupported?: boolean | undefined;
};
type MissionDeleteBlockerInput = {
  issueCount: number;
  runCount: number;
  messageCount: number;
  scheduleCount: number;
};
type MissionDeleteResult = { ok: true } | { ok: false; status: number; error: string };
type MissionStartLeadInput = {
  leadAgentId: string | null;
  leadAgentExists: boolean;
  leadAgentActive: boolean;
  leadAgentEngineSupported: boolean;
};
type MissionStartStatusInput = {
  status: string | null;
};
type MissionCompletionInput = {
  status: string | null;
  activeRunCount: number;
};
type MissionAgentRemovalInput = {
  activeRunCount: number;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validateTextLength(label: string, value: string | null, maxLength: number): MissionPayloadResult | null {
  if (value && value.length > maxLength) {
    return { ok: false, error: `${label} must be ${maxLength} characters or fewer.` };
  }
  return null;
}

export function parseMissionPayload(body: Record<string, unknown>, options: { requireTitle: boolean }): MissionPayloadResult {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (options.requireTitle && !title) {
    return { ok: false, error: "Mission title is required." };
  }
  const titleLength = validateTextLength("Mission title", title, MAX_MISSION_TITLE_LENGTH);
  if (titleLength) {
    return titleLength;
  }

  const status = typeof body.status === "string" && body.status.trim() ? body.status.trim() : "planning";
  if (!MISSION_STATUSES.has(status)) {
    return { ok: false, error: "Mission status must be planning, active, paused, or complete." };
  }
  const description = optionalString(body.description);
  const teamName = optionalString(body.team_name) ?? "General";
  const githubDefaultBranch = optionalString(body.github_default_branch) ?? "main";
  const githubRepo = optionalString(body.github_repo);
  const descriptionLength = validateTextLength("Mission description", description, MAX_MISSION_DESCRIPTION_LENGTH);
  if (descriptionLength) {
    return descriptionLength;
  }
  const teamNameLength = validateTextLength("Team name", teamName, MAX_TEAM_NAME_LENGTH);
  if (teamNameLength) {
    return teamNameLength;
  }
  const branchLength = validateTextLength("Default branch", githubDefaultBranch, MAX_BRANCH_LENGTH);
  if (branchLength) {
    return branchLength;
  }
  if (githubRepo && !parseGitHubRepoFullName(githubRepo)) {
    return { ok: false, error: "GitHub repository must use owner/repo format with supported characters." };
  }
  if (
    !GIT_BRANCH_PATTERN.test(githubDefaultBranch) ||
    githubDefaultBranch.includes("..") ||
    githubDefaultBranch.includes("//") ||
    githubDefaultBranch.startsWith("/") ||
    githubDefaultBranch.startsWith("-")
  ) {
    return { ok: false, error: "Default branch contains unsupported characters." };
  }

  return {
    ok: true,
    payload: {
      title,
      description,
      status,
      teamName,
      color: optionalString(body.color),
      leadAgentId: optionalString(body.lead_agent_id),
      linearProjectId: optionalString(body.linear_project_id),
      githubRepo,
      githubDefaultBranch,
    },
  };
}

export function parseMissionListQuery(query: Record<string, unknown>) {
  const teamName = optionalString(query.team_name);
  return {
    teamName: teamName ? teamName.slice(0, MAX_TEAM_NAME_LENGTH) : undefined,
    limit: parseListLimit(typeof query.limit === "string" ? query.limit : undefined, {
      defaultLimit: DEFAULT_MISSION_LIST_LIMIT,
      maxLimit: MAX_MISSION_LIST_LIMIT,
    }),
  };
}

export function validateMissionAgentAssignment(input: MissionAgentValidationInput): MissionAgentValidationResult {
  if (!input.agentId) {
    return { ok: false, status: 400, error: "agent_id is required." };
  }
  if (!input.missionExists) {
    return { ok: false, status: 404, error: "Mission not found." };
  }
  if (!input.agentExists) {
    return { ok: false, status: 404, error: "Agent not found." };
  }
  if (input.agentActive === false) {
    return { ok: false, status: 409, error: "Agent is inactive." };
  }
  if (input.agentEngineSupported === false) {
    return { ok: false, status: 409, error: "Agent engine is not supported." };
  }
  return { ok: true };
}

export function validateMissionReferences(input: MissionReferenceValidationInput): MissionAgentValidationResult {
  if (input.leadAgentId && !input.leadAgentExists) {
    return { ok: false, status: 404, error: "Lead agent not found." };
  }
  if (input.leadAgentId && input.leadAgentActive === false) {
    return { ok: false, status: 409, error: "Lead agent is inactive." };
  }
  if (input.leadAgentId && input.leadAgentEngineSupported === false) {
    return { ok: false, status: 409, error: "Lead agent engine is not supported." };
  }
  return { ok: true };
}

export function validateMissionDeleteResult(changes: number): MissionDeleteResult {
  if (changes === 0) {
    return { ok: false, status: 404, error: "Mission not found." };
  }
  return { ok: true };
}

export function validateMissionDeleteBlockers(input: MissionDeleteBlockerInput): MissionDeleteResult {
  if (input.issueCount > 0 || input.runCount > 0 || input.messageCount > 0 || input.scheduleCount > 0) {
    return {
      ok: false,
      status: 409,
      error: "Cannot delete this mission while it has linked issues, runs, messages, or schedules. Remove the linked work first.",
    };
  }
  return { ok: true };
}

export function validateMissionStartLead(input: MissionStartLeadInput): MissionDeleteResult {
  if (!input.leadAgentId) {
    return { ok: false, status: 400, error: "Mission has no lead agent." };
  }
  if (!input.leadAgentExists) {
    return { ok: false, status: 404, error: "Lead agent not found." };
  }
  if (!input.leadAgentActive) {
    return { ok: false, status: 409, error: "Mission lead agent is inactive." };
  }
  if (!input.leadAgentEngineSupported) {
    return { ok: false, status: 409, error: "Mission lead agent engine is not supported." };
  }
  return { ok: true };
}

export function validateMissionStartStatus(input: MissionStartStatusInput): MissionDeleteResult {
  if (input.status === "active") {
    return { ok: false, status: 409, error: "Mission is already active." };
  }
  if (input.status === "complete") {
    return { ok: false, status: 409, error: "Mission is already complete." };
  }
  return { ok: true };
}

export function validateMissionCompletion(input: MissionCompletionInput): MissionDeleteResult {
  if (input.status === "complete" && input.activeRunCount > 0) {
    return { ok: false, status: 409, error: "Mission has active runs. Wait for them to finish before marking it complete." };
  }
  return { ok: true };
}

export function validateMissionAgentRemoval(input: MissionAgentRemovalInput): MissionDeleteResult {
  if (input.activeRunCount > 0) {
    return { ok: false, status: 409, error: "Mission agent has active runs. Wait for them to finish before removing the agent." };
  }
  return { ok: true };
}

export function registerMissionRoutes(app: Express) {
  app.get("/api/missions", (req, res) => {
    const filters = parseMissionListQuery(req.query);
    res.json({ missions: listMissions(filters) });
  });

  app.post("/api/missions", (req, res) => {
    const result = parseMissionPayload(req.body as Record<string, unknown>, { requireTitle: true });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { title, description, teamName, color, leadAgentId, linearProjectId, githubRepo, githubDefaultBranch } = result.payload;
    const leadAgent = leadAgentId
      ? (getDb().prepare("SELECT active, engine FROM agents WHERE id = ?").get(leadAgentId) as
          | { active: number | null; engine: string | null }
          | undefined)
      : undefined;
    const references = validateMissionReferences({
      leadAgentId,
      leadAgentExists: Boolean(leadAgent),
      leadAgentActive: leadAgent ? leadAgent.active === 1 : undefined,
      leadAgentEngineSupported: leadAgent ? engineMap.has(String(leadAgent.engine)) : undefined,
    });
    if (!references.ok) {
      res.status(references.status).json({ error: references.error });
      return;
    }

    const id = randomUUID();
    const db = getDb();
    const createMission = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO missions (id, title, description, status, team_name, color, lead_agent_id, linear_project_id, github_repo, github_default_branch, updated_at)
        VALUES (?, ?, ?, 'planning', ?, ?, ?, ?, ?, ?, datetime('now'))
        `,
      )
        .run(id, title, description ?? null, teamName, color ?? null, leadAgentId ?? null, linearProjectId ?? null, githubRepo ?? null, githubDefaultBranch ?? "main");

      if (leadAgentId) {
        db.prepare("INSERT OR IGNORE INTO mission_agents (mission_id, agent_id) VALUES (?, ?)").run(id, leadAgentId);
      }
    });
    createMission();

    const mission = getMissionById(id);
    res.status(201).json({ mission });
  });

  app.put("/api/missions/:id", (req, res) => {
    const result = parseMissionPayload(req.body as Record<string, unknown>, { requireTitle: true });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { title, description, status, teamName, color, leadAgentId, linearProjectId, githubRepo, githubDefaultBranch } = result.payload;
    const leadAgent = leadAgentId
      ? (getDb().prepare("SELECT active, engine FROM agents WHERE id = ?").get(leadAgentId) as
          | { active: number | null; engine: string | null }
          | undefined)
      : undefined;
    const references = validateMissionReferences({
      leadAgentId,
      leadAgentExists: Boolean(leadAgent),
      leadAgentActive: leadAgent ? leadAgent.active === 1 : undefined,
      leadAgentEngineSupported: leadAgent ? engineMap.has(String(leadAgent.engine)) : undefined,
    });
    if (!references.ok) {
      res.status(references.status).json({ error: references.error });
      return;
    }

    const db = getDb();
    const activeRuns = db
      .prepare("SELECT COUNT(*) AS count FROM runs WHERE mission_id = ? AND status IN ('running', 'planning')")
      .get(req.params.id) as { count: number };
    const completion = validateMissionCompletion({ status, activeRunCount: activeRuns.count });
    if (!completion.ok) {
      res.status(completion.status).json({ error: completion.error });
      return;
    }

    const updateMission = db.transaction(() => {
      const update = db.prepare(
        `
        UPDATE missions
        SET title = ?, description = ?, status = ?, team_name = ?, color = ?, lead_agent_id = ?, linear_project_id = ?,
            github_repo = ?, github_default_branch = ?, updated_at = datetime('now')
        WHERE id = ?
        `,
      )
        .run(title, description ?? null, status ?? "planning", teamName, color ?? null, leadAgentId ?? null, linearProjectId ?? null,
        githubRepo ?? null, githubDefaultBranch ?? "main", req.params.id);
      if (update.changes > 0 && leadAgentId) {
        db.prepare("INSERT OR IGNORE INTO mission_agents (mission_id, agent_id) VALUES (?, ?)").run(req.params.id, leadAgentId);
      }
      return update.changes;
    });
    const updateChanges = updateMission();
    if (updateChanges === 0) {
      res.status(404).json({ error: "Mission not found." });
      return;
    }

    const mission = getMissionById(req.params.id);
    res.json({ mission });
  });

  app.delete("/api/missions/:id", (req, res) => {
    const linkedIssues = getDb().prepare("SELECT COUNT(*) AS count FROM issues WHERE mission_id = ?").get(req.params.id) as { count: number };
    const linkedRuns = getDb().prepare("SELECT COUNT(*) AS count FROM runs WHERE mission_id = ?").get(req.params.id) as { count: number };
    const linkedMessages = getDb().prepare("SELECT COUNT(*) AS count FROM agent_messages WHERE mission_id = ?").get(req.params.id) as { count: number };
    const linkedSchedules = getDb().prepare("SELECT COUNT(*) AS count FROM schedules WHERE mission_id = ?").get(req.params.id) as { count: number };
    const blockers = validateMissionDeleteBlockers({
      issueCount: linkedIssues.count,
      runCount: linkedRuns.count,
      messageCount: linkedMessages.count,
      scheduleCount: linkedSchedules.count,
    });
    if (!blockers.ok) {
      res.status(blockers.status).json({ error: blockers.error });
      return;
    }

    const result = getDb().prepare("DELETE FROM missions WHERE id = ?").run(req.params.id);
    const validation = validateMissionDeleteResult(result.changes);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/missions/:id/agents", (req, res) => {
    const agentId = optionalString((req.body as { agent_id?: unknown }).agent_id);
    const missionExists = Boolean(getDb().prepare("SELECT 1 FROM missions WHERE id = ?").get(req.params.id));
    const agent = agentId
      ? (getDb().prepare("SELECT active, engine FROM agents WHERE id = ?").get(agentId) as
          | { active: number | null; engine: string | null }
          | undefined)
      : undefined;
    const validation = validateMissionAgentAssignment({
      agentId,
      missionExists,
      agentExists: Boolean(agent),
      agentActive: agent ? agent.active === 1 : undefined,
      agentEngineSupported: agent ? engineMap.has(String(agent.engine)) : undefined,
    });
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    getDb().prepare("INSERT OR IGNORE INTO mission_agents (mission_id, agent_id) VALUES (?, ?)").run(req.params.id, agentId);
    res.status(201).json({ ok: true });
  });

  app.delete("/api/missions/:id/agents/:agentId", (req, res) => {
    const missionExists = Boolean(getDb().prepare("SELECT 1 FROM missions WHERE id = ?").get(req.params.id));
    const agentExists = Boolean(getDb().prepare("SELECT 1 FROM agents WHERE id = ?").get(req.params.agentId));
    const validation = validateMissionAgentAssignment({ agentId: req.params.agentId, missionExists, agentExists });
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const db = getDb();
    const activeRuns = db.prepare(
      "SELECT COUNT(*) AS count FROM runs WHERE mission_id = ? AND agent_id = ? AND status IN ('running', 'planning')",
    ).get(req.params.id, req.params.agentId) as { count: number };
    const removalValidation = validateMissionAgentRemoval({ activeRunCount: activeRuns.count });
    if (!removalValidation.ok) {
      res.status(removalValidation.status).json({ error: removalValidation.error });
      return;
    }

    const deleteResult = db.transaction(() => {
      const result = db.prepare("DELETE FROM mission_agents WHERE mission_id = ? AND agent_id = ?").run(req.params.id, req.params.agentId);
      if (result.changes > 0) {
        db.prepare("UPDATE missions SET lead_agent_id = NULL, updated_at = datetime('now') WHERE id = ? AND lead_agent_id = ?").run(
          req.params.id,
          req.params.agentId,
        );
      }
      return result;
    })();
    if (deleteResult.changes === 0) {
      res.status(404).json({ error: "Agent is not assigned to this mission." });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/missions/:id/start", async (req, res) => {
    const mission = getDb().prepare("SELECT * FROM missions WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!mission) {
      res.status(404).json({ error: "Mission not found." });
      return;
    }
    const statusValidation = validateMissionStartStatus({ status: typeof mission.status === "string" ? mission.status : null });
    if (!statusValidation.ok) {
      res.status(statusValidation.status).json({ error: statusValidation.error });
      return;
    }

    const leadAgentId = typeof mission.lead_agent_id === "string" ? mission.lead_agent_id : null;
    const leadAgent = leadAgentId
      ? (getDb().prepare("SELECT id, active, engine FROM agents WHERE id = ?").get(leadAgentId) as
          | { id: string; active: number | null; engine: string | null }
          | undefined)
      : undefined;
    const validation = validateMissionStartLead({
      leadAgentId,
      leadAgentExists: Boolean(leadAgent),
      leadAgentActive: leadAgent?.active === 1,
      leadAgentEngineSupported: leadAgent ? engineMap.has(String(leadAgent.engine)) : false,
    });
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const activeLeadAgentId = leadAgentId;
    if (!activeLeadAgentId) {
      res.status(400).json({ error: "Mission has no lead agent." });
      return;
    }

    const assignedAgents = getDb()
      .prepare(
        `
        SELECT agents.name
        FROM mission_agents
        JOIN agents ON agents.id = mission_agents.agent_id
        WHERE mission_agents.mission_id = ? AND agents.active = 1
        ORDER BY agents.name COLLATE NOCASE
        `,
      )
      .all(req.params.id) as Array<{ name: string }>;

    const runId = await createRunRecord({
      agentId: activeLeadAgentId,
      missionId: req.params.id,
      prompt: `You are leading mission: ${String(mission.title)}. Goal: ${String(
        mission.description ?? "",
      )}. Your team: ${assignedAgents.map((item) => item.name).join(", ")}. Begin planning.`,
    });

    getDb().prepare("UPDATE missions SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    res.json({ ok: true, runId });
  });
}
