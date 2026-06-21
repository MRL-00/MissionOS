import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getDb, parseJson } from "../db.js";
import { engineAdapters, engineMap } from "../engines/index.js";
import { getAgentById, listAgents, listRuns, parseListLimit } from "../queries.js";
import { mergeMaskedEngineConfig } from "../secretConfig.js";

type AgentPayload = {
  name: string;
  role: string | null;
  emoji: string;
  color: string;
  engine: string;
  skills: string[];
  tools: string[];
  connectionType: string | null;
  connectionConfig: Record<string, unknown>;
  soulMd: string;
  agentsMd: string;
  externalConfig: number;
  active: number;
};

type AgentPayloadResult = { ok: true; payload: AgentPayload } | { ok: false; error: string };
type RelationshipValidationInput = {
  parentId: string | null;
  childId: string | null;
  parentExists: boolean;
  childExists: boolean;
  parentActive?: boolean | undefined;
  childActive?: boolean | undefined;
  parentEngineSupported?: boolean | undefined;
  childEngineSupported?: boolean | undefined;
  relationshipExists?: boolean;
  createsCycle?: boolean;
};
type RelationshipValidationResult = { ok: true } | { ok: false; status: number; error: string };
type PositionPayload = { agent_id: string; x: number; y: number };
type PositionPayloadResult = { ok: true; positions: PositionPayload[] } | { ok: false; status: number; error: string };
type AgentDeleteBlockerInput = {
  leadMissionCount: number;
  assignedMissionCount: number;
  assignedIssueCount: number;
  runCount: number;
  messageCount: number;
  scheduleCount: number;
};
type DeleteAgentResult = { ok: true } | { ok: false; status: number; error: string };

const MAX_AGENT_NAME_LENGTH = 120;
const MAX_AGENT_ROLE_LENGTH = 240;
const MAX_AGENT_EMOJI_LENGTH = 16;
const MAX_AGENT_COLOR_LENGTH = 64;
const MAX_AGENT_SKILL_LENGTH = 80;
const MAX_AGENT_TOOL_LENGTH = 80;
const MAX_AGENT_SKILL_COUNT = 50;
const MAX_AGENT_TOOL_COUNT = 50;
const MAX_CONNECTION_TYPE_LENGTH = 80;
const MAX_CONNECTION_CONFIG_LENGTH = 20_000;
const MAX_AGENT_PROMPT_MD_LENGTH = 50_000;
const DEFAULT_AGENT_LIST_LIMIT = 1_000;
const MAX_AGENT_LIST_LIMIT = 5_000;
const DEFAULT_AGENT_RUN_LIST_LIMIT = 200;
const MAX_AGENT_RUN_LIST_LIMIT = 1_000;
const DEFAULT_RELATIONSHIP_LIST_LIMIT = 5_000;
const MAX_RELATIONSHIP_LIST_LIMIT = 10_000;
const MAX_POSITION_PAYLOAD_COUNT = 5_000;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function validateTextLength(label: string, value: string | null, maxLength: number): string | null {
  return value && value.length > maxLength ? `${label} must be ${maxLength} characters or fewer.` : null;
}

function validateStringList(label: string, values: string[], maxCount: number, maxLength: number): string | null {
  if (values.length > maxCount) {
    return `${label} must include ${maxCount} or fewer entries.`;
  }
  if (values.some((value) => value.length > maxLength)) {
    return `${label} entries must be ${maxLength} characters or fewer.`;
  }
  return null;
}

function validateJsonSize(label: string, value: Record<string, unknown>, maxLength: number): string | null {
  try {
    return JSON.stringify(value).length > maxLength ? `${label} must be ${maxLength} characters or fewer.` : null;
  } catch {
    return `${label} must be valid JSON.`;
  }
}

export function parseAgentPayload(body: Record<string, unknown>, validEngineIds: { has(engineId: string): boolean }): AgentPayloadResult {
  const name = optionalString(body.name);
  if (!name) {
    return { ok: false, error: "Agent name is required." };
  }

  const engine = optionalString(body.engine);
  if (!engine) {
    return { ok: false, error: "Agent engine is required." };
  }
  if (!validEngineIds.has(engine)) {
    return { ok: false, error: `Unsupported engine: ${engine}` };
  }

  const role = optionalString(body.role);
  const emoji = optionalString(body.emoji) ?? "🤖";
  const color = optionalString(body.color) ?? "#5E4AE3";
  const skills = stringArray(body.skills);
  const tools = stringArray(body.tools);
  const connectionType = optionalString(body.connection_type);
  const connectionConfig =
    typeof body.connection_config === "object" && body.connection_config ? body.connection_config as Record<string, unknown> : {};
  const soulMd = typeof body.soul_md === "string" ? body.soul_md : "";
  const agentsMd = typeof body.agents_md === "string" ? body.agents_md : "";

  const lengthError =
    validateTextLength("Agent name", name, MAX_AGENT_NAME_LENGTH) ??
    validateTextLength("Agent role", role, MAX_AGENT_ROLE_LENGTH) ??
    validateTextLength("Agent emoji", emoji, MAX_AGENT_EMOJI_LENGTH) ??
    validateTextLength("Agent color", color, MAX_AGENT_COLOR_LENGTH) ??
    validateStringList("Agent skills", skills, MAX_AGENT_SKILL_COUNT, MAX_AGENT_SKILL_LENGTH) ??
    validateStringList("Agent tools", tools, MAX_AGENT_TOOL_COUNT, MAX_AGENT_TOOL_LENGTH) ??
    validateTextLength("Connection type", connectionType, MAX_CONNECTION_TYPE_LENGTH) ??
    validateJsonSize("Connection config", connectionConfig, MAX_CONNECTION_CONFIG_LENGTH) ??
    validateTextLength("Agent instructions", soulMd, MAX_AGENT_PROMPT_MD_LENGTH) ??
    validateTextLength("Agent collaboration instructions", agentsMd, MAX_AGENT_PROMPT_MD_LENGTH);

  if (lengthError) {
    return { ok: false, error: lengthError };
  }

  return {
    ok: true,
    payload: {
      name,
      role,
      emoji,
      color,
      engine,
      skills,
      tools,
      connectionType,
      connectionConfig,
      soulMd,
      agentsMd,
      externalConfig: body.external_config ? 1 : 0,
      active: body.active === false ? 0 : 1,
    },
  };
}

export function parseAgentListQuery(query: Record<string, unknown>) {
  return {
    limit: parseListLimit(typeof query.limit === "string" ? query.limit : undefined, {
      defaultLimit: DEFAULT_AGENT_LIST_LIMIT,
      maxLimit: MAX_AGENT_LIST_LIMIT,
    }),
  };
}

export function parseAgentRunListQuery(query: Record<string, unknown>) {
  return {
    limit: parseListLimit(typeof query.limit === "string" ? query.limit : undefined, {
      defaultLimit: DEFAULT_AGENT_RUN_LIST_LIMIT,
      maxLimit: MAX_AGENT_RUN_LIST_LIMIT,
    }),
  };
}

export function parseRelationshipListQuery(query: Record<string, unknown>) {
  return {
    limit: parseListLimit(typeof query.limit === "string" ? query.limit : undefined, {
      defaultLimit: DEFAULT_RELATIONSHIP_LIST_LIMIT,
      maxLimit: MAX_RELATIONSHIP_LIST_LIMIT,
    }),
  };
}

export function validateRelationshipPayload(input: RelationshipValidationInput): RelationshipValidationResult {
  if (!input.parentId || !input.childId) {
    return { ok: false, status: 400, error: "parent_id and child_id are required." };
  }
  if (input.parentId === input.childId) {
    return { ok: false, status: 400, error: "An agent cannot report to itself." };
  }
  if (!input.parentExists) {
    return { ok: false, status: 404, error: "Parent agent not found." };
  }
  if (!input.childExists) {
    return { ok: false, status: 404, error: "Child agent not found." };
  }
  if (input.parentActive === false) {
    return { ok: false, status: 409, error: "Parent agent is inactive." };
  }
  if (input.childActive === false) {
    return { ok: false, status: 409, error: "Child agent is inactive." };
  }
  if (input.parentEngineSupported === false) {
    return { ok: false, status: 409, error: "Parent agent engine is not supported." };
  }
  if (input.childEngineSupported === false) {
    return { ok: false, status: 409, error: "Child agent engine is not supported." };
  }
  if (input.relationshipExists) {
    return { ok: false, status: 409, error: "Relationship already exists." };
  }
  if (input.createsCycle) {
    return { ok: false, status: 409, error: "Relationship would create a reporting cycle." };
  }
  return { ok: true };
}

export function relationshipWouldCreateCycle(parentId: string, childId: string, relationships: Array<{ parent_id: string; child_id: string }>): boolean {
  const childrenByParent = new Map<string, string[]>();
  for (const relationship of relationships) {
    const children = childrenByParent.get(relationship.parent_id) ?? [];
    children.push(relationship.child_id);
    childrenByParent.set(relationship.parent_id, children);
  }

  const visited = new Set<string>();
  const stack = [childId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    if (current === parentId) {
      return true;
    }
    visited.add(current);
    stack.push(...(childrenByParent.get(current) ?? []));
  }

  return false;
}

export function parsePositionPayload(items: unknown[], knownAgentIds: ReadonlySet<string>): PositionPayloadResult {
  if (items.length > MAX_POSITION_PAYLOAD_COUNT) {
    return { ok: false, status: 413, error: `Positions payload must include ${MAX_POSITION_PAYLOAD_COUNT} or fewer entries.` };
  }

  const positions: PositionPayload[] = [];
  const seenAgentIds = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") {
      return { ok: false, status: 400, error: `Position ${index + 1} must be an object.` };
    }

    const row = item as Record<string, unknown>;
    const agentId = optionalString(row.agent_id);
    if (!agentId) {
      return { ok: false, status: 400, error: `Position ${index + 1} requires agent_id.` };
    }
    if (!knownAgentIds.has(agentId)) {
      return { ok: false, status: 404, error: `Agent not found for position ${index + 1}.` };
    }
    if (seenAgentIds.has(agentId)) {
      return { ok: false, status: 400, error: `Position ${index + 1} duplicates agent_id ${agentId}.` };
    }
    if (typeof row.x !== "number" || !Number.isFinite(row.x) || typeof row.y !== "number" || !Number.isFinite(row.y)) {
      return { ok: false, status: 400, error: `Position ${index + 1} requires finite x and y coordinates.` };
    }

    seenAgentIds.add(agentId);
    positions.push({ agent_id: agentId, x: row.x, y: row.y });
  }
  return { ok: true, positions };
}

export function validateAgentDeleteResult(changes: number): DeleteAgentResult {
  if (changes === 0) {
    return { ok: false, status: 404, error: "Agent not found." };
  }
  return { ok: true };
}

export function validateAgentDeleteBlockers(input: AgentDeleteBlockerInput): DeleteAgentResult {
  if (
    input.leadMissionCount > 0 ||
    input.assignedMissionCount > 0 ||
    input.assignedIssueCount > 0 ||
    input.runCount > 0 ||
    input.messageCount > 0 ||
    input.scheduleCount > 0
  ) {
    return {
      ok: false,
      status: 409,
      error: "Cannot delete this agent while it is linked to missions, issues, runs, messages, or schedules. Reassign or remove the linked work first.",
    };
  }
  return { ok: true };
}

export function formatEngineTestError(error: unknown): string {
  return error instanceof Error ? error.message : "Engine connection test failed.";
}

function readSavedEngineConfig(engineId: string): Record<string, unknown> {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(`engine.${engineId}`) as { value: string } | undefined;
  return parseJson<Record<string, unknown>>(row?.value, {});
}

function resolveMaskedConnectionConfig(
  engineId: string,
  nextConfig: Record<string, unknown>,
  fallbackConfig: Record<string, unknown>,
): Record<string, unknown> {
  const baseline = Object.keys(fallbackConfig).length > 0 ? fallbackConfig : readSavedEngineConfig(engineId);
  return mergeMaskedEngineConfig(engineId, nextConfig, baseline, engineMap);
}

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
    try {
      const config = (req.body as { config?: Record<string, unknown> }).config ?? {};
      const result = await adapter.test(resolveMaskedConnectionConfig(req.params.id, config, readSavedEngineConfig(req.params.id)));
      res.json({
        ...result,
        latency_ms: Date.now() - startedAt,
      });
    } catch (error) {
      res.status(400).json({ ok: false, message: formatEngineTestError(error), latency_ms: Date.now() - startedAt });
    }
  });

  app.get("/api/agents", (req, res) => {
    const filters = parseAgentListQuery(req.query);
    res.json({ agents: listAgents(filters) });
  });

  app.post("/api/agents", (req, res) => {
    const result = parseAgentPayload(req.body as Record<string, unknown>, engineMap);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const payload = result.payload;
    payload.connectionConfig = resolveMaskedConnectionConfig(payload.engine, payload.connectionConfig, readSavedEngineConfig(payload.engine));

    const id = randomUUID();
    const db = getDb();
    const createAgent = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO agents (
          id, name, role, emoji, color, engine, skills, tools, connection_type, connection_config,
          soul_md, agents_md, external_config, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        payload.name,
        payload.role,
        payload.emoji,
        payload.color,
        payload.engine,
        JSON.stringify(payload.skills),
        JSON.stringify(payload.tools),
        payload.connectionType,
        JSON.stringify(payload.connectionConfig),
        payload.soulMd,
        payload.agentsMd,
        payload.externalConfig,
        payload.active,
      );

      db.prepare("INSERT OR IGNORE INTO agent_positions (agent_id, x, y) VALUES (?, 0, 0)").run(id);
    });
    createAgent();

    const agent = getAgentById(id);
    res.status(201).json({ agent });
  });

  app.put("/api/agents/:id", (req, res) => {
    const result = parseAgentPayload(req.body as Record<string, unknown>, engineMap);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const payload = result.payload;
    const existing = getDb().prepare("SELECT engine, connection_config FROM agents WHERE id = ?").get(req.params.id) as
      | { engine: string; connection_config: string | null }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const existingConfig = existing.engine === payload.engine
      ? parseJson<Record<string, unknown>>(existing.connection_config, {})
      : readSavedEngineConfig(payload.engine);
    payload.connectionConfig = resolveMaskedConnectionConfig(payload.engine, payload.connectionConfig, existingConfig);

    const update = getDb()
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
        payload.name,
        payload.role,
        payload.emoji,
        payload.color,
        payload.engine,
        JSON.stringify(payload.skills),
        JSON.stringify(payload.tools),
        payload.connectionType,
        JSON.stringify(payload.connectionConfig),
        payload.soulMd,
        payload.agentsMd,
        payload.externalConfig,
        payload.active,
        req.params.id,
      );
    const agent = getAgentById(req.params.id);
    res.json({ agent });
  });

  app.delete("/api/agents/:id", (req, res) => {
    const db = getDb();
    const leadMissions = db.prepare("SELECT COUNT(*) AS count FROM missions WHERE lead_agent_id = ?").get(req.params.id) as { count: number };
    const assignedMissions = db.prepare("SELECT COUNT(*) AS count FROM mission_agents WHERE agent_id = ?").get(req.params.id) as { count: number };
    const assignedIssues = db.prepare("SELECT COUNT(*) AS count FROM issues WHERE assignee_agent_id = ?").get(req.params.id) as { count: number };
    const runs = db.prepare("SELECT COUNT(*) AS count FROM runs WHERE agent_id = ?").get(req.params.id) as { count: number };
    const messages = db
      .prepare("SELECT COUNT(*) AS count FROM agent_messages WHERE from_agent_id = ? OR to_agent_id = ?")
      .get(req.params.id, req.params.id) as { count: number };
    const schedules = db.prepare("SELECT COUNT(*) AS count FROM schedules WHERE agent_id = ?").get(req.params.id) as { count: number };
    const blockers = validateAgentDeleteBlockers({
      leadMissionCount: leadMissions.count,
      assignedMissionCount: assignedMissions.count,
      assignedIssueCount: assignedIssues.count,
      runCount: runs.count,
      messageCount: messages.count,
      scheduleCount: schedules.count,
    });
    if (!blockers.ok) {
      res.status(blockers.status).json({ error: blockers.error });
      return;
    }

    const result = getDb().prepare("DELETE FROM agents WHERE id = ?").run(req.params.id);
    const validation = validateAgentDeleteResult(result.changes);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
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
    try {
      const result = await adapter.test(parseJson<Record<string, unknown>>(String(row.connection_config ?? "{}"), {}));
      res.json({ ...result, latency_ms: Date.now() - startedAt });
    } catch (error) {
      res.status(400).json({ ok: false, message: formatEngineTestError(error), latency_ms: Date.now() - startedAt });
    }
  });

  app.get("/api/agents/:id/runs", (req, res) => {
    const agentExists = Boolean(getDb().prepare("SELECT 1 FROM agents WHERE id = ?").get(req.params.id));
    if (!agentExists) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }
    const filters = parseAgentRunListQuery(req.query);
    res.json({ runs: listRuns({ agentId: req.params.id, limit: filters.limit }) });
  });

  // ── Relationships ──

  app.get("/api/relationships", (req, res) => {
    const filters = parseRelationshipListQuery(req.query);
    const relationships = getDb()
      .prepare("SELECT * FROM agent_relationships ORDER BY parent_id, child_id LIMIT ?")
      .all(filters.limit);
    res.json({ relationships });
  });

  app.post("/api/relationships", (req, res) => {
    const parentId = optionalString((req.body as { parent_id?: unknown }).parent_id);
    const childId = optionalString((req.body as { child_id?: unknown }).child_id);
    const parent = parentId
      ? (getDb().prepare("SELECT active, engine FROM agents WHERE id = ?").get(parentId) as { active: number | null; engine: string | null } | undefined)
      : undefined;
    const child = childId
      ? (getDb().prepare("SELECT active, engine FROM agents WHERE id = ?").get(childId) as { active: number | null; engine: string | null } | undefined)
      : undefined;
    const parentExists = Boolean(parent);
    const childExists = Boolean(child);
    const relationshipExists = parentId && childId
      ? Boolean(getDb().prepare("SELECT 1 FROM agent_relationships WHERE parent_id = ? AND child_id = ?").get(parentId, childId))
      : false;
    const existingRelationships = getDb().prepare("SELECT parent_id, child_id FROM agent_relationships").all() as Array<{ parent_id: string; child_id: string }>;
    const createsCycle = parentId && childId ? relationshipWouldCreateCycle(parentId, childId, existingRelationships) : false;
    const validation = validateRelationshipPayload({
      parentId,
      childId,
      parentExists,
      childExists,
      parentActive: parent ? parent.active === 1 : undefined,
      childActive: child ? child.active === 1 : undefined,
      parentEngineSupported: parent ? engineMap.has(String(parent.engine)) : undefined,
      childEngineSupported: child ? engineMap.has(String(child.engine)) : undefined,
      relationshipExists,
      createsCycle,
    });
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
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
    const deleteResult = getDb().prepare("DELETE FROM agent_relationships WHERE id = ?").run(req.params.id);
    if (deleteResult.changes === 0) {
      res.status(404).json({ error: "Relationship not found." });
      return;
    }
    res.json({ ok: true });
  });

  // ── Positions ──

  app.put("/api/positions", (req, res) => {
    const positions = Array.isArray(req.body) ? req.body : (req.body as { positions?: unknown[] }).positions;
    if (!Array.isArray(positions)) {
      res.status(400).json({ error: "Positions payload must be an array." });
      return;
    }

    const knownAgentIds = new Set((getDb().prepare("SELECT id FROM agents").all() as Array<{ id: string }>).map((agent) => agent.id));
    const parsed = parsePositionPayload(positions, knownAgentIds);
    if (!parsed.ok) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }

    const insert = getDb().prepare(
      `
      INSERT INTO agent_positions (agent_id, x, y)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET x = excluded.x, y = excluded.y
      `,
    );
    const transaction = getDb().transaction((items: PositionPayload[]) => {
      for (const item of items) {
        insert.run(item.agent_id, item.x, item.y);
      }
    });
    transaction(parsed.positions);
    res.json({ ok: true });
  });
}
