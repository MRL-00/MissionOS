import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HERMES_COMMAND,
  HERMES_RUNTIME_URL,
  HERMES_TOKEN,
  HERMES_URL,
  HERMES_WS_URL,
  LINEAR_SYNC_INTERVAL_MS,
  MISSION_PROVIDER_LABELS,
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
  ProviderHealth,
  ProviderScheduleEntry,
} from "../src/mission/types";
import { ensureDataDir } from "./auth/storage";
import { pushActivity } from "./activity";
import { agentStates, applyEvent } from "./agents";
import {
  createAgentStateWatcher,
  DEFAULT_HERMES_AGENT_STATE_FILE,
  readHermesAgentStateSnapshotOverSsh,
  type AgentStateWatcherHandle,
  type HermesAgentStateSnapshot,
} from "./adapters/agent-state-watcher";
import {
  subscribeToHermesRuntimeEvents,
  type HermesRuntimeAgentStateEvent,
  type HermesRuntimeEventSubscription,
} from "./adapters/hermes-runtime-events";
import {
  createLinearTaskComment,
  fetchLinearTaskDetail,
  syncLinearTasks,
  updateLinearTask,
} from "./linear-service";
import { syncProviderConnector } from "./provider-connectors";
import { getAdapter, initializeAdapters } from "./adapters/registry";
import type { AdapterMessage, AdapterType } from "./adapters/types";
import { generateId } from "./utils";
import { isProviderAgentActivelyExecuting } from "../src/mission/providerAgents";

interface ProviderConnectorState extends ProviderConnector {
  token?: string | undefined;
}

interface HermesConnectorRuntime {
  deferredIdleTimers: Map<string, NodeJS.Timeout>;
  eventReconnectTimer: NodeJS.Timeout | null;
  eventStream: HermesRuntimeEventSubscription | null;
  lastAppliedSignature: string | null;
  lastSnapshot: HermesAgentStateSnapshot | null;
  remoteStateTimer: NodeJS.Timeout | null;
  watcher: AgentStateWatcherHandle | null;
  workingStartTimes: Map<string, number>;
}

const connectorInstances = new Map<string, ProviderConnectorState>();
const connectorSyncs = new Map<string, Promise<ProviderConnector>>();
const hermesConnectorRuntimes = new Map<string, HermesConnectorRuntime>();
const HERMES_RUNTIME_RECONNECT_MS = 3_000;
const HERMES_REMOTE_STATE_POLL_MS = 1_000;
const HERMES_MIN_WORKING_VISIBLE_MS = 2_500;
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

function defaultHermesToken(): string {
  return HERMES_TOKEN.trim();
}

function connectorAccessToken(connector: ProviderConnectorState): string {
  if (connector.provider !== "hermes") {
    return connector.token?.trim() ?? "";
  }
  return connector.token?.trim() || defaultHermesToken();
}

function providerCapabilities(provider: MissionProvider): ProviderConnector["capabilities"] {
  const isLocal = provider === "claude-local" || provider === "codex-local";
  return {
    agents: !isLocal,
    schedules: !isLocal,
    activeWork: !isLocal,
    launch: true,
    subscribe: provider === "hermes",
  };
}

function publicConnectorShape(connector: ProviderConnectorState): ProviderConnector {
  const { token: _token, ...publicConnector } = connector;
  const adapter = getAdapter(connector.provider as import("./adapters/types").AdapterType);
  return {
    ...publicConnector,
    adapterConfig: adapterConfigFromConnector(connector),
    configFields: adapter?.configFields(),
  };
}

function adapterConfigFromConnector(connector: ProviderConnectorState): Record<string, unknown> {
  return {
    ...connector.adapterConfig,
    baseUrl: connector.baseUrl ?? "",
    websocketUrl: connector.websocketUrl ?? "",
    runtimeBaseUrl: connector.runtimeBaseUrl ?? "",
    token: connector.tokenConfigured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "",
  };
}

function defaultConnector(provider: MissionProvider, id: string, label?: string): ProviderConnectorState {
  const displayLabel = label ?? MISSION_PROVIDER_LABELS[provider];

  if (provider === "hermes") {
    const token = defaultHermesToken();
    return {
      id,
      provider,
      label: displayLabel,
      enabled: HERMES_COMMAND !== "hermes" || Boolean(process.env.HERMES_COMMAND),
      baseUrl: HERMES_COMMAND || undefined,
      websocketUrl: HERMES_WS_URL || undefined,
      runtimeBaseUrl: HERMES_RUNTIME_URL || HERMES_URL || undefined,
      authMode: token ? "bearer" as const : "none" as const,
      token: token || undefined,
      tokenConfigured: Boolean(token),
      capabilities: providerCapabilities(provider),
      health: {
        provider,
        status: HERMES_COMMAND ? "idle" : "disabled",
        checkedAt: Date.now(),
        activeAgents: 0,
        schedules: 0,
        message: "Set the Hermes CLI command in Settings to begin syncing.",
      },
      lastSyncAt: undefined,
    };
  }

  // Local CLI adapters (claude-local, codex-local)
  const adapter = getAdapter(provider as import("./adapters/types").AdapterType);
  return {
    id,
    provider,
    label: adapter?.label ?? displayLabel,
    enabled: false,
    authMode: "none" as const,
    tokenConfigured: false,
    capabilities: providerCapabilities(provider),
    health: {
      provider,
      status: "disabled" as const,
      checkedAt: Date.now(),
      activeAgents: 0,
      schedules: 0,
      message: `Configure ${adapter?.label ?? provider} in Settings.`,
    },
    lastSyncAt: undefined,
  };
}

function persistedConnectorShape(connector: ProviderConnectorState): PersistedMissionConnector {
  return {
    id: connector.id,
    provider: connector.provider,
    label: connector.label,
    enabled: connector.enabled,
    baseUrl: connector.baseUrl,
    websocketUrl: connector.websocketUrl,
    runtimeBaseUrl: connector.runtimeBaseUrl,
    authMode: connector.authMode,
    token: connector.token,
    lastSyncAt: connector.lastSyncAt,
    adapterConfig: connector.adapterConfig,
  };
}

function hydrateConnector(provider: MissionProvider, id: string, persisted?: PersistedMissionConnector): ProviderConnectorState {
  const base = defaultConnector(provider, id, persisted?.label);
  if (!persisted) {
    return base;
  }

  const token = persisted.token?.trim() || (base.token ?? "");
  const authMode = persisted.token?.trim()
    ? (persisted.authMode ?? "bearer")
    : (token ? "bearer" : (persisted.authMode ?? base.authMode));

  return {
    ...base,
    enabled: persisted.enabled,
    baseUrl: persisted.baseUrl ?? base.baseUrl,
    websocketUrl: persisted.websocketUrl ?? base.websocketUrl,
    runtimeBaseUrl: persisted.runtimeBaseUrl ?? base.runtimeBaseUrl,
    authMode,
    token: token || undefined,
    tokenConfigured: Boolean(token),
    lastSyncAt: persisted.lastSyncAt,
    adapterConfig: persisted.adapterConfig ?? base.adapterConfig,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPersistedMissionConnector(value: unknown): value is PersistedMissionConnector {
  return isRecord(value)
    && (value.provider === "hermes" || value.provider === "claude-local" || value.provider === "codex-local")
    && typeof value.enabled === "boolean"
    && (value.baseUrl === undefined || typeof value.baseUrl === "string")
    && (value.websocketUrl === undefined || typeof value.websocketUrl === "string")
    && (value.runtimeBaseUrl === undefined || typeof value.runtimeBaseUrl === "string")
    && (value.authMode === "none" || value.authMode === "bearer")
    && (value.token === undefined || typeof value.token === "string")
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

function linkedOfficeAgent(connectorId: string, externalId: string): string | undefined {
  const externalIds = providerExternalIdAliases(externalId);
  return Array.from(agentStates.values()).find((state) => {
    const backendAgentId = state.backendLink?.agentId?.trim();
    if (!state.backendLink || !backendAgentId || !externalIds.has(backendAgentId)) {
      return false;
    }
    // Match by connectorId if set, fall back to matching provider for backward compat
    if (state.backendLink.connectorId) {
      return state.backendLink.connectorId === connectorId;
    }
    const connector = connectorInstances.get(connectorId);
    return connector ? state.backendLink.provider === connector.provider : false;
  })?.id;
}

function providerExternalIdAliases(externalId: string): Set<string> {
  const normalized = externalId.trim();
  const aliases = new Set<string>([normalized]);
  if (!normalized) {
    return aliases;
  }
  if (normalized.endsWith("-gateway")) {
    aliases.add(normalized.slice(0, -"-gateway".length));
  } else {
    aliases.add(`${normalized}-gateway`);
  }
  return aliases;
}

function mergeProviderAgents(connectorId: string, provider: MissionProvider, nextAgents: ProviderAgentRecord[]): void {
  const annotated = nextAgents.map((entry) => {
    const officeAgentId = linkedOfficeAgent(connectorId, entry.externalId);
    return {
      ...entry,
      connectorId,
      provider,
      officeAgentId,
      imported: Boolean(officeAgentId),
    };
  });

  providerAgents = [
    ...providerAgents.filter((entry) => entry.connectorId !== connectorId),
    ...annotated,
  ].sort((left, right) => left.name.localeCompare(right.name));

  rosterImport = {
    imported: providerAgents.filter((entry) => entry.imported).length,
    linked: providerAgents.filter((entry) => entry.officeAgentId).length,
    staged: providerAgents.filter((entry) => !entry.officeAgentId).length,
    updatedAt: Date.now(),
  };
}

function mergeSchedules(connectorId: string, provider: MissionProvider, nextSchedules: ProviderScheduleEntry[]): void {
  schedules = [
    ...schedules.filter((entry) => entry.connectorId !== connectorId),
    ...nextSchedules.map((entry) => ({
      ...entry,
      connectorId,
      targetAgentId: entry.targetAgentExternalId ? linkedOfficeAgent(connectorId, entry.targetAgentExternalId) : entry.targetAgentId,
    })),
  ].sort((left, right) => {
    const leftValue = left.nextRunAt ?? Number.MAX_SAFE_INTEGER;
    const rightValue = right.nextRunAt ?? Number.MAX_SAFE_INTEGER;
    return leftValue - rightValue;
  });
}

function syncConnectorOfficeAgents(connectorId: string, entries: ProviderAgentRecord[]): void {
  const byExternalId = new Map<string, ProviderAgentRecord>();
  entries.forEach((entry) => {
    providerExternalIdAliases(entry.externalId).forEach((alias) => {
      if (!byExternalId.has(alias)) {
        byExternalId.set(alias, entry);
      }
    });
  });
  for (const state of agentStates.values()) {
    const backendLink = state.backendLink;
    const backendAgentId = backendLink?.agentId?.trim();
    if (!backendLink || !backendAgentId) {
      continue;
    }
    // Match by connectorId, or fall back to provider match for backward compat
    const matchesConnector = backendLink.connectorId
      ? backendLink.connectorId === connectorId
      : (() => {
          const connector = connectorInstances.get(connectorId);
          return connector ? backendLink.provider === connector.provider : false;
        })();
    if (!matchesConnector) {
      continue;
    }

    const providerState = byExternalId.get(backendAgentId);
    const nextStatus = providerState && isProviderAgentActivelyExecuting(providerState) ? "working" : "idle";
    const nextTask = providerState?.taskStage ?? providerState?.task ?? providerState?.currentTicket ?? "";

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

function connectorSchedules(connectorId: string): ProviderScheduleEntry[] {
  return schedules.filter((entry) => entry.connectorId === connectorId);
}

function ensureHermesConnectorRuntime(connectorId: string): HermesConnectorRuntime {
  const existing = hermesConnectorRuntimes.get(connectorId);
  if (existing) {
    return existing;
  }

  const runtime: HermesConnectorRuntime = {
    deferredIdleTimers: new Map(),
    eventReconnectTimer: null,
    eventStream: null,
    lastAppliedSignature: null,
    lastSnapshot: null,
    remoteStateTimer: null,
    watcher: null,
    workingStartTimes: new Map(),
  };
  hermesConnectorRuntimes.set(connectorId, runtime);
  return runtime;
}

function clearHermesRuntimeTimer(timer: NodeJS.Timeout | null): null {
  if (timer) {
    clearInterval(timer);
  }
  return null;
}

function stopHermesConnectorRuntime(connectorId: string): void {
  const runtime = hermesConnectorRuntimes.get(connectorId);
  if (!runtime) {
    return;
  }

  const eventStream = runtime.eventStream;
  runtime.eventStream = null;
  eventStream?.close();
  runtime.watcher?.stop();
  runtime.watcher = null;
  runtime.eventReconnectTimer = clearHermesRuntimeTimer(runtime.eventReconnectTimer);
  runtime.remoteStateTimer = clearHermesRuntimeTimer(runtime.remoteStateTimer);
  runtime.deferredIdleTimers.forEach((timer) => clearTimeout(timer));
  runtime.deferredIdleTimers.clear();
  runtime.workingStartTimes.clear();
  runtime.lastAppliedSignature = null;
  runtime.lastSnapshot = null;
  hermesConnectorRuntimes.delete(connectorId);
}

function buildHermesStateHealth(
  connector: ProviderConnectorState,
  agents: ProviderAgentRecord[],
  source: string,
): ProviderHealth {
  const activeAgents = agents.filter((agent) => isProviderAgentActivelyExecuting(agent)).length;
  const scheduleCount = connectorSchedules(connector.id).length;
  const activeLabel = `${activeAgents} actively executing`;

  return {
    provider: connector.provider,
    status: "ok",
    checkedAt: Date.now(),
    activeAgents,
    schedules: scheduleCount,
    message: `Watching ${source} · ${activeLabel}.`,
  };
}

function buildWatcherHealth(
  connector: ProviderConnectorState,
  snapshot: HermesAgentStateSnapshot,
): ProviderHealth {
  const source = connector.websocketUrl?.trim()
    ? `${connector.websocketUrl.trim()}:${snapshot.path}`
    : snapshot.path;
  return buildHermesStateHealth(connector, snapshot.agents, source);
}

function applyProviderSyncResult(
  connectorId: string,
  health: ProviderHealth,
  nextAgents: ProviderAgentRecord[],
  nextSchedules: ProviderScheduleEntry[],
): ProviderConnector {
  const connector = connectorInstances.get(connectorId);
  if (!connector) {
    throw new RequestBodyError(`Unknown connector ${connectorId}.`, 404);
  }

  const nextConnector: ProviderConnectorState = {
    ...connector,
    health,
    lastSyncAt: Date.now(),
  };

  connectorInstances.set(connectorId, nextConnector);
  mergeProviderAgents(connectorId, connector.provider, nextAgents);
  mergeSchedules(connectorId, connector.provider, nextSchedules);
  syncConnectorOfficeAgents(connectorId, nextAgents);
  broadcastMissionSnapshot();

  return publicConnectorShape(nextConnector);
}

function applyHermesWatcherSnapshot(connectorId: string, snapshot: HermesAgentStateSnapshot): void {
  const connector = connectorInstances.get(connectorId);
  if (!connector || connector.provider !== "hermes" || !connector.enabled) {
    return;
  }

  applyProviderSyncResult(
    connectorId,
    buildWatcherHealth(connector, snapshot),
    snapshot.agents,
    connectorSchedules(connectorId),
  );
}

function snapshotSignature(snapshot: HermesAgentStateSnapshot): string {
  return JSON.stringify({
    exists: snapshot.exists,
    empty: snapshot.empty,
    agents: snapshot.agents.map((agent) => ({
      externalId: agent.externalId,
      status: agent.status,
      activityStatus: agent.activityStatus ?? null,
      currentTicket: agent.currentTicket ?? null,
      taskStage: agent.taskStage ?? null,
      lastActivityAt: agent.lastActivityAt ?? null,
      task: agent.task ?? null,
    })),
  });
}

function normalizeHermesRuntimeAgentId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function connectorRuntimeAgentId(connector: ProviderConnectorState): string {
  const commandLabel = connector.baseUrl ? path.basename(connector.baseUrl.trim()) : "";
  const candidates = [connector.id, commandLabel, connector.label];
  for (const candidate of candidates) {
    const normalized = normalizeHermesRuntimeAgentId(candidate);
    if (normalized) {
      return normalized.endsWith("-gateway")
        ? normalized.slice(0, -"-gateway".length)
        : normalized;
    }
  }
  return "hermes";
}

function titleizeRuntimeAgentId(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeRuntimeTimestamp(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function buildRuntimePreview(event: HermesRuntimeAgentStateEvent): string | null {
  const parts = [
    event.platform?.trim() || "",
    event.status === "working"
      ? event.messageTruncated?.trim() || ""
      : event.responseTruncated?.trim() || "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : null;
}

function commitHermesRuntimeAgent(
  connectorId: string,
  connector: ProviderConnectorState,
  runtime: HermesConnectorRuntime,
  nextAgent: ProviderAgentRecord,
): void {
  const currentAgents = providerAgents.filter((entry) => entry.connectorId === connectorId);
  const existingIndex = currentAgents.findIndex((entry) => providerExternalIdAliases(entry.externalId).has(nextAgent.externalId));

  const nextAgents = existingIndex >= 0
    ? currentAgents.map((entry, index) => (index === existingIndex ? nextAgent : entry))
    : [...currentAgents, nextAgent].sort((left, right) => left.name.localeCompare(right.name));

  runtime.lastSnapshot = {
    agents: nextAgents,
    exists: true,
    empty: nextAgents.length === 0,
    mtimeMs: Date.now(),
    path: `${connector.runtimeBaseUrl?.trim() || ""}/events`,
  };
  runtime.lastAppliedSignature = snapshotSignature(runtime.lastSnapshot);

  applyProviderSyncResult(
    connectorId,
    buildHermesStateHealth(connector, nextAgents, `${connector.runtimeBaseUrl?.trim() || ""}/events`),
    nextAgents,
    connectorSchedules(connectorId),
  );
}

function applyHermesRuntimeEvent(connectorId: string, event: HermesRuntimeAgentStateEvent): void {
  const connector = connectorInstances.get(connectorId);
  const runtime = hermesConnectorRuntimes.get(connectorId);
  if (!connector || connector.provider !== "hermes" || !connector.enabled || !runtime) {
    return;
  }

  const eventAgentId = normalizeHermesRuntimeAgentId(event.agentId);
  if (!eventAgentId || connectorRuntimeAgentId(connector) !== eventAgentId) {
    return;
  }

  const currentAgents = providerAgents.filter((entry) => entry.connectorId === connectorId);
  const existingIndex = currentAgents.findIndex((entry) => providerExternalIdAliases(entry.externalId).has(eventAgentId));
  const existing = existingIndex >= 0 ? currentAgents[existingIndex] : null;
  const lastActivityAt = normalizeRuntimeTimestamp(event.startedAt ?? event.completedAt);
  const preview = buildRuntimePreview(event);

  const nextAgent: ProviderAgentRecord = {
    connectorId,
    provider: "hermes",
    externalId: eventAgentId,
    name: existing?.name ?? titleizeRuntimeAgentId(eventAgentId),
    role: existing?.role,
    officeAgentId: existing?.officeAgentId,
    status: event.status,
    activityStatus: null,
    currentTicket: null,
    taskStage: event.status === "working" ? preview : null,
    lastActivityAt,
    ...(event.status === "working" && preview ? { task: preview } : {}),
    ...(lastActivityAt ? { lastSeenAt: Date.parse(lastActivityAt) } : existing?.lastSeenAt ? { lastSeenAt: existing.lastSeenAt } : {}),
    ...(connector.runtimeBaseUrl ? { runtimeBaseUrl: connector.runtimeBaseUrl } : {}),
    imported: existing?.imported ?? false,
  };

  // Clear any pending deferred idle timer for this agent.
  const existingTimer = runtime.deferredIdleTimers.get(eventAgentId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    runtime.deferredIdleTimers.delete(eventAgentId);
  }

  if (event.status === "working") {
    runtime.workingStartTimes.set(eventAgentId, Date.now());
    commitHermesRuntimeAgent(connectorId, connector, runtime, nextAgent);
    return;
  }

  // For idle events, ensure the "working" state was visible for a minimum
  // duration so the user can actually see the blue glow before it disappears.
  const workingStartedAt = runtime.workingStartTimes.get(eventAgentId);
  runtime.workingStartTimes.delete(eventAgentId);
  const elapsed = workingStartedAt != null ? Date.now() - workingStartedAt : HERMES_MIN_WORKING_VISIBLE_MS;

  if (elapsed >= HERMES_MIN_WORKING_VISIBLE_MS) {
    commitHermesRuntimeAgent(connectorId, connector, runtime, nextAgent);
    return;
  }

  const delay = HERMES_MIN_WORKING_VISIBLE_MS - elapsed;
  const timer = setTimeout(() => {
    runtime.deferredIdleTimers.delete(eventAgentId);
    runtime.workingStartTimes.delete(eventAgentId);
    commitHermesRuntimeAgent(connectorId, connector, runtime, nextAgent);
  }, delay);
  timer.unref?.();
  runtime.deferredIdleTimers.set(eventAgentId, timer);
}

function markHermesRuntimeConnected(connectorId: string): void {
  const connector = connectorInstances.get(connectorId);
  if (!connector || connector.provider !== "hermes") {
    return;
  }

  // Reset all agents to idle on SSE (re)connect.  Any stale "working" state
  // from before the gateway restarted is no longer valid — if the agent is
  // truly active the gateway will emit a fresh "working" event immediately.
  const currentAgents = providerAgents.filter((entry) => entry.connectorId === connectorId);
  const resetAgents = currentAgents.map((agent) =>
    agent.status === "working"
      ? { ...agent, status: "idle" as const, activityStatus: null, taskStage: null, task: undefined }
      : agent,
  );
  if (resetAgents.some((agent, i) => agent !== currentAgents[i])) {
    applyProviderSyncResult(
      connectorId,
      buildHermesStateHealth(connector, resetAgents, `${connector.runtimeBaseUrl?.trim() || ""}/events`),
      resetAgents,
      connectorSchedules(connectorId),
    );
    return;
  }

  connectorInstances.set(connectorId, {
    ...connector,
    health: buildHermesStateHealth(
      connector,
      currentAgents,
      `${connector.runtimeBaseUrl?.trim() || ""}/events`,
    ),
  });
  broadcastMissionSnapshot();
}

function scheduleHermesRuntimeReconnect(connectorId: string): void {
  const connector = connectorInstances.get(connectorId);
  const runtime = hermesConnectorRuntimes.get(connectorId);
  if (!connector || connector.provider !== "hermes" || !connector.enabled || !runtime || runtime.eventReconnectTimer) {
    return;
  }

  runtime.eventReconnectTimer = setTimeout(() => {
    runtime.eventReconnectTimer = null;
    startHermesRuntimeSubscription(connectorId);
  }, HERMES_RUNTIME_RECONNECT_MS);
  runtime.eventReconnectTimer.unref?.();
}

function startHermesRuntimeSubscription(connectorId: string): void {
  const connector = connectorInstances.get(connectorId);
  const runtime = hermesConnectorRuntimes.get(connectorId);
  const runtimeBaseUrl = connector?.runtimeBaseUrl?.trim() ?? "";

  if (!connector || connector.provider !== "hermes" || !connector.enabled || !runtime || !runtimeBaseUrl) {
    return;
  }

  const existingStream = runtime.eventStream;
  runtime.eventStream = null;
  existingStream?.close();
  runtime.eventReconnectTimer = clearHermesRuntimeTimer(runtime.eventReconnectTimer);

  const handle = subscribeToHermesRuntimeEvents({
    baseUrl: runtimeBaseUrl,
    ...(connectorAccessToken(connector) ? { token: connectorAccessToken(connector) } : {}),
    onOpen: () => {
      markHermesRuntimeConnected(connectorId);
    },
    onEvent: (event) => {
      applyHermesRuntimeEvent(connectorId, event);
    },
  });
  runtime.eventStream = handle;

  handle.closed.then(() => {
    if (runtime.eventStream === handle) {
      runtime.eventStream = null;
      scheduleHermesRuntimeReconnect(connectorId);
    }
  }).catch((error) => {
    if (runtime.eventStream === handle) {
      runtime.eventStream = null;
    }
    console.error(`[mission-control] Hermes runtime event stream failed for ${connectorId}:`, error);
    markConnectorRuntimeError(
      connectorId,
      error instanceof Error ? error.message : "Hermes runtime event stream failed.",
    );
    scheduleHermesRuntimeReconnect(connectorId);
  });
}

async function refreshRemoteHermesState(connectorId: string): Promise<void> {
  const connector = connectorInstances.get(connectorId);
  const runtime = hermesConnectorRuntimes.get(connectorId);
  const sshHost = connector?.websocketUrl?.trim() ?? "";

  if (!connector || connector.provider !== "hermes" || !connector.enabled || !runtime || !sshHost) {
    return;
  }

  try {
    const snapshot = await readHermesAgentStateSnapshotOverSsh(sshHost);
    const signature = snapshotSignature(snapshot);
    runtime.lastSnapshot = snapshot;
    if (runtime.lastAppliedSignature === signature) {
      return;
    }
    runtime.lastAppliedSignature = signature;
    applyHermesWatcherSnapshot(connectorId, snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read remote Hermes agent state.";
    console.error(`[mission-control] Hermes remote state refresh failed for ${connectorId}:`, error);
    markConnectorRuntimeError(connectorId, message);
  }
}

function markConnectorRuntimeError(connectorId: string, message: string): void {
  const connector = connectorInstances.get(connectorId);
  if (!connector) {
    return;
  }

  connectorInstances.set(connectorId, {
    ...connector,
    health: {
      ...connector.health,
      status: "error",
      checkedAt: Date.now(),
      message,
    },
  });
  broadcastMissionSnapshot();
}

function buildMissionSnapshot(): MissionControlSnapshot {
  return {
    connectors: Array.from(connectorInstances.values()).map(publicConnectorShape),
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
    connectors: Array.from(connectorInstances.values()).map(persistedConnectorShape),
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
  if (linearTimer) {
    clearInterval(linearTimer);
    linearTimer = null;
  }
  Array.from(hermesConnectorRuntimes.keys()).forEach((connectorId) => {
    stopHermesConnectorRuntime(connectorId);
  });
}

function scheduleLinearSync(): void {
  if (linearTimer) {
    clearInterval(linearTimer);
  }
  linearTimer = setInterval(() => {
    void syncMissionTasks().catch((error) => {
      console.error("[mission-control] Linear sync failed:", error);
    });
  }, LINEAR_SYNC_INTERVAL_MS);
}

export function configureMissionControlRuntime(callback: (message: ServerMessage) => void): void {
  broadcast = callback;
}

export async function loadMissionControl(): Promise<void> {
  clearTimers();
  const persisted = await readPersistedMissionControl();

  for (const saved of persisted.connectors) {
    const id = saved.id ?? saved.provider; // backward compat
    connectorInstances.set(id, hydrateConnector(saved.provider, id, saved));
  }

  // Ensure default connectors exist for any provider types not yet persisted
  const CONNECTOR_ORDER: MissionProvider[] = ["hermes", "claude-local", "codex-local"];
  for (const provider of CONNECTOR_ORDER) {
    const exists = Array.from(connectorInstances.values()).some((c) => c.provider === provider);
    if (!exists) {
      connectorInstances.set(provider, hydrateConnector(provider, provider));
    }
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
  return Array.from(connectorInstances.values()).map(publicConnectorShape);
}

export function getMissionControlSnapshot(): MissionControlSnapshot {
  return buildMissionSnapshot();
}

export function getMissionConnectorState(connectorId: string): ProviderConnectorState | undefined {
  const connector = connectorInstances.get(connectorId);
  return connector ? { ...connector } : undefined;
}

export async function updateMissionConnector(connectorId: string, updates: ProviderConnectorUpdateRequest): Promise<ProviderConnector> {
  const current = connectorInstances.get(connectorId);
  if (!current) {
    throw new RequestBodyError(`Unknown connector ${connectorId}.`, 404);
  }

  const nextToken = updates.token !== undefined ? updates.token.trim() : (current.token ?? "");
  const mergedAdapterConfig = updates.adapterConfig
    ? { ...current.adapterConfig, ...updates.adapterConfig }
    : current.adapterConfig;
  const next: ProviderConnectorState = {
    ...current,
    enabled: updates.enabled ?? current.enabled,
    baseUrl: updates.baseUrl?.trim() || (updates.baseUrl === "" ? undefined : current.baseUrl),
    websocketUrl: updates.websocketUrl?.trim() || (updates.websocketUrl === "" ? undefined : current.websocketUrl),
    runtimeBaseUrl: updates.runtimeBaseUrl?.trim() || (updates.runtimeBaseUrl === "" ? undefined : current.runtimeBaseUrl),
    authMode: updates.authMode ?? (nextToken ? "bearer" : "none"),
    token: nextToken || undefined,
    tokenConfigured: Boolean(nextToken),
    adapterConfig: mergedAdapterConfig,
  };

  connectorInstances.set(connectorId, next);
  if (!next.enabled) {
    mergeProviderAgents(connectorId, next.provider, []);
    mergeSchedules(connectorId, next.provider, []);
    syncConnectorOfficeAgents(connectorId, []);
  }
  await queuePersistMissionControl();
  await reconcileConnectorRuntime(connectorId);
  broadcastMissionSnapshot();
  return publicConnectorShape(connectorInstances.get(connectorId) ?? next);
}

export async function testMissionConnector(connectorId: string): Promise<ProviderConnector> {
  return syncMissionConnector(connectorId);
}

export async function syncMissionConnector(connectorId: string): Promise<ProviderConnector> {
  return performConnectorSync(connectorId, true);
}

async function performConnectorSync(connectorId: string, announceSync: boolean): Promise<ProviderConnector> {
  const inFlight = connectorSyncs.get(connectorId);
  if (inFlight) {
    return inFlight;
  }

  const pending = runConnectorSync(connectorId, announceSync).finally(() => {
    connectorSyncs.delete(connectorId);
  });
  connectorSyncs.set(connectorId, pending);
  return pending;
}

async function runConnectorSync(connectorId: string, announceSync: boolean): Promise<ProviderConnector> {
  const connector = connectorInstances.get(connectorId);
  if (!connector) {
    throw new RequestBodyError(`Unknown connector ${connectorId}.`, 404);
  }

  const syncing: ProviderConnectorState = announceSync
    ? {
        ...connector,
        health: {
          ...connector.health,
          status: connector.enabled && connector.baseUrl ? "syncing" : "disabled",
          checkedAt: Date.now(),
          message: connector.enabled && connector.baseUrl ? `Syncing ${connector.label}...` : "Connector disabled.",
        },
      }
    : connector;
  if (announceSync) {
    connectorInstances.set(connectorId, syncing);
    broadcastMissionSnapshot();
  }

  try {
    const result = await syncProviderConnector(syncing);
    return applyProviderSyncResult(connectorId, result.health, result.agents, result.schedules);
  } catch (error) {
    const message = error instanceof Error ? error.message : `Failed to sync ${connectorId}.`;
    const failed: ProviderConnectorState = {
      ...syncing,
      health: {
        provider: connector.provider,
        status: "error",
        checkedAt: Date.now(),
        activeAgents: syncing.health.activeAgents,
        schedules: syncing.health.schedules,
        message,
      },
    };
    connectorInstances.set(connectorId, failed);
    broadcastMissionSnapshot();
    return publicConnectorShape(failed);
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
  pushActivity(
    "workflow-handoff",
    `Handoff created: ${handoff.fromAgentName} \u2192 ${handoff.toAgentName} on ${task.identifier} \u2014 ${note}`,
    handoff.toAgentId,
  );
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
  pushActivity(
    "workflow-handoff",
    `Handoff ${input.status}: ${next.toAgentName} ${input.status} handoff from ${next.fromAgentName}`,
    next.toAgentId,
  );
  await queuePersistMissionControl();
  broadcastMissionSnapshot();
  return next;
}

function adapterConfigForConnector(connectorId: string): Record<string, unknown> | null {
  const connector = connectorInstances.get(connectorId);
  if (!connector?.enabled || !connector.baseUrl) return null;
  return {
    ...connector.adapterConfig,
    baseUrl: connector.baseUrl,
    websocketUrl: connector.websocketUrl,
    runtimeBaseUrl: connector.runtimeBaseUrl,
    token: connectorAccessToken(connector) || undefined,
  };
}

export async function fetchAgentMessages(agentId: string): Promise<AdapterMessage[]> {
  const state = agentStates.get(agentId);
  if (!state?.backendLink?.provider || state.backendLink.provider === "unlinked") {
    return [];
  }

  const connectorId = state.backendLink.connectorId ?? state.backendLink.provider;
  const connector = connectorInstances.get(connectorId);
  if (!connector) return [];

  const adapter = getAdapter(connector.provider as AdapterType);
  if (!adapter?.fetchMessages) return [];

  const config = adapterConfigForConnector(connectorId);
  if (!config) return [];

  const externalId = state.backendLink.agentId ?? "";
  return adapter.fetchMessages(config, externalId);
}

export async function sendAgentMessage(agentId: string, message: string): Promise<AdapterMessage | null> {
  const state = agentStates.get(agentId);
  if (!state?.backendLink?.provider || state.backendLink.provider === "unlinked") {
    throw new RequestBodyError("Agent has no provider link.");
  }

  const connectorId = state.backendLink.connectorId ?? state.backendLink.provider;
  const connector = connectorInstances.get(connectorId);
  if (!connector) {
    throw new RequestBodyError(`Connector ${connectorId} is not configured.`);
  }

  const adapter = getAdapter(connector.provider as AdapterType);
  if (!adapter?.sendMessage) {
    throw new RequestBodyError(`${connector.provider} adapter does not support sending messages.`);
  }

  const config = adapterConfigForConnector(connectorId);
  if (!config) {
    throw new RequestBodyError(`${connector.label} connector is not configured or disabled.`);
  }

  const externalId = state.backendLink.agentId ?? "";
  console.log(`[mission-control] sendMessage to ${state.name} (${connectorId}/${externalId}): "${message.slice(0, 60)}"`);
  const result = await adapter.sendMessage(config, externalId, message);
  console.log(`[mission-control] sendMessage result:`, result ? `${result.role}: ${result.content.slice(0, 100)}` : "null");

  pushActivity(
    "agent-message",
    `Message sent to ${state.name}: ${message.length > 80 ? `${message.slice(0, 80)}...` : message}`,
    agentId,
  );

  return result;
}

export async function startMissionControl(): Promise<void> {
  initializeAdapters();
  await loadMissionControl();
  scheduleLinearSync();
  await Promise.allSettled(Array.from(connectorInstances.keys()).map((id) => reconcileConnectorRuntime(id)));
  await Promise.allSettled([
    syncMissionTasks(),
    ...Array.from(connectorInstances.keys()).map((id) => syncMissionConnector(id)),
  ]);
}

export async function createMissionConnector(provider: MissionProvider, label?: string): Promise<ProviderConnector> {
  let id = label ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") : provider;
  if (connectorInstances.has(id)) {
    id = `${id}-${Date.now().toString(36).slice(-4)}`;
  }

  const connector = defaultConnector(provider, id, label);
  connector.enabled = true;
  connectorInstances.set(id, connector);
  await queuePersistMissionControl();
  await reconcileConnectorRuntime(id);
  broadcastMissionSnapshot();
  return publicConnectorShape(connector);
}

export async function deleteMissionConnector(connectorId: string): Promise<void> {
  if (!connectorInstances.has(connectorId)) {
    throw new RequestBodyError(`Connector ${connectorId} not found.`, 404);
  }
  stopHermesConnectorRuntime(connectorId);
  connectorInstances.delete(connectorId);
  providerAgents = providerAgents.filter((a) => a.connectorId !== connectorId);
  schedules = schedules.filter((s) => s.connectorId !== connectorId);
  await queuePersistMissionControl();
  broadcastMissionSnapshot();
}

export function isConnectorCreateRequest(value: unknown): value is { provider: MissionProvider; label?: string } {
  return isRecord(value)
    && (value.provider === "hermes" || value.provider === "claude-local" || value.provider === "codex-local")
    && (value.label === undefined || typeof value.label === "string");
}

async function reconcileConnectorRuntime(connectorId: string): Promise<void> {
  const connector = connectorInstances.get(connectorId);
  if (!connector || connector.provider !== "hermes" || !connector.enabled) {
    stopHermesConnectorRuntime(connectorId);
    return;
  }

  const runtime = ensureHermesConnectorRuntime(connectorId);
  const sshHost = connector.websocketUrl?.trim() ?? "";
  const runtimeBaseUrl = connector.runtimeBaseUrl?.trim() ?? "";

  const eventStream = runtime.eventStream;
  runtime.eventStream = null;
  eventStream?.close();
  runtime.watcher?.stop();
  runtime.watcher = null;
  runtime.eventReconnectTimer = clearHermesRuntimeTimer(runtime.eventReconnectTimer);
  runtime.remoteStateTimer = clearHermesRuntimeTimer(runtime.remoteStateTimer);
  runtime.lastAppliedSignature = null;

  if (runtimeBaseUrl) {
    console.log(`[mission-control] Hermes runtime event subscription enabled for ${connectorId} via ${runtimeBaseUrl}.`);
    startHermesRuntimeSubscription(connectorId);
    return;
  }

  if (sshHost) {
    console.log(`[mission-control] Hermes remote state polling enabled for ${connectorId} via ${sshHost}.`);
    runtime.remoteStateTimer = setInterval(() => {
      void refreshRemoteHermesState(connectorId);
    }, HERMES_REMOTE_STATE_POLL_MS);
    runtime.remoteStateTimer.unref?.();
    await refreshRemoteHermesState(connectorId);
    return;
  }

  runtime.watcher = createAgentStateWatcher({
    debounceMs: 200,
    onError: (error) => {
      console.error("[mission-control] Hermes agent-state watcher failed:", error);
      markConnectorRuntimeError(connectorId, error.message);
    },
    onSnapshot: (snapshot) => {
      runtime.lastSnapshot = snapshot;
      runtime.lastAppliedSignature = snapshotSignature(snapshot);
      applyHermesWatcherSnapshot(connectorId, snapshot);
    },
  });
  await runtime.watcher.start();
  console.log(`[mission-control] Hermes file watcher enabled for ${connectorId} at ${DEFAULT_HERMES_AGENT_STATE_FILE}.`);
}

export function isProviderConnectorUpdateRequest(value: unknown): value is ProviderConnectorUpdateRequest {
  return isRecord(value)
    && (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.baseUrl === undefined || typeof value.baseUrl === "string")
    && (value.websocketUrl === undefined || typeof value.websocketUrl === "string")
    && (value.runtimeBaseUrl === undefined || typeof value.runtimeBaseUrl === "string")
    && (value.authMode === undefined || value.authMode === "none" || value.authMode === "bearer")
    && (value.token === undefined || typeof value.token === "string")
    && (value.adapterConfig === undefined || isRecord(value.adapterConfig));
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
