import { readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import defaultAppearancesJson from "../src/config/default-appearances.json";
import { createDeterministicAppearance, getKnownDeskIndex } from "../src/agentDefaults";
import { FACILITATOR_ROTATION } from "../src/config/meeting-rules";
import type {
  Accessory,
  ActivityLogEntry,
  AgentAppearance,
  AgentBackendLink,
  AgentCompleteRequest,
  AgentConfig,
  AgentEvent,
  AgentEventLocation,
  AgentRegistration,
  AgentRuntimeState,
  AgentSnapshotState,
  AgentSpawnRequest,
  MeetingConfig,
  MeetingRequest,
  MeetingRunRequest,
  MeetingScript,
  MeetingSpeed,
  MeetingType,
  RealtimeAgentStatus,
  ServerMessage,
} from "../src/types";
import { handleClaudeAuth } from "./auth/claude";
import { handleCodexAuth } from "./auth/codex";
import { ensureDataDir } from "./auth/storage";
import { MeetingEngine } from "./meeting";

process.loadEnvFile?.();

const PORT = 3001;
const OPENCLAW_URL = process.env.OPENCLAW_URL?.trim() ?? "";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN ?? "";
const OPENCLAW_ACTIVITY_WINDOW_MINUTES = Math.max(1, Number(process.env.OPENCLAW_ACTIVITY_WINDOW_MINUTES ?? "5") || 5);
const OPENCLAW_POLL_INTERVAL_MS = Math.max(1000, Number(process.env.OPENCLAW_POLL_INTERVAL_MS ?? "5000") || 5000);
const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Content-Type": "application/json",
} as const;

const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOG_ENTRIES = 180;
const DESK_COUNT = 10;
const VALID_STATUSES = new Set<RealtimeAgentStatus>(["idle", "working", "meeting", "entering", "leaving"]);
const VALID_LOCATIONS = new Set<AgentEventLocation>(["desk", "meeting-room", "door", "cio-office"]);
const VALID_MEETING_TYPES = new Set<MeetingType>(["standup", "strategy", "review"]);
const VALID_SPEEDS = new Set<MeetingSpeed>([1, 2, 3]);
const VALID_AGENT_TYPES = new Set<NonNullable<AgentRegistration["type"]>>(["resident", "visitor"]);
const VALID_BACKEND_PROVIDERS = new Set<AgentBackendLink["provider"]>(["openclaw", "claude", "codex", "unlinked"]);
const VALID_ACCESSORIES = new Set<Accessory>(["glasses", "hat", "tie", "beard"]);
const defaultAppearanceConfigs = defaultAppearancesJson as AgentConfig[];
const defaultAppearances = new Map(defaultAppearanceConfigs.map((agent) => [agent.id, agent]));
const dataDir = path.resolve(process.cwd(), "data");
const agentsFilePath = path.join(dataDir, "agents.json");

interface PersistedAgentRecord extends AgentRegistration {
  id: string;
  name: string;
  role: string;
  emoji: string;
  type: "resident" | "visitor";
  appearance: AgentAppearance;
  backendLink: AgentBackendLink;
  deskIndex?: number | undefined;
}

interface PersistedAgentsFile {
  agents: PersistedAgentRecord[];
}

interface OpenClawSessionInfo {
  sessionKey: string;
  status: string;
  agentId?: string | undefined;
  label?: string | undefined;
  task?: string | undefined;
}

interface OpenClawSessionListRow {
  key?: string | undefined;
  displayName?: string | undefined;
  messages?: unknown[] | undefined;
}

const OPENCLAW_AGENT_MAP = {
  main: "pickle",
  pickle: "pickle",
  zoe: "zoe",
  ink: "ink",
  harry: "harry",
  kevin: "kevin",
  danny: "danny",
  johnny: "johnny",
  tommy: "tommy",
  randall: "randall",
} as const satisfies Record<string, string>;

class RequestBodyError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.statusCode = statusCode;
  }
}

const agentStates = new Map<string, AgentRuntimeState>();
const agentAppearances = new Map<string, AgentAppearance>();
const activityLog: ActivityLogEntry[] = [];
const transitionTimers = new Map<string, NodeJS.Timeout>();
const residentDeskAssignments = new Map<string, number>();
const openClawStates = new Map<string, { openClawAgentId: string; status: "idle" | "working"; task?: string | undefined }>();
let websocketServer: WebSocketServer;

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, DEFAULT_HEADERS);
  response.end(JSON.stringify(body));
}

async function readJson<T>(request: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new RequestBodyError("Request body too large");
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new RequestBodyError("Invalid JSON payload");
  }
}

function isRealtimeAgentStatus(value: unknown): value is RealtimeAgentStatus {
  return typeof value === "string" && VALID_STATUSES.has(value as RealtimeAgentStatus);
}

function isAgentEventLocation(value: unknown): value is AgentEventLocation {
  return typeof value === "string" && VALID_LOCATIONS.has(value as AgentEventLocation);
}

function isAgentAppearance(value: unknown): value is AgentAppearance {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const appearance = value as Partial<AgentAppearance>;
  return (
    (appearance.height === undefined || typeof appearance.height === "number") &&
    (appearance.headShape === "round" || appearance.headShape === "oval" || appearance.headShape === "square") &&
    typeof appearance.skinColor === "string" &&
    (appearance.hairStyle === "none" ||
      appearance.hairStyle === "short" ||
      appearance.hairStyle === "long" ||
      appearance.hairStyle === "mohawk" ||
      appearance.hairStyle === "messy" ||
      appearance.hairStyle === "slicked" ||
      appearance.hairStyle === "buzz" ||
      appearance.hairStyle === "curly") &&
    typeof appearance.hairColor === "string" &&
    typeof appearance.bodyColor === "string" &&
    typeof appearance.pantsColor === "string" &&
    (appearance.accessories === undefined ||
      (Array.isArray(appearance.accessories) && appearance.accessories.every((accessory) => VALID_ACCESSORIES.has(accessory as Accessory))))
  );
}

function isBackendLink(value: unknown): value is AgentBackendLink {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const link = value as Partial<AgentBackendLink>;
  return (
    VALID_BACKEND_PROVIDERS.has(link.provider as AgentBackendLink["provider"]) &&
    typeof link.connected === "boolean" &&
    (link.agentId === undefined || typeof link.agentId === "string") &&
    (link.tokenId === undefined || typeof link.tokenId === "string") &&
    (link.connectedAt === undefined || typeof link.connectedAt === "number")
  );
}

function isRegistration(value: unknown): value is AgentRegistration {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const registration = value as Partial<AgentRegistration>;
  return (
    typeof registration.id === "string" &&
    typeof registration.name === "string" &&
    typeof registration.role === "string" &&
    (registration.emoji === undefined || typeof registration.emoji === "string") &&
    (registration.type === undefined || VALID_AGENT_TYPES.has(registration.type)) &&
    (registration.appearance === undefined || isAgentAppearance(registration.appearance)) &&
    (registration.backendLink === undefined || isBackendLink(registration.backendLink))
  );
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Partial<AgentEvent>;
  return (
    typeof event.agentId === "string" &&
    VALID_STATUSES.has(event.status as RealtimeAgentStatus) &&
    (event.location === undefined || VALID_LOCATIONS.has(event.location as AgentEventLocation)) &&
    typeof event.timestamp === "number"
  );
}

function isMeetingRequest(value: unknown): value is MeetingRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<MeetingRequest>;
  return Array.isArray(request.agentIds) && request.agentIds.every((agentId) => typeof agentId === "string");
}

function isAgentSpawnRequest(value: unknown): value is AgentSpawnRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<AgentSpawnRequest>;
  return typeof request.agentId === "string" && typeof request.task === "string";
}

function isAgentCompleteRequest(value: unknown): value is AgentCompleteRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<AgentCompleteRequest>;
  return typeof request.agentId === "string";
}

function isMeetingConfig(value: unknown): value is MeetingConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const config = value as Partial<MeetingConfig>;
  return (
    VALID_MEETING_TYPES.has(config.type as MeetingType) &&
    Array.isArray(config.participants) &&
    config.participants.every((agentId) => typeof agentId === "string") &&
    typeof config.facilitatorId === "string" &&
    (config.topic === undefined || typeof config.topic === "string") &&
    (config.presenter === undefined || typeof config.presenter === "string")
  );
}

function isMeetingTurn(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const turn = value as Partial<MeetingScript["turns"][number]>;
  return typeof turn.agentId === "string" && typeof turn.message === "string" && typeof turn.timestamp === "number";
}

function isMeetingRunRequest(value: unknown): value is MeetingRunRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<MeetingRunRequest>;
  const script = request.script as Partial<MeetingScript> | undefined;
  return (
    !!script &&
    isMeetingConfig(script.config) &&
    Array.isArray(script.turns) &&
    script.turns.every((turn) => isMeetingTurn(turn)) &&
    typeof script.summary === "string" &&
    (request.speed === undefined || VALID_SPEEDS.has(request.speed as MeetingSpeed))
  );
}

function getOrderedStates(): AgentRuntimeState[] {
  return Array.from(agentStates.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function buildSnapshotStates(): AgentSnapshotState[] {
  return getOrderedStates().map((state) => ({
    ...state,
    appearance: agentAppearances.get(state.id) ?? resolveAppearance(state).appearance,
  }));
}

function broadcast(message: ServerMessage): void {
  if (!websocketServer) {
    return;
  }

  const payload = JSON.stringify(message);
  websocketServer.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastSnapshot(): void {
  broadcast({
    type: "agents-snapshot",
    agents: buildSnapshotStates(),
  });
}

function pushActivity(kind: ActivityLogEntry["kind"], message: string, agentId?: string): ActivityLogEntry {
  const entry: ActivityLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    kind,
    message,
    agentId,
  };
  activityLog.unshift(entry);
  activityLog.splice(MAX_LOG_ENTRIES);
  broadcast({
    type: "activity-log",
    entry,
  });
  return entry;
}

function formatStatusActivity(state: AgentRuntimeState, event: AgentEvent): string {
  switch (event.status) {
    case "entering":
      return `${state.name} is moving to ${event.location ?? "the office"}.`;
    case "leaving":
      return `${state.name} is leaving the office.`;
    case "working":
      return `${state.name} is working${event.task ? ` on ${event.task}` : ""}.`;
    case "meeting":
      return `${state.name} is in a meeting.`;
    case "idle":
    default:
      return `${state.name} is idle${event.task ? ` after ${event.task}` : ""}.`;
  }
}

function pushAgentMessageActivity(
  kind: Extract<ActivityLogEntry["kind"], "agent-message" | "meeting-turn">,
  state: AgentRuntimeState,
  message?: string,
): void {
  const trimmed = message?.trim();
  if (!trimmed) {
    return;
  }
  pushActivity(kind, `${state.name}: ${trimmed}`, state.id);
}

function getAvailableDeskIndex(excludedAgentId?: string): number | undefined {
  const occupied = new Set<number>();

  agentStates.forEach((state) => {
    if (state.id !== excludedAgentId && typeof state.deskIndex === "number") {
      occupied.add(state.deskIndex);
    }
  });

  for (let deskIndex = 0; deskIndex < DESK_COUNT; deskIndex += 1) {
    if (!occupied.has(deskIndex)) {
      return deskIndex;
    }
  }

  return undefined;
}

function resolveAppearance(registration: AgentRegistration): { appearance: AgentAppearance; emoji: string } {
  const fallback = defaultAppearances.get(registration.id);
  return {
    appearance: registration.appearance ?? fallback?.appearance ?? createDeterministicAppearance(registration.id),
    emoji: registration.emoji ?? fallback?.emoji ?? "🙂",
  };
}

function normalizeBackendLink(
  incoming?: AgentBackendLink,
  existing?: AgentBackendLink,
): AgentBackendLink {
  const base = incoming ?? existing;
  if (!base || base.provider === "unlinked") {
    return {
      provider: "unlinked",
      connected: false,
    };
  }

  return {
    provider: base.provider,
    connected: base.connected,
    agentId: base.agentId,
    tokenId: base.tokenId,
    connectedAt: base.connectedAt ?? (base.connected ? Date.now() : undefined),
  };
}

function resolveDeskIndex(registration: AgentRegistration, existing?: AgentRuntimeState): number {
  // If the request explicitly provides a deskIndex, use it
  if (typeof registration.deskIndex === "number") {
    return registration.deskIndex;
  }
  if (typeof existing?.deskIndex === "number" && (registration.type ?? existing.type) === existing.type) {
    return existing.deskIndex;
  }

  const agentType = registration.type ?? existing?.type ?? "visitor";

  if (agentType === "resident") {
    const reservedDesk = residentDeskAssignments.get(registration.id) ?? getKnownDeskIndex(registration.id);
    if (reservedDesk !== undefined) {
      residentDeskAssignments.set(registration.id, reservedDesk);
      const occupyingAgent = Array.from(agentStates.values()).find(
        (state) => state.id !== registration.id && state.deskIndex === reservedDesk,
      );
      if (!occupyingAgent) {
        return reservedDesk;
      }
    }

    const availableDesk = getAvailableDeskIndex(registration.id);
    if (availableDesk === undefined) {
      throw new RequestBodyError("No desks available", 409);
    }
    residentDeskAssignments.set(registration.id, availableDesk);
    return availableDesk;
  }

  residentDeskAssignments.delete(registration.id);
  const availableDesk = getAvailableDeskIndex(registration.id);
  if (availableDesk === undefined) {
    throw new RequestBodyError("No desks available", 409);
  }
  return availableDesk;
}

function ensureAgentState(agentId: string): AgentRuntimeState {
  const existing = agentStates.get(agentId);
  if (existing) {
    return existing;
  }

  const fallbackAppearance = resolveAppearance({
    id: agentId,
    name: agentId,
    role: "Temporary Agent",
  });
  const fallback: AgentRuntimeState = {
    id: agentId,
    name: agentId,
    role: "Temporary Agent",
    emoji: fallbackAppearance.emoji,
    backendLink: normalizeBackendLink(),
    connected: true,
    type: "visitor",
    status: "idle",
    location: "desk",
    timestamp: Date.now(),
  };
  agentStates.set(agentId, fallback);
  agentAppearances.set(agentId, fallbackAppearance.appearance);
  return fallback;
}

function applyEvent(event: AgentEvent): AgentRuntimeState {
  const current = ensureAgentState(event.agentId);
  const next: AgentRuntimeState = {
    ...current,
    connected: true,
    status: event.status,
    timestamp: event.timestamp,
  };

  if (event.task !== undefined) {
    next.task = event.task;
  }
  if (event.message !== undefined) {
    next.message = event.message;
  }
  if (event.location !== undefined) {
    next.location = event.location;
  }

  agentStates.set(event.agentId, next);
  broadcast({
    type: "agent-event",
    event,
  });
  return next;
}

function scheduleTransition(agentId: string, callback: () => void | Promise<void>, delayMs: number): void {
  cancelTransitionTimer(agentId);
  const timer = setTimeout(() => {
    transitionTimers.delete(agentId);
    const pending = callback();
    if (pending && typeof pending === "object" && "catch" in pending) {
      void pending.catch((error: unknown) => {
        console.error(`Transition failed for ${agentId}`, error);
      });
    }
  }, delayMs);
  transitionTimers.set(agentId, timer);
}

function cancelTransitionTimer(agentId: string): void {
  const timer = transitionTimers.get(agentId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  transitionTimers.delete(agentId);
}

function ensureKnownAgents(agentIds: string[]): void {
  const unknownAgentId = agentIds.find((agentId) => !agentStates.has(agentId));
  if (unknownAgentId) {
    throw new RequestBodyError(`Unknown agent id: ${unknownAgentId}`);
  }
}

function chooseFacilitator(participants: string[]): string {
  const rotated = FACILITATOR_ROTATION.find((agentId) => participants.includes(agentId));
  if (!rotated) {
    throw new RequestBodyError("Meeting requires at least one participant");
  }
  return rotated;
}

function buildLegacyMeetingScript(agentIds: string[]): MeetingScript {
  ensureKnownAgents(agentIds);
  const facilitatorId = chooseFacilitator(agentIds);
  return {
    config: {
      type: "standup",
      participants: agentIds,
      facilitatorId,
    },
    turns: agentIds.map((agentId, index) => ({
      agentId,
      message: index === 0 ? "Status update from the floor." : "I’m aligned and moving my tasks forward.",
      timestamp: Date.now() + index,
    })),
    summary: "Standup complete. Back to execution.",
  };
}

function readStatusEvent(body: unknown, agentIdFromPath?: string): AgentEvent {
  if (typeof body !== "object" || body === null) {
    throw new RequestBodyError("Invalid agent event payload");
  }

  const payload = body as Partial<AgentEvent>;
  const agentId = agentIdFromPath ?? payload.agentId;

  if (!agentId) {
    throw new RequestBodyError("Missing agent id");
  }
  if (agentIdFromPath && payload.agentId && payload.agentId !== agentIdFromPath) {
    throw new RequestBodyError("Agent id in URL does not match payload");
  }
  if (!isRealtimeAgentStatus(payload.status)) {
    throw new RequestBodyError("Invalid agent event payload");
  }
  if (typeof payload.timestamp !== "number") {
    throw new RequestBodyError("Invalid agent event payload");
  }
  if (payload.task !== undefined && typeof payload.task !== "string") {
    throw new RequestBodyError("Invalid agent event payload");
  }
  if (payload.message !== undefined && typeof payload.message !== "string") {
    throw new RequestBodyError("Invalid agent event payload");
  }
  if (payload.location !== undefined && !isAgentEventLocation(payload.location)) {
    throw new RequestBodyError("Invalid agent event payload");
  }

  const normalized: AgentEvent = {
    agentId,
    status: payload.status,
    timestamp: payload.timestamp,
  };

  if (payload.task !== undefined) {
    normalized.task = payload.task;
  }
  if (payload.message !== undefined) {
    normalized.message = payload.message;
  }
  if (payload.location !== undefined) {
    normalized.location = payload.location;
  }

  if (!isAgentEvent(normalized)) {
    throw new RequestBodyError("Invalid agent event payload");
  }

  return normalized;
}

async function readPersistedAgents(): Promise<PersistedAgentsFile> {
  await ensureDataDir();

  try {
    const raw = await readFile(agentsFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedAgentsFile>;
    return {
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { agents: [] };
    }
    throw error;
  }
}

function toPersistedRecord(state: AgentRuntimeState): PersistedAgentRecord {
  const appearance = agentAppearances.get(state.id) ?? resolveAppearance(state).appearance;
  return {
    id: state.id,
    name: state.name,
    role: state.role,
    emoji: state.emoji ?? "🙂",
    type: state.type ?? "visitor",
    appearance,
    backendLink: normalizeBackendLink(state.backendLink),
    deskIndex: state.deskIndex,
  };
}

async function persistAgents(): Promise<void> {
  const payload: PersistedAgentsFile = {
    agents: getOrderedStates().map((state) => toPersistedRecord(state)),
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const tempPath = path.join(dataDir, `agents.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  await ensureDataDir();
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, agentsFilePath);
}

let persistAgentsQueue: Promise<void> = Promise.resolve();

function queuePersistAgents(): Promise<void> {
  const runPersist = async () => {
    await persistAgents();
  };
  const pending = persistAgentsQueue.then(runPersist, runPersist);
  persistAgentsQueue = pending.catch(() => undefined);
  return pending;
}

function applyPersistedAgent(record: PersistedAgentRecord): void {
  const appearance = record.appearance;
  const type = record.type ?? "visitor";
  let deskIndex = record.deskIndex;

  if (type === "resident") {
    deskIndex = deskIndex ?? getKnownDeskIndex(record.id) ?? getAvailableDeskIndex(record.id);
    if (deskIndex !== undefined) {
      residentDeskAssignments.set(record.id, deskIndex);
    }
  } else if (deskIndex === undefined || Array.from(agentStates.values()).some((state) => state.deskIndex === deskIndex)) {
    deskIndex = getAvailableDeskIndex(record.id);
  }

  const runtimeState: AgentRuntimeState = {
    id: record.id,
    name: record.name,
    role: record.role,
    emoji: record.emoji,
    type,
    backendLink: normalizeBackendLink(record.backendLink),
    connected: true,
    status: "idle",
    location: "desk",
    timestamp: Date.now(),
    deskIndex,
  };

  agentStates.set(record.id, runtimeState);
  agentAppearances.set(record.id, appearance);
}

async function loadPersistedAgents(): Promise<void> {
  const persisted = await readPersistedAgents();
  persisted.agents.forEach((record) => {
    if (isRegistration(record) && isAgentAppearance(record.appearance) && isBackendLink(record.backendLink) && typeof record.emoji === "string") {
      applyPersistedAgent(record as PersistedAgentRecord);
    }
  });
}

async function upsertRegistration(body: AgentRegistration, mode: "create" | "update"): Promise<AgentRuntimeState> {
  const existing = agentStates.get(body.id);
  if (mode === "create" && existing) {
    throw new RequestBodyError(`Agent ${body.id} already exists`, 409);
  }
  if (mode === "update" && !existing) {
    throw new RequestBodyError("Agent not found", 404);
  }

  const { appearance, emoji } = resolveAppearance(body);
  const type = body.type ?? existing?.type ?? "visitor";
  const backendLink = normalizeBackendLink(body.backendLink, existing?.backendLink);
  const timestamp = Date.now();
  const deskIndex = resolveDeskIndex({ ...body, type }, existing);
  const nextStatus: RealtimeAgentStatus = mode === "create" ? "entering" : (existing?.status ?? "idle");
  const nextLocation: AgentEventLocation = mode === "create" ? "door" : (existing?.location ?? "desk");

  const nextState: AgentRuntimeState = {
    id: body.id,
    name: body.name,
    role: body.role,
    emoji,
    type,
    backendLink,
    connected: true,
    status: nextStatus,
    location: nextLocation,
    timestamp,
    task: existing?.task,
    message: existing?.message,
    deskIndex,
  };

  if (type === "resident") {
    residentDeskAssignments.set(body.id, deskIndex);
  } else {
    residentDeskAssignments.delete(body.id);
  }

  agentStates.set(body.id, nextState);
  agentAppearances.set(body.id, appearance);
  await queuePersistAgents();

  const action = mode === "create" ? "Registered" : "Updated";
  pushActivity("registration", `${action} agent ${body.name} at desk ${deskIndex + 1}.`, body.id);
  broadcast({
    type: "agent-registered",
    agent: {
      ...nextState,
      appearance,
    },
  });
  broadcastSnapshot();

  if (mode === "create") {
    broadcast({
      type: "agent-event",
      event: {
        agentId: body.id,
        status: "entering",
        location: "door",
        timestamp,
      },
    });

    scheduleTransition(body.id, () => {
      if (!agentStates.has(body.id)) {
        return;
      }
      applyEvent({
        agentId: body.id,
        status: "idle",
        location: "desk",
        timestamp: Date.now(),
      });
    }, 900);
  }

  return nextState;
}

function resolveOpenClawOfficeAgentId(openClawAgentId: string): string | undefined {
  return OPENCLAW_AGENT_MAP[openClawAgentId as keyof typeof OPENCLAW_AGENT_MAP];
}

function extractOpenClawAgentId(sessionKey: string, explicitAgentId?: string): string | undefined {
  if (explicitAgentId?.trim()) {
    return explicitAgentId.trim();
  }
  if (sessionKey === "main") {
    return "main";
  }
  return sessionKey.match(/^agent:([^:]+)/)?.[1];
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

function normalizeToolSessions(result: unknown): OpenClawSessionInfo[] {
  const rows = Array.isArray(result)
    ? result
    : (Array.isArray((result as { sessions?: unknown[] } | null | undefined)?.sessions)
        ? (result as { sessions: unknown[] }).sessions
        : []);

  return rows.flatMap((row): OpenClawSessionInfo[] => {
    if (typeof row !== "object" || row === null) {
      return [];
    }

    const session = row as OpenClawSessionListRow;
    const sessionKey = session.key?.trim();
    if (!sessionKey) {
      return [];
    }

    const lastMessage = Array.isArray(session.messages) ? session.messages.at(-1) : undefined;
    return [{
      sessionKey,
      agentId: extractOpenClawAgentId(sessionKey),
      status: "active",
      label: session.displayName,
      task: extractOpenClawMessageText(lastMessage),
    }];
  });
}

async function fetchOpenClawSessions(): Promise<OpenClawSessionInfo[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OPENCLAW_TOKEN) {
    headers.Authorization = `Bearer ${OPENCLAW_TOKEN}`;
  }

  const legacyResponse = await fetch(
    `${OPENCLAW_URL}/api/sessions?activeMinutes=${OPENCLAW_ACTIVITY_WINDOW_MINUTES}&messageLimit=1`,
    { headers },
  );
  if (legacyResponse.ok) {
    const data = await legacyResponse.json() as { sessions?: OpenClawSessionInfo[] };
    return data.sessions ?? [];
  }

  if (legacyResponse.status !== 404) {
    const body = await legacyResponse.text().catch(() => "");
    console.error(`[openclaw-sync] OpenClaw API returned ${legacyResponse.status}${body ? `: ${body}` : ""}`);
    return [];
  }

  const toolsResponse = await fetch(`${OPENCLAW_URL}/tools/invoke`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tool: "sessions_list",
      action: "json",
      sessionKey: "main",
      args: {
        activeMinutes: OPENCLAW_ACTIVITY_WINDOW_MINUTES,
        messageLimit: 1,
      },
    }),
  });
  if (!toolsResponse.ok) {
    const body = await toolsResponse.text().catch(() => "");
    console.error(`[openclaw-sync] OpenClaw tools API returned ${toolsResponse.status}${body ? `: ${body}` : ""}`);
    return [];
  }

  const data = await toolsResponse.json() as { ok?: boolean; result?: unknown };
  if (!data.ok && data.result === undefined) {
    console.error(`[openclaw-sync] OpenClaw tools API returned non-ok payload: ${JSON.stringify(data)}`);
    return [];
  }
  return normalizeToolSessions(data.result);
}

async function ensureOpenClawAgentRegistered(officeAgentId: string, openClawAgentId: string): Promise<void> {
  const existing = agentStates.get(officeAgentId);
  const fallback = defaultAppearances.get(officeAgentId);
  const appearance = agentAppearances.get(officeAgentId)
    ?? (existing ? resolveAppearance(existing).appearance : undefined)
    ?? fallback?.appearance
    ?? createDeterministicAppearance(officeAgentId);

  const connectedAt = existing?.backendLink.connectedAt ?? Date.now();
  const backendLink: AgentBackendLink = {
    provider: "openclaw",
    connected: true,
    agentId: openClawAgentId,
    connectedAt,
  };

  if (
    existing &&
    existing.backendLink.provider === "openclaw" &&
    existing.backendLink.connected &&
    existing.backendLink.agentId === openClawAgentId
  ) {
    return;
  }

  await upsertRegistration({
    id: officeAgentId,
    name: existing?.name ?? fallback?.name ?? officeAgentId,
    role: existing?.role ?? fallback?.role ?? "OpenClaw Agent",
    emoji: existing?.emoji ?? fallback?.emoji ?? "🤖",
    appearance,
    type: existing?.type ?? "resident",
    deskIndex: existing?.deskIndex ?? getKnownDeskIndex(officeAgentId),
    backendLink,
  }, existing ? "update" : "create");
}

async function applyOpenClawStatus(
  officeAgentId: string,
  openClawAgentId: string,
  status: "idle" | "working",
  task?: string,
): Promise<void> {
  await ensureOpenClawAgentRegistered(officeAgentId, openClawAgentId);

  const normalizedTask = task?.trim() || undefined;
  const previous = openClawStates.get(officeAgentId);
  if (previous?.status === status && previous?.task === normalizedTask) {
    return;
  }

  cancelTransitionTimer(officeAgentId);

  const event: AgentEvent = {
    agentId: officeAgentId,
    status,
    location: "desk",
    timestamp: Date.now(),
    task: status === "working" ? (normalizedTask ?? "") : "",
  };
  const next = applyEvent(event);
  openClawStates.set(officeAgentId, {
    openClawAgentId,
    status,
    task: normalizedTask,
  });
  pushActivity("agent-status", formatStatusActivity(next, event), officeAgentId);
}

async function pollOpenClawSessions(): Promise<void> {
  if (!OPENCLAW_URL) {
    return;
  }

  try {
    const sessions = await fetchOpenClawSessions();
    const currentlyActive = new Set<string>();

    for (const session of sessions) {
      const openClawAgentId = extractOpenClawAgentId(session.sessionKey, session.agentId);
      if (!openClawAgentId) {
        continue;
      }
      const officeAgentId = resolveOpenClawOfficeAgentId(openClawAgentId);
      if (!officeAgentId) {
        continue;
      }

      currentlyActive.add(officeAgentId);
      const isWorking = session.status === "running" || session.status === "active";
      const task = session.task ?? session.label;
      await applyOpenClawStatus(officeAgentId, openClawAgentId, isWorking ? "working" : "idle", task);
    }

    for (const [officeAgentId, state] of openClawStates) {
      if (!currentlyActive.has(officeAgentId) && state.status !== "idle") {
        await applyOpenClawStatus(officeAgentId, state.openClawAgentId, "idle");
      }
    }
  } catch (error) {
    console.error("[openclaw-sync] Poll error:", error);
  }
}

function startOpenClawSync(): void {
  if (!OPENCLAW_URL) {
    return;
  }

  console.log(`[openclaw-sync] Polling ${OPENCLAW_URL} every ${OPENCLAW_POLL_INTERVAL_MS / 1000}s`);
  void pollOpenClawSessions();
  setInterval(() => {
    void pollOpenClawSessions();
  }, OPENCLAW_POLL_INTERVAL_MS);
}

let meetingStartActivityEmitted = false;

const meetingEngine = new MeetingEngine({
  onBroadcast: broadcast,
  onApplyEvent(event) {
    if (event.status === "meeting" || event.location === "meeting-room") {
      cancelTransitionTimer(event.agentId);
    }
    applyEvent(event);
    const state = agentStates.get(event.agentId);
    if (!state) {
      return;
    }
    if (event.status === "entering") {
      pushAgentMessageActivity("agent-message", state, event.message);
      pushActivity("agent-status", formatStatusActivity(state, event), event.agentId);
      return;
    }
    if (event.status === "meeting" && event.message) {
      pushAgentMessageActivity("meeting-turn", state, event.message);
      return;
    }
    if (event.message) {
      pushAgentMessageActivity("agent-message", state, event.message);
      return;
    }
    pushActivity("agent-status", formatStatusActivity(state, event), event.agentId);
  },
  onMeetingState(state) {
    if (state.active && state.config && state.progress.currentTurn === 0) {
      if (!meetingStartActivityEmitted) {
        meetingStartActivityEmitted = true;
        pushActivity("meeting-start", `${state.config.type} meeting started.`, state.config.facilitatorId);
      }
      return;
    }
    if (!state.active && state.summary) {
      meetingStartActivityEmitted = false;
      pushActivity("meeting-end", state.summary, state.config?.facilitatorId);
      return;
    }
    if (!state.active && state.stopped) {
      meetingStartActivityEmitted = false;
      pushActivity("meeting-stop", "Meeting stopped early.");
      return;
    }
    if (!state.active) {
      meetingStartActivityEmitted = false;
    }
  },
});

const httpServer = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "OPTIONS") {
    response.writeHead(204, DEFAULT_HEADERS);
    response.end();
    return;
  }

  try {
    if (await handleClaudeAuth(url.pathname, url, response)) {
      return;
    }
    if (await handleCodexAuth(url.pathname, url, response)) {
      return;
    }

    if (method === "GET" && url.pathname === "/api/agents") {
      sendJson(response, 200, { agents: getOrderedStates() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/activity") {
      sendJson(response, 200, { entries: activityLog });
      return;
    }

    if (method === "POST" && (url.pathname === "/api/agents/register" || url.pathname === "/api/agent/register")) {
      const body = await readJson<unknown>(request);
      if (!isRegistration(body)) {
        throw new RequestBodyError("Invalid registration payload");
      }

      const state = await upsertRegistration(body, "create");
      sendJson(response, 201, {
        ...state,
        appearance: agentAppearances.get(state.id),
      });
      return;
    }

    const updateMatch = method === "PUT" || method === "PATCH" ? url.pathname.match(/^\/api\/agents\/([^/]+)$/) : null;
    if (updateMatch) {
      const agentId = decodeURIComponent(updateMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isRegistration(body)) {
        throw new RequestBodyError("Invalid registration payload");
      }
      if (body.id !== agentId) {
        throw new RequestBodyError("Agent id in URL does not match payload");
      }

      const state = await upsertRegistration(body, "update");
      sendJson(response, 200, {
        ...state,
        appearance: agentAppearances.get(state.id),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/agent/status") {
      const body = await readJson<unknown>(request);
      const event = readStatusEvent(body);
      const next = applyEvent(event);
      if (event.message) {
        pushAgentMessageActivity(event.status === "meeting" ? "meeting-turn" : "agent-message", next, event.message);
      } else {
        pushActivity("agent-status", formatStatusActivity(next, event), next.id);
      }
      sendJson(response, 200, next);
      return;
    }

    const statusPathMatch = method === "POST" ? url.pathname.match(/^\/api\/agent\/([^/]+)\/status$/) : null;
    if (statusPathMatch) {
      const body = await readJson<unknown>(request);
      const event = readStatusEvent(body, decodeURIComponent(statusPathMatch[1] ?? ""));
      const next = applyEvent(event);
      if (event.message) {
        pushAgentMessageActivity(event.status === "meeting" ? "meeting-turn" : "agent-message", next, event.message);
      } else {
        pushActivity("agent-status", formatStatusActivity(next, event), next.id);
      }
      sendJson(response, 200, next);
      return;
    }

    if (method === "POST" && url.pathname === "/api/agent/spawn") {
      const body = await readJson<unknown>(request);
      if (!isAgentSpawnRequest(body)) {
        throw new RequestBodyError("Invalid spawn payload");
      }

      ensureKnownAgents([body.agentId]);
      const enteringEvent: AgentEvent = {
        agentId: body.agentId,
        status: "entering",
        task: body.task,
        message: body.message,
        location: "door",
        timestamp: Date.now(),
      };
      const entering = applyEvent(enteringEvent);
      pushActivity("agent-spawn", `${entering.name} spawned on task: ${body.task}.`, body.agentId);
      pushAgentMessageActivity("agent-message", entering, body.message);
      sendJson(response, 200, entering);

      scheduleTransition(body.agentId, () => {
        applyEvent({
          agentId: body.agentId,
          status: "working",
          task: body.task,
          message: body.message,
          location: "desk",
          timestamp: Date.now(),
        });
      }, 900);
      return;
    }

    if (method === "POST" && url.pathname === "/api/agent/complete") {
      const body = await readJson<unknown>(request);
      if (!isAgentCompleteRequest(body)) {
        throw new RequestBodyError("Invalid complete payload");
      }

      ensureKnownAgents([body.agentId]);
      const next = applyEvent({
        agentId: body.agentId,
        status: "idle",
        task: body.result,
        message: body.message,
        location: "desk",
        timestamp: Date.now(),
      });
      pushAgentMessageActivity("agent-message", next, body.message);
      pushActivity("agent-complete", `${next.name} completed work${body.result ? `: ${body.result}` : "."}`, body.agentId);
      sendJson(response, 200, next);
      return;
    }

    const deleteMatch = method === "DELETE" ? url.pathname.match(/^\/api\/agents\/([^/]+)$/) : null;
    const legacyDeleteMatch = method === "DELETE" ? url.pathname.match(/^\/api\/agent\/([^/]+)$/) : null;
    const deleteAgentId = decodeURIComponent(deleteMatch?.[1] ?? legacyDeleteMatch?.[1] ?? "");
    if (method === "DELETE" && deleteAgentId) {
      const existing = agentStates.get(deleteAgentId);
      if (!existing) {
        sendJson(response, 404, { error: "Agent not found" });
        return;
      }

      cancelTransitionTimer(deleteAgentId);
      const leavingTimestamp = Date.now();
      agentStates.set(deleteAgentId, {
        ...existing,
        status: "leaving",
        location: "door",
        timestamp: leavingTimestamp,
      });
      broadcast({
        type: "agent-event",
        event: {
          agentId: deleteAgentId,
          status: "leaving",
          location: "door",
          timestamp: leavingTimestamp,
        },
      });
      pushActivity("agent-status", `${existing.name} is leaving the office.`, deleteAgentId);
      sendJson(response, 200, { ok: true });

      scheduleTransition(deleteAgentId, () => {
        void (async () => {
          agentStates.delete(deleteAgentId);
          residentDeskAssignments.delete(deleteAgentId);
          agentAppearances.delete(deleteAgentId);
          await queuePersistAgents();
          broadcast({ type: "agent-removed", agentId: deleteAgentId });
          pushActivity("agent-status", `Removed agent ${existing.name}.`, deleteAgentId);
          broadcastSnapshot();
        })().catch((error) => {
          console.error(`Failed to remove agent ${deleteAgentId}`, error);
        });
      }, 350);
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/run") {
      const body = await readJson<unknown>(request);
      if (!isMeetingRunRequest(body)) {
        throw new RequestBodyError("Invalid meeting run payload");
      }
      ensureKnownAgents(body.script.config.participants);
      if (!body.script.config.participants.includes(body.script.config.facilitatorId)) {
        throw new RequestBodyError("Facilitator must be a participant");
      }
      if (body.script.config.presenter && !body.script.config.participants.includes(body.script.config.presenter)) {
        throw new RequestBodyError("Presenter must be a participant");
      }

      void meetingEngine.run(body).catch((error) => {
        console.error("Meeting run failed", error);
      });
      sendJson(response, 200, meetingEngine.getState());
      return;
    }

    if (method === "GET" && url.pathname === "/api/meeting/status") {
      sendJson(response, 200, meetingEngine.getState());
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/stop") {
      const state = await meetingEngine.stop();
      sendJson(response, 200, state);
      return;
    }

    if (method === "GET" && url.pathname === "/api/meeting/transcript") {
      sendJson(response, 200, { transcript: meetingEngine.getLastTranscript() });
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/start") {
      const body = await readJson<unknown>(request);
      if (!isMeetingRequest(body)) {
        throw new RequestBodyError("Invalid meeting payload");
      }
      void meetingEngine.run({
        script: buildLegacyMeetingScript(body.agentIds),
        speed: 2,
      }).catch((error) => {
        console.error("Legacy meeting run failed", error);
      });
      sendJson(response, 200, meetingEngine.getState());
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/end") {
      const state = await meetingEngine.stop();
      sendJson(response, 200, state);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown server error";
    sendJson(response, 500, { error: message });
  }
});

async function start(): Promise<void> {
  await loadPersistedAgents();

  websocketServer = new WebSocketServer({ server: httpServer });
  websocketServer.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "agents-snapshot",
        agents: buildSnapshotStates(),
      } satisfies ServerMessage),
    );
    socket.send(
      JSON.stringify({
        type: "meeting-status",
        state: meetingEngine.getState(),
      } satisfies ServerMessage),
    );
  });

  httpServer.listen(PORT, () => {
    console.log(`Realtime server listening on http://localhost:${PORT}`);
  });

  startOpenClawSync();
}

void start();
