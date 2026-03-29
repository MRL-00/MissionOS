import {
  MISSION_PROVIDER_LABELS,
  OPENCLAW_ACTIVITY_WINDOW_MINUTES,
} from "./types";
import type {
  MissionProvider,
  ProviderAgentRecord,
  ProviderConnector,
  ProviderHealth,
  ProviderScheduleEntry,
} from "../src/mission/types";

export interface ProviderConnectorSyncConfig extends ProviderConnector {
  token?: string | undefined;
}

export interface ProviderSyncResult {
  health: ProviderHealth;
  agents: ProviderAgentRecord[];
  schedules: ProviderScheduleEntry[];
}

interface TimedJsonResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  data: unknown;
  message?: string | undefined;
}

const REQUEST_TIMEOUT_MS = 8000;

function ensureBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function openClawActivityWindows(): number[] {
  return Array.from(new Set([
    OPENCLAW_ACTIVITY_WINDOW_MINUTES,
    Math.max(OPENCLAW_ACTIVITY_WINDOW_MINUTES, 60),
  ]));
}

function providerToken(connector: ProviderConnectorSyncConfig): string {
  if (connector.authMode !== "bearer") {
    return "";
  }
  return connector.token?.trim() ?? "";
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) {
      return direct > 10_000_000_000 ? direct : direct * 1000;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function extractOpenClawMessageText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractOpenClawMessageText(item);
      if (text) {
        return text;
      }
    }
    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return (
    extractOpenClawMessageText(record.text)
    ?? extractOpenClawMessageText(record.content)
    ?? extractOpenClawMessageText(record.parts)
    ?? extractOpenClawMessageText(record.message)
  );
}

function normalizeStatus(value: unknown): ProviderAgentRecord["status"] {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.includes("run") || normalized.includes("work") || normalized.includes("active") || normalized.includes("busy")) {
    return "working";
  }
  if (normalized.includes("idle") || normalized.includes("ready") || normalized.includes("sleep")) {
    return "idle";
  }
  if (normalized.includes("off") || normalized.includes("down")) {
    return "offline";
  }
  return "unknown";
}

function extractCollection(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === "object" && Array.isArray((candidate as { nodes?: unknown[] }).nodes)) {
      return (candidate as { nodes: unknown[] }).nodes;
    }
  }

  return [];
}

function extractOpenClawSessionRows(value: unknown): unknown[] {
  const direct = extractCollection(value, ["sessions"]);
  if (direct.length > 0) {
    return direct;
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const detailsRows = extractCollection(record.details, ["sessions"]);
  if (detailsRows.length > 0) {
    return detailsRows;
  }

  const result = record.result;
  if (typeof result !== "object" || result === null) {
    return [];
  }

  const resultRecord = result as Record<string, unknown>;
  const nestedDetailsRows = extractCollection(resultRecord.details, ["sessions"]);
  if (nestedDetailsRows.length > 0) {
    return nestedDetailsRows;
  }

  const content = Array.isArray(resultRecord.content) ? resultRecord.content : [];
  for (const entry of content) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const text = (entry as { text?: unknown }).text;
    if (typeof text !== "string" || !text.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      const parsedRows = extractCollection(parsed, ["sessions"]);
      if (parsedRows.length > 0) {
        return parsedRows;
      }
    } catch {
      // Ignore tool content that is not JSON.
    }
  }

  return [];
}

function responseMessage(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.trim()) {
    return data.trim();
  }
  if (typeof data !== "object" || data === null) {
    return fallback;
  }

  const record = data as Record<string, unknown>;
  const candidates = [
    record.message,
    record.error,
    record.detail,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === "object" && candidate !== null) {
      const nested = (candidate as Record<string, unknown>).message;
      if (typeof nested === "string" && nested.trim()) {
        return nested.trim();
      }
    }
  }

  return fallback;
}

async function fetchJsonWithTimeout(
  connector: ProviderConnectorSyncConfig,
  path: string,
  init: RequestInit = {},
): Promise<TimedJsonResult> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const token = providerToken(connector);

  try {
    const response = await fetch(`${ensureBaseUrl(connector.baseUrl ?? "")}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const latencyMs = Date.now() - startedAt;
    const rawText = await response.text().catch(() => "");

    let data: unknown = null;
    if (rawText) {
      try {
        data = JSON.parse(rawText) as unknown;
      } catch {
        data = rawText;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
      data,
      message: response.ok ? undefined : responseMessage(data, `HTTP ${response.status}`),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      data: null,
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function tryJsonCandidates(
  connector: ProviderConnectorSyncConfig,
  candidates: Array<{ path: string; init?: RequestInit }>,
): Promise<TimedJsonResult | null> {
  for (const candidate of candidates) {
    const result = await fetchJsonWithTimeout(connector, candidate.path, candidate.init);
    if (result.ok) {
      return result;
    }
    if (result.status !== 404 && result.status !== 405) {
      return result;
    }
  }
  return null;
}

function normalizeAgentRecord(provider: MissionProvider, value: unknown, index: number): ProviderAgentRecord | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return {
      provider,
      externalId: trimmed,
      name: trimmed,
      status: "unknown",
      imported: false,
    };
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const externalId = [
    record.id,
    record.agentId,
    record.key,
    record.slug,
    record.name,
  ].find((entry) => typeof entry === "string" && entry.trim().length > 0);
  const name = [
    record.displayName,
    record.name,
    record.label,
    record.title,
  ].find((entry) => typeof entry === "string" && entry.trim().length > 0);

  if (typeof externalId !== "string" || typeof name !== "string") {
    return null;
  }

  const runtimeBaseUrl = [record.runtimeBaseUrl, record.baseUrl, record.url]
    .find((entry) => typeof entry === "string" && entry.trim().length > 0);

  return {
    provider,
    externalId: externalId.trim(),
    name: name.trim(),
    role: typeof record.role === "string" ? record.role : undefined,
    status: normalizeStatus(record.status ?? record.state ?? record.activity ?? record.mode),
    task: typeof record.task === "string"
      ? record.task
      : typeof record.currentTask === "string"
        ? record.currentTask
        : typeof record.summary === "string"
          ? record.summary
          : undefined,
    lastSeenAt: parseTimestamp(record.lastSeenAt ?? record.updatedAt ?? record.timestamp ?? record.lastActiveAt),
    runtimeBaseUrl: typeof runtimeBaseUrl === "string" ? runtimeBaseUrl.trim() : undefined,
    imported: false,
  };
}

function normalizeScheduleRecord(provider: MissionProvider, value: unknown, index: number): ProviderScheduleEntry | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const idCandidate = [record.id, record.key, record.slug, record.name]
    .find((entry) => typeof entry === "string" && entry.trim().length > 0);
  const nameCandidate = [record.name, record.label, record.title]
    .find((entry) => typeof entry === "string" && entry.trim().length > 0);
  const recurrenceCandidate = [record.recurrence, record.cron, record.schedule, record.expression]
    .find((entry) => typeof entry === "string" && entry.trim().length > 0);

  if (typeof idCandidate !== "string" || typeof nameCandidate !== "string") {
    return null;
  }

  return {
    id: `${provider}:${idCandidate.trim()}:${index}`,
    provider,
    name: nameCandidate.trim(),
    recurrence: typeof recurrenceCandidate === "string" ? recurrenceCandidate.trim() : "Unknown cadence",
    nextRunAt: parseTimestamp(record.nextRunAt ?? record.nextRun ?? record.nextExecutionAt),
    lastRunAt: parseTimestamp(record.lastRunAt ?? record.lastRun ?? record.lastExecutionAt),
    targetAgentExternalId:
      typeof record.targetAgentId === "string"
        ? record.targetAgentId
        : typeof record.agentId === "string"
          ? record.agentId
          : undefined,
    targetLabel:
      typeof record.targetLabel === "string"
        ? record.targetLabel
        : typeof record.agentName === "string"
          ? record.agentName
          : undefined,
    status: typeof record.status === "string"
      ? ((["scheduled", "running", "paused", "error", "unknown"].includes(record.status.toLowerCase())
          ? record.status.toLowerCase()
          : "unknown") as ProviderScheduleEntry["status"])
      : "unknown",
    sourceUrl: typeof record.url === "string" ? record.url : undefined,
  };
}

function normalizeOpenClawSessionAgents(value: unknown): ProviderAgentRecord[] {
  const rows = extractOpenClawSessionRows(value);

  return rows.flatMap((row, index) => {
    if (typeof row !== "object" || row === null) {
      return [];
    }

    const record = row as Record<string, unknown>;
    const rawKey = typeof record.sessionKey === "string"
      ? record.sessionKey
      : typeof record.key === "string"
        ? record.key
        : undefined;
    if (!rawKey) {
      return [];
    }

    const explicitAgentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
    const externalId = explicitAgentId || rawKey.replace(/^agent:/, "").split(":")[0] || `session-${index}`;
    const name = typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : externalId;
    const lastMessage = Array.isArray(record.messages) ? record.messages.at(-1) : undefined;
    const task = typeof record.task === "string"
      ? record.task.trim() || undefined
      : extractOpenClawMessageText(lastMessage);

    return [{
      provider: "openclaw",
      externalId,
      name,
      status: normalizeStatus(record.status ?? "active"),
      task,
      lastSeenAt: Date.now(),
      imported: false,
    } satisfies ProviderAgentRecord];
  });
}

async function buildHealth(connector: ProviderConnectorSyncConfig): Promise<ProviderHealth> {
  const { provider } = connector;
  if (!connector.enabled || !connector.baseUrl) {
    return {
      provider,
      status: "disabled",
      checkedAt: Date.now(),
      message: "Connector disabled.",
      activeAgents: 0,
      schedules: 0,
    };
  }

  const health = await tryJsonCandidates(connector, [
    { path: "/health" },
    { path: "/api/health" },
    { path: "/api/status" },
  ]);

  if (!health) {
    return {
      provider,
      status: "ok",
      checkedAt: Date.now(),
      activeAgents: 0,
      schedules: 0,
      message: `${MISSION_PROVIDER_LABELS[provider]} reachable.`,
    };
  }

  return {
    provider,
    status: health.ok ? "ok" : "error",
    checkedAt: Date.now(),
    latencyMs: health.latencyMs,
    message: health.ok
      ? `${MISSION_PROVIDER_LABELS[provider]} reachable.`
      : health.message ?? `${MISSION_PROVIDER_LABELS[provider]} health check failed.`,
    activeAgents: 0,
    schedules: 0,
  };
}

async function syncOpenClaw(connector: ProviderConnectorSyncConfig): Promise<ProviderSyncResult> {
  const baseHealth = await buildHealth(connector);
  if (!connector.enabled || !connector.baseUrl) {
    return { health: baseHealth, agents: [], schedules: [] };
  }

  let sessionsResult: TimedJsonResult | null = null;
  let sessionAgents: ProviderAgentRecord[] = [];
  for (const activeMinutes of openClawActivityWindows()) {
    sessionsResult = await tryJsonCandidates(connector, [
      {
        path: `/api/sessions?activeMinutes=${activeMinutes}&messageLimit=1`,
      },
      {
        path: "/tools/invoke",
        init: {
          method: "POST",
          body: JSON.stringify({
            tool: "sessions_list",
            action: "json",
            sessionKey: "main",
            args: {
              activeMinutes,
              messageLimit: 1,
            },
          }),
        },
      },
    ]);
    sessionAgents = sessionsResult ? normalizeOpenClawSessionAgents(sessionsResult.data) : [];
    if (sessionAgents.length > 0 || !sessionsResult?.ok) {
      break;
    }
  }

  const rosterResult = await tryJsonCandidates(connector, [
    { path: "/api/agents" },
    { path: "/api/roster" },
    { path: "/api/provider/agents" },
  ]);
  const schedulesResult = await tryJsonCandidates(connector, [
    { path: "/api/schedules" },
    { path: "/api/cron" },
    { path: "/api/jobs" },
  ]);

  const rosterAgents = extractCollection(rosterResult?.data, ["agents", "roster", "items"])
    .map((item, index) => normalizeAgentRecord("openclaw", item, index))
    .filter((item): item is ProviderAgentRecord => Boolean(item));
  const schedules = extractCollection(schedulesResult?.data, ["schedules", "jobs", "items"])
    .map((item, index) => normalizeScheduleRecord("openclaw", item, index))
    .filter((item): item is ProviderScheduleEntry => Boolean(item));
  const discoveryUnavailable = !sessionsResult && !rosterResult;

  const merged = new Map<string, ProviderAgentRecord>();
  for (const entry of rosterAgents) {
    merged.set(entry.externalId, entry);
  }
  for (const entry of sessionAgents) {
    const existing = merged.get(entry.externalId);
    merged.set(entry.externalId, existing ? { ...existing, ...entry, name: existing.name || entry.name } : entry);
  }

  const health: ProviderHealth = {
    ...baseHealth,
    status: discoveryUnavailable
      ? "error"
      : sessionsResult && !sessionsResult.ok
        ? "error"
        : baseHealth.status,
    message: discoveryUnavailable
      ? "OpenClaw is reachable, but none of the supported roster or session endpoints responded."
      : sessionsResult && !sessionsResult.ok
        ? sessionsResult.message ?? "OpenClaw session sync failed."
        : `OpenClaw synced ${merged.size} agent${merged.size === 1 ? "" : "s"} and ${schedules.length} schedule${schedules.length === 1 ? "" : "s"}.`,
    activeAgents: Array.from(merged.values()).filter((entry) => entry.status === "working").length,
    schedules: schedules.length,
    checkedAt: Date.now(),
    latencyMs: sessionsResult?.latencyMs ?? baseHealth.latencyMs,
  };

  return {
    health,
    agents: Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name)),
    schedules,
  };
}

async function syncHermes(connector: ProviderConnectorSyncConfig): Promise<ProviderSyncResult> {
  const baseHealth = await buildHealth(connector);
  if (!connector.enabled || !connector.baseUrl) {
    return { health: baseHealth, agents: [], schedules: [] };
  }

  const agentsResult = await tryJsonCandidates(connector, [
    { path: "/api/agents" },
    { path: "/api/roster" },
    { path: "/api/provider/agents" },
  ]);
  const activeWorkResult = await tryJsonCandidates(connector, [
    { path: "/api/active-work" },
    { path: "/api/tasks/active" },
    { path: "/api/work/active" },
  ]);
  const schedulesResult = await tryJsonCandidates(connector, [
    { path: "/api/schedules" },
    { path: "/api/jobs" },
    { path: "/api/cron" },
  ]);

  const agents = extractCollection(agentsResult?.data, ["agents", "roster", "items"])
    .map((item, index) => normalizeAgentRecord("hermes", item, index))
    .filter((item): item is ProviderAgentRecord => Boolean(item));
  const activeWork = extractCollection(activeWorkResult?.data, ["agents", "items", "activeWork", "work"])
    .map((item, index) => normalizeAgentRecord("hermes", item, index))
    .filter((item): item is ProviderAgentRecord => Boolean(item));
  const schedules = extractCollection(schedulesResult?.data, ["schedules", "jobs", "items"])
    .map((item, index) => normalizeScheduleRecord("hermes", item, index))
    .filter((item): item is ProviderScheduleEntry => Boolean(item));
  const discoveryUnavailable = !agentsResult && !activeWorkResult;

  const merged = new Map<string, ProviderAgentRecord>();
  for (const entry of agents) {
    merged.set(entry.externalId, entry);
  }
  for (const entry of activeWork) {
    const existing = merged.get(entry.externalId);
    merged.set(entry.externalId, existing ? { ...existing, ...entry, name: existing.name || entry.name } : entry);
  }

  const health: ProviderHealth = {
    ...baseHealth,
    status: discoveryUnavailable || baseHealth.status === "error" || agentsResult?.ok === false ? "error" : "ok",
    message: discoveryUnavailable
      ? "Hermes is reachable, but none of the supported roster endpoints responded."
      : agentsResult?.ok === false
        ? agentsResult.message ?? "Hermes agent sync failed."
        : `Hermes synced ${merged.size} agent${merged.size === 1 ? "" : "s"} and ${schedules.length} schedule${schedules.length === 1 ? "" : "s"}.`,
    activeAgents: Array.from(merged.values()).filter((entry) => entry.status === "working").length,
    schedules: schedules.length,
    checkedAt: Date.now(),
    latencyMs: agentsResult?.latencyMs ?? activeWorkResult?.latencyMs ?? baseHealth.latencyMs,
  };

  return {
    health,
    agents: Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name)),
    schedules,
  };
}

export async function syncProviderConnector(connector: ProviderConnectorSyncConfig): Promise<ProviderSyncResult> {
  if (connector.provider === "openclaw") {
    return syncOpenClaw(connector);
  }
  return syncHermes(connector);
}
