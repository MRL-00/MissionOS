import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CONNECTOR_SYNC_INTERVAL_MS,
  HERMES_POLL_INTERVAL_MS,
  HERMES_TOKEN_CONFIGURED,
  HERMES_RUNTIME_URL,
  HERMES_URL,
  HERMES_WS_URL,
  LINEAR_SYNC_INTERVAL_MS,
  MISSION_PROVIDER_LABELS,
  OPENCLAW_POLL_INTERVAL_MS,
  OPENCLAW_TOKEN_CONFIGURED,
  OPENCLAW_URL,
  RequestBodyError,
  dataDir,
  missionControlFilePath,
  type PersistedMissionConnector,
  type PersistedMissionControlFile,
} from "./types";
import type { ServerMessage } from "../src/types";
import type {
  MissionControlSnapshot,
  MissionProvider,
  MissionRosterImportStatus,
  MissionSyncStatus,
  MissionTask,
  MissionTaskCommentCreateRequest,
  MissionTaskDetail,
  MissionTaskHandoff,
  MissionTaskHandoffCreateRequest,
  MissionTaskHandoffResponseRequest,
  MissionTaskUpdateRequest,
  ProviderAgentRecord,
  ProviderConnector,
  ProviderConnectorUpdateRequest,
  ProviderScheduleEntry,
} from "../src/mission/types";
import { ensureDataDir } from "./auth/storage";
import { agentStates, applyEvent } from "./agents";
import {
  createLinearTaskComment,
  fetchLinearTaskDetail,
  syncLinearTasks,
  updateLinearTask,
} from "./linear-service";
import { syncProviderConnector } from "./provider-connectors";
import { generateId } from "./utils";

const CONNECTOR_ORDER: MissionProvider[] = ["openclaw", "hermes"];

const providerConnectors = new Map<MissionProvider, ProviderConnector>();
const connectorTimers = new Map<MissionProvider, NodeJS.Timeout>();
let linearTimer: NodeJS.Timeout | null = null;
let broadcast: ((message: ServerMessage) => void) | null = null;
let persistMissionQueue: Promise<void> = Promise.resolve();
let providerAgents: ProviderAgentRecord[] = [];
let schedules: ProviderScheduleEntry[] = [];
let taskSnapshot: MissionTask[] = [];
let taskSync: MissionSyncStatus = {
  state: "idle",
  updatedAt: Date.now(),
  message: "Waiting for the first Linear sync.",
};
let rosterImport: MissionRosterImportStatus = {
  imported: 0,
  linked: 0,
  staged: 0,
  updatedAt: Date.now(),
};
let taskHandoffs: MissionTaskHandoff[] = [];

function providerCapabilities(provider: MissionProvider): ProviderConnector["capabilities"] {
  return {
    agents: true,
    schedules: true,
    activeWork: true,
    launch: true,
    subscribe: provider === "openclaw",
  };
}

function defaultConnector(provider: MissionProvider): ProviderConnector {
  if (provider === "openclaw") {
    return {
      provider,
      label: MISSION_PROVIDER_LABELS[provider],
      enabled: Boolean(OPENCLAW_URL),
      baseUrl: OPENCLAW_URL || undefined,
      websocketUrl: OPENCLAW_URL ? OPENCLAW_URL.replace(/^http/i, "ws") : undefined,
      runtimeBaseUrl: OPENCLAW_URL || undefined,
      syncIntervalMs: OPENCLAW_POLL_INTERVAL_MS || DEFAULT_CONNECTOR_SYNC_INTERVAL_MS,
      authMode: OPENCLAW_TOKEN_CONFIGURED ? "bearer" : "none",
      tokenConfigured: OPENCLAW_TOKEN_CONFIGURED,
      capabilities: providerCapabilities(provider),
      health: {
        provider,
        status: OPENCLAW_URL ? "idle" : "disabled",
        checkedAt: Date.now(),
        activeAgents: 0,
        schedules: 0,
        message: OPENCLAW_URL ? "OpenClaw ready to sync." : "Configure OPENCLAW_URL or add it in Settings.",
      },
      lastSyncAt: undefined,
    };
  }

  return {
    provider,
    label: MISSION_PROVIDER_LABELS[provider],
    enabled: Boolean(HERMES_URL),
    baseUrl: HERMES_URL || undefined,
    websocketUrl: HERMES_WS_URL || undefined,
    runtimeBaseUrl: HERMES_RUNTIME_URL || HERMES_URL || undefined,
    syncIntervalMs: HERMES_POLL_INTERVAL_MS || DEFAULT_CONNECTOR_SYNC_INTERVAL_MS,
    authMode: HERMES_TOKEN_CONFIGURED ? "bearer" : "none",
    tokenConfigured: HERMES_TOKEN_CONFIGURED,
    capabilities: providerCapabilities(provider),
    health: {
      provider,
      status: HERMES_URL ? "idle" : "disabled",
      checkedAt: Date.now(),
      activeAgents: 0,
      schedules: 0,
      message: HERMES_URL ? "Hermes ready to sync." : "Configure HERMES_URL or add it in Settings.",
    },
    lastSyncAt: undefined,
  };
}

function persistedConnectorShape(connector: ProviderConnector): PersistedMissionConnector {
  return {
    provider: connector.provider,
    enabled: connector.enabled,
    baseUrl: connector.baseUrl,
    websocketUrl: connector.websocketUrl,
    runtimeBaseUrl: connector.runtimeBaseUrl,
    syncIntervalMs: connector.syncIntervalMs,
    authMode: connector.authMode,
    lastSyncAt: connector.lastSyncAt,
  };
}

function hydrateConnector(provider: MissionProvider, persisted?: PersistedMissionConnector): ProviderConnector {
  const base = defaultConnector(provider);
  if (!persisted) {
    return base;
  }

  return {
    ...base,
    enabled: persisted.enabled,
    baseUrl: persisted.baseUrl ?? base.baseUrl,
    websocketUrl: persisted.websocketUrl ?? base.websocketUrl,
    runtimeBaseUrl: persisted.runtimeBaseUrl ?? base.runtimeBaseUrl,
    syncIntervalMs: persisted.syncIntervalMs || base.syncIntervalMs,
    authMode: persisted.authMode ?? base.authMode,
    lastSyncAt: persisted.lastSyncAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPersistedMissionConnector(value: unknown): value is PersistedMissionConnector {
  return isRecord(value)
    && (value.provider === "openclaw" || value.provider === "hermes")
    && typeof value.enabled === "boolean"
    && (value.baseUrl === undefined || typeof value.baseUrl === "string")
    && (value.websocketUrl === undefined || typeof value.websocketUrl === "string")
    && (value.runtimeBaseUrl === undefined || typeof value.runtimeBaseUrl === "string")
    && typeof value.syncIntervalMs === "number"
    && (value.authMode === "none" || value.authMode === "bearer")
    && (value.lastSyncAt === undefined || typeof value.lastSyncAt === "number");
}

function isMissionTaskHandoff(value: unknown): value is MissionTaskHandoff {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.taskId === "string"
    && typeof value.fromAgentName === "string"
    && typeof value.toAgentName === "string"
    && typeof value.note === "string"
    && (value.status === "pending" || value.status === "accepted" || value.status === "declined")
    && typeof value.createdAt === "number"
    && (value.fromAgentId === undefined || typeof value.fromAgentId === "string")
    && (value.toAgentId === undefined || typeof value.toAgentId === "string")
    && (value.respondedAt === undefined || typeof value.respondedAt === "number");
}

function syncTaskCounts(taskId: string): void {
  const nextCount = taskHandoffs.filter((handoff) => handoff.taskId === taskId).length;
  taskSnapshot = taskSnapshot.map((task) => (task.id === taskId ? { ...task, handoffCount: nextCount } : task));
}

function linkedOfficeAgent(provider: MissionProvider, externalId: string): string | undefined {
  return Array.from(agentStates.values()).find((state) => (
    state.backendLink?.provider === provider
    && state.backendLink.agentId?.trim() === externalId
  ))?.id;
}

function mergeProviderAgents(provider: MissionProvider, nextAgents: ProviderAgentRecord[]): void {
  const annotated = nextAgents.map((entry) => {
    const officeAgentId = linkedOfficeAgent(provider, entry.externalId);
    return {
      ...entry,
      officeAgentId,
      imported: Boolean(officeAgentId),
    };
  });

  providerAgents = [
    ...providerAgents.filter((entry) => entry.provider !== provider),
    ...annotated,
  ].sort((left, right) => left.name.localeCompare(right.name));

  rosterImport = {
    imported: providerAgents.filter((entry) => entry.imported).length,
    linked: providerAgents.filter((entry) => entry.officeAgentId).length,
    staged: providerAgents.filter((entry) => !entry.officeAgentId).length,
    updatedAt: Date.now(),
  };
}

function mergeSchedules(provider: MissionProvider, nextSchedules: ProviderScheduleEntry[]): void {
  schedules = [
    ...schedules.filter((entry) => entry.provider !== provider),
    ...nextSchedules.map((entry) => ({
      ...entry,
      targetAgentId: entry.targetAgentExternalId ? linkedOfficeAgent(provider, entry.targetAgentExternalId) : entry.targetAgentId,
    })),
  ].sort((left, right) => {
    const leftValue = left.nextRunAt ?? Number.MAX_SAFE_INTEGER;
    const rightValue = right.nextRunAt ?? Number.MAX_SAFE_INTEGER;
    return leftValue - rightValue;
  });
}

function syncHermesOfficeAgents(entries: ProviderAgentRecord[]): void {
  const byExternalId = new Map(entries.map((entry) => [entry.externalId, entry]));
  for (const state of agentStates.values()) {
    if (state.backendLink?.provider !== "hermes" || !state.backendLink.agentId) {
      continue;
    }

    const providerState = byExternalId.get(state.backendLink.agentId);
    const nextStatus = providerState?.status === "working" ? "working" : "idle";
    const nextTask = providerState?.task ?? "";

    if (state.status === nextStatus && (state.task ?? "") === nextTask) {
      continue;
    }

    applyEvent({
      agentId: state.id,
      status: nextStatus,
      task: nextTask,
      location: "desk",
      timestamp: Date.now(),
    });
  }
}

function buildMissionSnapshot(): MissionControlSnapshot {
  return {
    connectors: CONNECTOR_ORDER
      .map((provider) => providerConnectors.get(provider))
      .filter((connector): connector is ProviderConnector => Boolean(connector)),
    providerAgents: [...providerAgents],
    schedules: [...schedules],
    tasks: [...taskSnapshot],
    rosterImport: { ...rosterImport },
    taskSync: { ...taskSync },
    syncedAt: Date.now(),
  };
}

function broadcastMissionSnapshot(): void {
  if (!broadcast) {
    return;
  }
  broadcast({
    type: "mission-snapshot",
    snapshot: buildMissionSnapshot(),
  });
}

async function readPersistedMissionControl(): Promise<PersistedMissionControlFile> {
  await ensureDataDir();
  try {
    const raw = await readFile(missionControlFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedMissionControlFile>;
    return {
      connectors: Array.isArray(parsed.connectors) ? parsed.connectors.filter(isPersistedMissionConnector) : [],
      handoffs: Array.isArray(parsed.handoffs) ? parsed.handoffs.filter(isMissionTaskHandoff) : [],
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { connectors: [], handoffs: [] };
    }
    throw error;
  }
}

async function persistMissionControl(): Promise<void> {
  const payload: PersistedMissionControlFile = {
    connectors: CONNECTOR_ORDER
      .map((provider) => providerConnectors.get(provider))
      .filter((connector): connector is ProviderConnector => Boolean(connector))
      .map(persistedConnectorShape),
    handoffs: [...taskHandoffs].sort((left, right) => right.createdAt - left.createdAt),
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const tempPath = path.join(
    dataDir,
    `mission-control.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  await ensureDataDir();
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, missionControlFilePath);
}

function queuePersistMissionControl(): Promise<void> {
  const runPersist = async () => {
    await persistMissionControl();
  };
  const pending = persistMissionQueue.then(runPersist, runPersist);
  persistMissionQueue = pending.catch(() => undefined);
  return pending;
}

function clearTimers(): void {
  connectorTimers.forEach((timer) => clearInterval(timer));
  connectorTimers.clear();
  if (linearTimer) {
    clearInterval(linearTimer);
    linearTimer = null;
  }
}

function scheduleConnector(provider: MissionProvider): void {
  const connector = providerConnectors.get(provider);
  const existing = connectorTimers.get(provider);
  if (existing) {
    clearInterval(existing);
    connectorTimers.delete(provider);
  }

  if (!connector?.enabled || !connector.baseUrl) {
    return;
  }

  const timer = setInterval(() => {
    void syncMissionConnector(provider);
  }, Math.max(1000, connector.syncIntervalMs));
  connectorTimers.set(provider, timer);
}

function scheduleLinearSync(): void {
  if (linearTimer) {
    clearInterval(linearTimer);
  }
  linearTimer = setInterval(() => {
    void syncMissionTasks();
  }, LINEAR_SYNC_INTERVAL_MS);
}

export function configureMissionControlRuntime(callback: (message: ServerMessage) => void): void {
  broadcast = callback;
}

export async function loadMissionControl(): Promise<void> {
  clearTimers();
  const persisted = await readPersistedMissionControl();

  for (const provider of CONNECTOR_ORDER) {
    const saved = persisted.connectors.find((entry) => entry.provider === provider);
    providerConnectors.set(provider, hydrateConnector(provider, saved));
  }

  taskHandoffs = [...persisted.handoffs].sort((left, right) => right.createdAt - left.createdAt);
  rosterImport = {
    imported: 0,
    linked: 0,
    staged: 0,
    updatedAt: Date.now(),
  };
}

export function listMissionConnectors(): ProviderConnector[] {
  return CONNECTOR_ORDER
    .map((provider) => providerConnectors.get(provider))
    .filter((connector): connector is ProviderConnector => Boolean(connector));
}

export function getMissionControlSnapshot(): MissionControlSnapshot {
  return buildMissionSnapshot();
}

export async function updateMissionConnector(provider: MissionProvider, updates: ProviderConnectorUpdateRequest): Promise<ProviderConnector> {
  const current = providerConnectors.get(provider);
  if (!current) {
    throw new RequestBodyError(`Unknown provider ${provider}.`, 404);
  }

  const next: ProviderConnector = {
    ...current,
    enabled: updates.enabled ?? current.enabled,
    baseUrl: updates.baseUrl?.trim() || (updates.baseUrl === "" ? undefined : current.baseUrl),
    websocketUrl: updates.websocketUrl?.trim() || (updates.websocketUrl === "" ? undefined : current.websocketUrl),
    runtimeBaseUrl: updates.runtimeBaseUrl?.trim() || (updates.runtimeBaseUrl === "" ? undefined : current.runtimeBaseUrl),
    syncIntervalMs: updates.syncIntervalMs && Number.isFinite(updates.syncIntervalMs)
      ? Math.max(1000, updates.syncIntervalMs)
      : current.syncIntervalMs,
    authMode: updates.authMode ?? current.authMode,
  };

  providerConnectors.set(provider, next);
  scheduleConnector(provider);
  await queuePersistMissionControl();
  broadcastMissionSnapshot();
  return next;
}

export async function testMissionConnector(provider: MissionProvider): Promise<ProviderConnector> {
  return syncMissionConnector(provider);
}

export async function syncMissionConnector(provider: MissionProvider): Promise<ProviderConnector> {
  const connector = providerConnectors.get(provider);
  if (!connector) {
    throw new RequestBodyError(`Unknown provider ${provider}.`, 404);
  }

  const syncing: ProviderConnector = {
    ...connector,
    health: {
      ...connector.health,
      status: connector.enabled && connector.baseUrl ? "syncing" : "disabled",
      checkedAt: Date.now(),
      message: connector.enabled && connector.baseUrl ? `Syncing ${connector.label}...` : "Connector disabled.",
    },
  };
  providerConnectors.set(provider, syncing);
  broadcastMissionSnapshot();

  try {
    const result = await syncProviderConnector(syncing);
    const nextConnector: ProviderConnector = {
      ...syncing,
      health: result.health,
      lastSyncAt: Date.now(),
    };

    providerConnectors.set(provider, nextConnector);
    mergeProviderAgents(provider, result.agents);
    mergeSchedules(provider, result.schedules);

    if (provider === "hermes") {
      syncHermesOfficeAgents(result.agents);
    }

    broadcastMissionSnapshot();
    return nextConnector;
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to sync ${provider}.`;
    const failed: ProviderConnector = {
      ...syncing,
      health: {
        provider,
        status: "error",
        checkedAt: Date.now(),
        activeAgents: syncing.health.activeAgents,
        schedules: syncing.health.schedules,
        message,
      },
    };
    providerConnectors.set(provider, failed);
    broadcastMissionSnapshot();
    return failed;
  }
}

export function listMissionSchedules(): ProviderScheduleEntry[] {
  return [...schedules];
}

export function listProviderAgents(): ProviderAgentRecord[] {
  return [...providerAgents];
}

export async function syncMissionTasks(): Promise<MissionTask[]> {
  taskSync = {
    state: "syncing",
    updatedAt: Date.now(),
    message: "Syncing Linear issues...",
  };
  broadcastMissionSnapshot();

  try {
    const snapshot = await syncLinearTasks(taskHandoffs);
    taskSnapshot = snapshot.tasks;
    taskSync = {
      state: snapshot.syncState,
      updatedAt: snapshot.syncedAt,
      message: snapshot.message ?? snapshot.error ?? `Synced ${snapshot.tasks.length} Linear issue${snapshot.tasks.length === 1 ? "" : "s"}.`,
    };
    broadcastMissionSnapshot();
    return taskSnapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Linear tasks.";
    taskSync = {
      state: "error",
      updatedAt: Date.now(),
      message,
    };
    broadcastMissionSnapshot();
    throw error;
  }
}

export function listMissionTasks(): MissionTask[] {
  return [...taskSnapshot];
}

export async function getMissionTaskDetail(taskId: string): Promise<MissionTaskDetail> {
  return fetchLinearTaskDetail(taskId, taskHandoffs);
}

export async function updateMissionTask(taskId: string, input: MissionTaskUpdateRequest): Promise<MissionTask> {
  const task = await updateLinearTask(taskId, input, taskHandoffs);
  taskSnapshot = taskSnapshot
    .map((entry) => (entry.id === task.id ? task : entry))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  taskSync = {
    state: "ok",
    updatedAt: Date.now(),
    message: "Linear issue updated.",
  };
  broadcastMissionSnapshot();
  return task;
}

export async function addMissionTaskComment(taskId: string, input: MissionTaskCommentCreateRequest): Promise<MissionTaskDetail> {
  const body = input.body.trim();
  if (!body) {
    throw new RequestBodyError("Comment body is required.");
  }

  await createLinearTaskComment(taskId, body);
  const detail = await fetchLinearTaskDetail(taskId, taskHandoffs);
  taskSnapshot = taskSnapshot.map((entry) => (entry.id === detail.task.id ? detail.task : entry));
  taskSync = {
    state: "ok",
    updatedAt: Date.now(),
    message: "Linear comment created.",
  };
  broadcastMissionSnapshot();
  return detail;
}

export async function createMissionTaskHandoff(taskId: string, input: MissionTaskHandoffCreateRequest): Promise<MissionTaskHandoff> {
  const task = taskSnapshot.find((entry) => entry.id === taskId);
  if (!task) {
    throw new RequestBodyError("Mission task not found.", 404);
  }

  const note = input.note.trim();
  if (!note) {
    throw new RequestBodyError("Handoff note is required.");
  }

  const handoff: MissionTaskHandoff = {
    id: generateId(),
    taskId,
    fromAgentId: input.fromAgentId?.trim() || undefined,
    fromAgentName: input.fromAgentName?.trim() || "Mission Control",
    toAgentId: input.toAgentId?.trim() || undefined,
    toAgentName: input.toAgentName?.trim() || "Unassigned",
    note,
    status: "pending",
    createdAt: Date.now(),
  };

  taskHandoffs = [handoff, ...taskHandoffs];
  syncTaskCounts(taskId);
  await queuePersistMissionControl();
  broadcastMissionSnapshot();
  return handoff;
}

export async function respondMissionTaskHandoff(
  handoffId: string,
  input: MissionTaskHandoffResponseRequest,
): Promise<MissionTaskHandoff> {
  const existing = taskHandoffs.find((handoff) => handoff.id === handoffId);
  if (!existing) {
    throw new RequestBodyError("Handoff not found.", 404);
  }

  const next: MissionTaskHandoff = {
    ...existing,
    status: input.status,
    respondedAt: Date.now(),
  };

  taskHandoffs = taskHandoffs.map((handoff) => (handoff.id === handoffId ? next : handoff));
  await queuePersistMissionControl();
  broadcastMissionSnapshot();
  return next;
}

export async function startMissionControl(): Promise<void> {
  await loadMissionControl();
  scheduleLinearSync();
  CONNECTOR_ORDER.forEach((provider) => scheduleConnector(provider));
  await Promise.allSettled([
    syncMissionTasks(),
    ...CONNECTOR_ORDER.map((provider) => syncMissionConnector(provider)),
  ]);
}

export function isProviderConnectorUpdateRequest(value: unknown): value is ProviderConnectorUpdateRequest {
  return isRecord(value)
    && (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.baseUrl === undefined || typeof value.baseUrl === "string")
    && (value.websocketUrl === undefined || typeof value.websocketUrl === "string")
    && (value.runtimeBaseUrl === undefined || typeof value.runtimeBaseUrl === "string")
    && (value.syncIntervalMs === undefined || typeof value.syncIntervalMs === "number")
    && (value.authMode === undefined || value.authMode === "none" || value.authMode === "bearer");
}

export function isMissionTaskUpdateRequest(value: unknown): value is MissionTaskUpdateRequest {
  return isRecord(value)
    && (value.title === undefined || typeof value.title === "string")
    && (value.description === undefined || typeof value.description === "string")
    && (value.stateId === undefined || typeof value.stateId === "string")
    && (value.stateName === undefined || typeof value.stateName === "string")
    && (value.assigneeId === undefined || value.assigneeId === null || typeof value.assigneeId === "string")
    && (value.priority === undefined || typeof value.priority === "number")
    && (value.dueDate === undefined || value.dueDate === null || typeof value.dueDate === "string");
}

export function isMissionTaskCommentCreateRequest(value: unknown): value is MissionTaskCommentCreateRequest {
  return isRecord(value) && typeof value.body === "string";
}

export function isMissionTaskHandoffCreateRequest(value: unknown): value is MissionTaskHandoffCreateRequest {
  return isRecord(value)
    && typeof value.note === "string"
    && (value.fromAgentId === undefined || typeof value.fromAgentId === "string")
    && (value.fromAgentName === undefined || typeof value.fromAgentName === "string")
    && (value.toAgentId === undefined || typeof value.toAgentId === "string")
    && (value.toAgentName === undefined || typeof value.toAgentName === "string");
}

export function isMissionTaskHandoffResponseRequest(value: unknown): value is MissionTaskHandoffResponseRequest {
  return isRecord(value) && (value.status === "accepted" || value.status === "declined");
}
