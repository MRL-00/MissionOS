import { randomUUID } from "node:crypto";
import type { Express, Response } from "express";
import { getDb } from "../db.js";
import { engineMap } from "../engines/index.js";
import { createRunRecord, getRunSubscribers } from "../execution.js";
import { getRunById, listRuns, parseListLimit } from "../queries.js";

type RunPayload = {
  agentId: string;
  prompt: string;
  missionId: string | null;
  issueId: string | null;
};
type RunPayloadResult = { ok: true; payload: RunPayload } | { ok: false; error: string };
type RunReferenceValidationInput = {
  agentId: string;
  missionId: string | null;
  issueId: string | null;
  issueMissionId: string | null;
  agentExists: boolean;
  agentActive: boolean;
  agentEngineSupported: boolean;
  agentAssignedToMission?: boolean | undefined;
  missionExists: boolean;
  issueExists: boolean;
};
type RunReferenceValidationResult = { ok: true } | { ok: false; status: number; error: string };
type CheckedRunReferences = RunReferenceValidationResult & { missionId?: string | null };
type RunDeleteValidationResult = { ok: true } | { ok: false; status: number; error: string };
type AgentMessagePayload = {
  fromAgentId: string;
  toAgentId: string;
  missionId: string | null;
  runId: string | null;
  message: string;
};
type AgentMessagePayloadResult = { ok: true; payload: AgentMessagePayload } | { ok: false; error: string };
type AgentMessageReferenceValidationInput = {
  fromAgentId: string;
  toAgentId: string;
  missionId: string | null;
  runId: string | null;
  runMissionId: string | null;
  fromAgentExists: boolean;
  fromAgentActive: boolean;
  fromAgentEngineSupported: boolean;
  toAgentExists: boolean;
  toAgentActive: boolean;
  toAgentEngineSupported: boolean;
  missionExists: boolean;
  runExists: boolean;
};
type CheckedAgentMessageReferences = RunReferenceValidationResult & { missionId?: string | null };
const MAX_RUN_PROMPT_LENGTH = 20_000;
const MAX_AGENT_MESSAGE_LENGTH = 5_000;
const MAX_RUN_FILTER_LENGTH = 120;
const MAX_AGENT_MESSAGE_FILTER_LENGTH = 120;
const RUN_LIST_STATUSES = new Set(["running", "planning", "complete", "failed"]);

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalFilterString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, MAX_RUN_FILTER_LENGTH);
}

function optionalRunStatus(value: unknown): string | undefined {
  const status = optionalFilterString(value);
  return status && RUN_LIST_STATUSES.has(status) ? status : undefined;
}

export function parseRunListQuery(query: Record<string, unknown>) {
  return {
    agentId: optionalFilterString(query.agent_id),
    missionId: optionalFilterString(query.mission_id),
    issueId: optionalFilterString(query.issue_id),
    status: optionalRunStatus(query.status),
    q: typeof query.q === "string" ? query.q : undefined,
    parentRunId: optionalFilterString(query.parent_run_id),
  };
}

export function parseAgentMessageListQuery(query: Record<string, unknown>) {
  return {
    missionId: optionalFilterString(query.mission_id)?.slice(0, MAX_AGENT_MESSAGE_FILTER_LENGTH),
  };
}

export function parseRunPayload(body: Record<string, unknown>): RunPayloadResult {
  const agentId = optionalString(body.agent_id);
  const prompt = optionalString(body.prompt);
  if (!agentId || !prompt) {
    return { ok: false, error: "agent_id and prompt are required." };
  }
  if (prompt.length > MAX_RUN_PROMPT_LENGTH) {
    return { ok: false, error: `Prompt must be ${MAX_RUN_PROMPT_LENGTH} characters or fewer.` };
  }
  return {
    ok: true,
    payload: {
      agentId,
      prompt,
      missionId: optionalString(body.mission_id),
      issueId: optionalString(body.issue_id),
    },
  };
}

export function validateRunReferences(input: RunReferenceValidationInput): RunReferenceValidationResult {
  if (!input.agentExists) {
    return { ok: false, status: 404, error: "Agent not found." };
  }
  if (!input.agentActive) {
    return { ok: false, status: 409, error: "Agent is inactive." };
  }
  if (!input.agentEngineSupported) {
    return { ok: false, status: 409, error: "Agent engine is not supported." };
  }
  if (input.missionId && !input.missionExists) {
    return { ok: false, status: 404, error: "Mission not found." };
  }
  if (input.issueId && !input.issueExists) {
    return { ok: false, status: 404, error: "Issue not found." };
  }
  if (input.missionId && input.issueId && input.issueMissionId !== input.missionId) {
    return { ok: false, status: 409, error: "Issue does not belong to mission." };
  }
  if ((input.missionId || input.issueMissionId) && input.agentAssignedToMission === false) {
    return { ok: false, status: 409, error: "Agent is not assigned to this mission." };
  }
  return { ok: true };
}

export function parseAgentMessagePayload(body: Record<string, unknown>): AgentMessagePayloadResult {
  const fromAgentId = optionalString(body.from_agent_id);
  const toAgentId = optionalString(body.to_agent_id);
  const message = optionalString(body.message);
  if (!fromAgentId || !toAgentId || !message) {
    return { ok: false, error: "from_agent_id, to_agent_id and message are required." };
  }
  if (message.length > MAX_AGENT_MESSAGE_LENGTH) {
    return { ok: false, error: `Message must be ${MAX_AGENT_MESSAGE_LENGTH} characters or fewer.` };
  }
  return {
    ok: true,
    payload: {
      fromAgentId,
      toAgentId,
      missionId: optionalString(body.mission_id),
      runId: optionalString(body.run_id),
      message,
    },
  };
}

export function validateAgentMessageReferences(input: AgentMessageReferenceValidationInput): RunReferenceValidationResult {
  if (!input.fromAgentExists) {
    return { ok: false, status: 404, error: "Sender agent not found." };
  }
  if (!input.fromAgentActive) {
    return { ok: false, status: 409, error: "Sender agent is inactive." };
  }
  if (!input.fromAgentEngineSupported) {
    return { ok: false, status: 409, error: "Sender agent engine is not supported." };
  }
  if (!input.toAgentExists) {
    return { ok: false, status: 404, error: "Recipient agent not found." };
  }
  if (!input.toAgentActive) {
    return { ok: false, status: 409, error: "Recipient agent is inactive." };
  }
  if (!input.toAgentEngineSupported) {
    return { ok: false, status: 409, error: "Recipient agent engine is not supported." };
  }
  if (input.missionId && !input.missionExists) {
    return { ok: false, status: 404, error: "Mission not found." };
  }
  if (input.runId && !input.runExists) {
    return { ok: false, status: 404, error: "Run not found." };
  }
  if (input.missionId && input.runId && input.runMissionId !== input.missionId) {
    return { ok: false, status: 409, error: "Run does not belong to mission." };
  }
  return { ok: true };
}

export function isRunStreamLiveStatus(status: string): boolean {
  return status === "running" || status === "planning";
}

export function validateRunDeleteStatus(status: string | null): RunDeleteValidationResult {
  if (status && isRunStreamLiveStatus(status)) {
    return { ok: false, status: 409, error: "Cannot delete an active run. Wait for it to finish before deleting it." };
  }
  return { ok: true };
}

function checkRunReferences(payload: RunPayload): CheckedRunReferences {
  const db = getDb();
  const agent = db.prepare("SELECT active, engine FROM agents WHERE id = ?").get(payload.agentId) as
    | { active: number | null; engine: string | null }
    | undefined;
  const issue = payload.issueId
    ? (db.prepare("SELECT mission_id FROM issues WHERE id = ?").get(payload.issueId) as { mission_id: string | null } | undefined)
    : undefined;
  const missionExists = payload.missionId ? Boolean(db.prepare("SELECT 1 FROM missions WHERE id = ?").get(payload.missionId)) : false;
  const effectiveMissionId = payload.missionId ?? issue?.mission_id ?? null;
  const agentAssignedToMission = effectiveMissionId && (payload.missionId ? missionExists : Boolean(issue))
    ? Boolean(db.prepare("SELECT 1 FROM mission_agents WHERE mission_id = ? AND agent_id = ?").get(effectiveMissionId, payload.agentId))
    : undefined;
  const validation = validateRunReferences({
    agentId: payload.agentId,
    missionId: payload.missionId,
    issueId: payload.issueId,
    issueMissionId: issue?.mission_id ?? null,
    agentExists: Boolean(agent),
    agentActive: agent?.active === 1,
    agentEngineSupported: agent ? engineMap.has(String(agent.engine)) : false,
    agentAssignedToMission,
    missionExists,
    issueExists: Boolean(issue),
  });
  if (!validation.ok) {
    return validation;
  }
  return { ok: true, missionId: payload.missionId ?? issue?.mission_id ?? null };
}

function checkAgentMessageReferences(payload: AgentMessagePayload): CheckedAgentMessageReferences {
  const db = getDb();
  const run = payload.runId
    ? (db.prepare("SELECT mission_id FROM runs WHERE id = ?").get(payload.runId) as { mission_id: string | null } | undefined)
    : undefined;
  const fromAgent = db.prepare("SELECT active, engine FROM agents WHERE id = ?").get(payload.fromAgentId) as
    | { active: number | null; engine: string | null }
    | undefined;
  const toAgent = db.prepare("SELECT active, engine FROM agents WHERE id = ?").get(payload.toAgentId) as
    | { active: number | null; engine: string | null }
    | undefined;
  const validation = validateAgentMessageReferences({
    fromAgentId: payload.fromAgentId,
    toAgentId: payload.toAgentId,
    missionId: payload.missionId,
    runId: payload.runId,
    runMissionId: run?.mission_id ?? null,
    fromAgentExists: Boolean(fromAgent),
    fromAgentActive: fromAgent?.active === 1,
    fromAgentEngineSupported: fromAgent ? engineMap.has(String(fromAgent.engine)) : false,
    toAgentExists: Boolean(toAgent),
    toAgentActive: toAgent?.active === 1,
    toAgentEngineSupported: toAgent ? engineMap.has(String(toAgent.engine)) : false,
    missionExists: payload.missionId ? Boolean(db.prepare("SELECT 1 FROM missions WHERE id = ?").get(payload.missionId)) : false,
    runExists: Boolean(run),
  });
  if (!validation.ok) {
    return validation;
  }
  return { ok: true, missionId: payload.missionId ?? run?.mission_id ?? null };
}

export function registerRunRoutes(app: Express) {
  app.get("/api/runs", (req, res) => {
    const filters = parseRunListQuery(req.query);
    res.json({
      runs: listRuns({
        ...filters,
        limit: parseListLimit(typeof req.query.limit === "string" ? req.query.limit : undefined, {
          defaultLimit: 200,
          maxLimit: 1_000,
        }),
      }),
    });
  });

  app.post("/api/runs", async (req, res) => {
    const result = parseRunPayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const payload = result.payload;
    const references = checkRunReferences(payload);
    if (!references.ok) {
      res.status(references.status).json({ error: references.error });
      return;
    }

    const runId = await createRunRecord({
      agentId: payload.agentId,
      prompt: payload.prompt,
      missionId: references.missionId ?? null,
      issueId: payload.issueId,
    });
    const run = getRunById(runId);
    res.status(201).json({ run });
  });

  app.get("/api/runs/:id", (req, res) => {
    const run = getRunById(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    res.json({ run });
  });

  app.delete("/api/runs/:id", (req, res) => {
    const database = getDb();
    const runId = req.params.id;
    const run = database.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string | null } | undefined;
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    const validation = validateRunDeleteStatus(run.status);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }

    const deleteRun = database.transaction(() => {
      database.prepare("UPDATE runs SET parent_run_id = NULL WHERE parent_run_id = ?").run(runId);
      database.prepare("DELETE FROM agent_messages WHERE run_id = ?").run(runId);
      return database.prepare("DELETE FROM runs WHERE id = ?").run(runId).changes;
    });
    deleteRun();
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
    if (!isRunStreamLiveStatus(run.status)) {
      res.end();
      return;
    }

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
    let { missionId } = parseAgentMessageListQuery(req.query);
    if (missionId === "active") {
      const active = getDb()
        .prepare("SELECT id FROM missions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1")
        .get() as { id: string } | undefined;
      if (!active) {
        res.json({ messages: [] });
        return;
      }
      missionId = active?.id;
    } else if (missionId) {
      const missionExists = Boolean(getDb().prepare("SELECT 1 FROM missions WHERE id = ?").get(missionId));
      if (!missionExists) {
        res.status(404).json({ error: "Mission not found." });
        return;
      }
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
    const result = parseAgentMessagePayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const references = checkAgentMessageReferences(result.payload);
    if (!references.ok) {
      res.status(references.status).json({ error: references.error });
      return;
    }

    const payload = {
      id: randomUUID(),
      from_agent_id: result.payload.fromAgentId,
      to_agent_id: result.payload.toAgentId,
      mission_id: references.missionId ?? null,
      run_id: result.payload.runId,
      message: result.payload.message,
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
