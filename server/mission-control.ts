import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HERMES_COMMAND,
  HERMES_RUNTIME_URL,
  HERMES_TOKEN,
  HERMES_TOKEN_CONFIGURED,
  HERMES_URL,
  HERMES_WS_URL,
  LINEAR_SYNC_INTERVAL_MS,
  MISSION_PROVIDER_LABELS,
  RequestBodyError,
  dataDir,
  missionControlFilePath,
  type PersistedHermesDefaults,
  type PersistedMissionConnector,
  type PersistedMissionControlFile,
} from "./types";
import type { ServerMessage } from "../src/types";
import type {
  HermesDefaults,
  HermesDefaultsUpdateRequest,
  MissionControlSnapshot,
  MissionProvider,
  MissionRosterImportStatus,
  MissionSyncStatus,
  MissionTask,
  MissionTaskAutomation,
  MissionTaskAutomationStatus,
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
import { logDebug, logWarn } from "./logger";
import {
  buildWorkerExecutionPrompt,
  buildWorkerMalformedResultPrompt,
  canRetryScoutReview,
  detectAgentTransportIssue,
  developBranchPolicyInstructions,
  isRetryableAgentTransportError,
  looksLikeMetaWorkerResult,
  mergeWorkerExecutionContext,
  parseAgentJson,
  workerExecutionContextFromTask,
  type WorkerRoute,
} from "./mission-workflow";
import { runMissionTaskWorkflow as executeMissionTaskWorkflow } from "./mission-task-workflow";
import { syncProviderConnector } from "./provider-connectors";
import { getAdapter, initializeAdapters } from "./adapters/registry";
import type { AdapterMessage, AdapterType } from "./adapters/types";
import { generateId } from "./utils";
import { isProviderAgentActivelyExecuting } from "../src/mission/providerAgents";

interface ProviderConnectorState extends ProviderConnector {
  token?: string | undefined;
}

interface HermesDefaultsState extends HermesDefaults {
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
const taskAutomationStates = new Map<string, MissionTaskAutomation>();
const runningTaskAutomations = new Map<string, Promise<void>>();
const optimisticTaskAgentChains = new Map<string, string[]>();
const optimisticAgentTaskLabels = new Map<string, Map<string, string>>();
let hermesDefaults: HermesDefaultsState = {
  sshHost: HERMES_WS_URL || undefined,
  runtimeHost: HERMES_RUNTIME_URL || HERMES_URL || undefined,
  token: HERMES_TOKEN.trim() || undefined,
  tokenConfigured: HERMES_TOKEN_CONFIGURED,
};

const MAX_AGENT_JSON_MESSAGE_ATTEMPTS = 3;
const AGENT_JSON_MESSAGE_RETRY_DELAY_MS = 1_500;

function publicHermesDefaultsShape(): HermesDefaults {
  return {
    sshHost: hermesDefaults.sshHost,
    runtimeHost: hermesDefaults.runtimeHost,
    tokenConfigured: hermesDefaults.tokenConfigured,
  };
}

function normalizeHermesRuntimeHost(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed;
}

function joinRuntimeHostAndPort(runtimeHost: string, runtimePort: number): string {
  return `${normalizeHermesRuntimeHost(runtimeHost)}:${runtimePort}`;
}

function parseRuntimePortFromUrl(runtimeBaseUrl: string | undefined, runtimeHost: string | undefined): number | undefined {
  const runtimeUrl = runtimeBaseUrl?.trim() ?? "";
  const sharedHost = runtimeHost?.trim().replace(/\/+$/, "") ?? "";
  if (!runtimeUrl || !sharedHost || !runtimeUrl.startsWith(`${sharedHost}:`)) {
    return undefined;
  }
  const port = Number(runtimeUrl.slice(sharedHost.length + 1).trim());
  return Number.isFinite(port) && port > 0 ? Math.trunc(port) : undefined;
}

function connectorRuntimePort(connector: ProviderConnectorState): number | undefined {
  const value = connector.adapterConfig?.runtimePort;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function connectorUsesHermesDefaults(connector: ProviderConnectorState): boolean {
  return connector.provider === "hermes" && connector.useHermesDefaults !== false;
}

function defaultHermesToken(): string {
  return hermesDefaults.token?.trim() || HERMES_TOKEN.trim();
}

function resolvedHermesSshHost(connector: ProviderConnectorState): string {
  const own = connector.websocketUrl?.trim() ?? "";
  if (own) {
    return own;
  }
  if (!connectorUsesHermesDefaults(connector)) {
    return "";
  }
  return hermesDefaults.sshHost?.trim() ?? "";
}

function resolvedHermesRuntimeBaseUrl(connector: ProviderConnectorState): string {
  const own = connector.runtimeBaseUrl?.trim() ?? "";
  if (own) {
    return own;
  }
  if (!connectorUsesHermesDefaults(connector)) {
    return "";
  }
  const runtimeHost = hermesDefaults.runtimeHost?.trim() ?? "";
  const runtimePort = connectorRuntimePort(connector);
  if (runtimeHost && runtimePort) {
    return joinRuntimeHostAndPort(runtimeHost, runtimePort);
  }
  return runtimeHost;
}

function connectorAccessToken(connector: ProviderConnectorState): string {
  if (connector.provider !== "hermes") {
    return connector.token?.trim() ?? "";
  }
  return connector.token?.trim() || (connectorUsesHermesDefaults(connector) ? defaultHermesToken() : "");
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
  const runtimePort = connectorRuntimePort(connector);
  return {
    ...connector.adapterConfig,
    baseUrl: connector.baseUrl ?? "",
    websocketUrl: connector.websocketUrl ?? "",
    runtimeBaseUrl: connector.runtimeBaseUrl ?? "",
    token: connector.tokenConfigured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "",
    runtimePort: runtimePort ?? "",
  };
}

function defaultConnector(provider: MissionProvider, id: string, label?: string): ProviderConnectorState {
  const displayLabel = label ?? MISSION_PROVIDER_LABELS[provider];

  if (provider === "hermes") {
    return {
      id,
      provider,
      label: displayLabel,
      enabled: HERMES_COMMAND !== "hermes" || Boolean(process.env.HERMES_COMMAND),
      baseUrl: HERMES_COMMAND || undefined,
      websocketUrl: undefined,
      runtimeBaseUrl: undefined,
      authMode: defaultHermesToken() ? "bearer" as const : "none" as const,
      token: undefined,
      tokenConfigured: false,
      useHermesDefaults: true,
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
    useHermesDefaults: connector.useHermesDefaults,
  };
}

function hydrateConnector(provider: MissionProvider, id: string, persisted?: PersistedMissionConnector): ProviderConnectorState {
  const base = defaultConnector(provider, id, persisted?.label);
  if (!persisted) {
    return base;
  }

  let token = persisted.token?.trim() || (base.token ?? "");
  let websocketUrl = persisted.websocketUrl ?? base.websocketUrl;
  let runtimeBaseUrl = persisted.runtimeBaseUrl ?? base.runtimeBaseUrl;
  let adapterConfig = persisted.adapterConfig ?? base.adapterConfig;
  const useHermesDefaults = persisted.useHermesDefaults ?? base.useHermesDefaults;

  if (provider === "hermes" && useHermesDefaults) {
    if ((websocketUrl?.trim() ?? "") === (hermesDefaults.sshHost?.trim() ?? "")) {
      websocketUrl = undefined;
    }
    if ((token || "") === (hermesDefaults.token ?? "")) {
      token = "";
    }
    const derivedRuntimePort = parseRuntimePortFromUrl(runtimeBaseUrl, hermesDefaults.runtimeHost);
    if (derivedRuntimePort) {
      adapterConfig = {
        ...adapterConfig,
        runtimePort: derivedRuntimePort,
      };
      runtimeBaseUrl = undefined;
    }
  }

  const authMode = persisted.token?.trim()
    ? (persisted.authMode ?? "bearer")
    : (token ? "bearer" : (persisted.authMode ?? base.authMode));

  return {
    ...base,
    enabled: persisted.enabled,
    baseUrl: persisted.baseUrl ?? base.baseUrl,
    websocketUrl,
    runtimeBaseUrl,
    authMode,
    token: token || undefined,
    tokenConfigured: Boolean(token),
    lastSyncAt: persisted.lastSyncAt,
    adapterConfig,
    useHermesDefaults,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPersistedHermesDefaults(value: unknown): value is PersistedHermesDefaults {
  return isRecord(value)
    && (value.sshHost === undefined || typeof value.sshHost === "string")
    && (value.runtimeHost === undefined || typeof value.runtimeHost === "string")
    && (value.token === undefined || typeof value.token === "string");
}

function hydrateHermesDefaults(persisted?: PersistedHermesDefaults): HermesDefaultsState {
  const token = persisted?.token?.trim() || HERMES_TOKEN.trim();
  return {
    sshHost: persisted?.sshHost?.trim() || HERMES_WS_URL || undefined,
    runtimeHost: persisted?.runtimeHost?.trim() || HERMES_RUNTIME_URL || HERMES_URL || undefined,
    token: token || undefined,
    tokenConfigured: Boolean(token),
  };
}

function persistedHermesDefaultsShape(): PersistedHermesDefaults {
  return {
    sshHost: hermesDefaults.sshHost,
    runtimeHost: hermesDefaults.runtimeHost,
    token: hermesDefaults.token,
  };
}

function extractRuntimeHost(runtimeBaseUrl: string | undefined): string | undefined {
  const raw = runtimeBaseUrl?.trim() ?? "";
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.includes(":") ? `[${parsed.hostname}]` : parsed.hostname;
    return `${parsed.protocol}//${hostname}`;
  } catch {
    return undefined;
  }
}

function inferHermesDefaultsFromConnectors(connectors: PersistedMissionConnector[]): PersistedHermesDefaults | undefined {
  const hermesConnectors = connectors.filter((connector) => connector.provider === "hermes");
  if (hermesConnectors.length === 0) {
    return undefined;
  }
  const first = hermesConnectors[0];
  return {
    sshHost: first?.websocketUrl?.trim() || undefined,
    runtimeHost: extractRuntimeHost(first?.runtimeBaseUrl),
    token: first?.token?.trim() || undefined,
  };
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
    && (value.useHermesDefaults === undefined || typeof value.useHermesDefaults === "boolean")
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
    syncOfficeAgentRuntimeState(state.id, providerState);
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
  const sshHost = resolvedHermesSshHost(connector);
  const source = sshHost
    ? `${sshHost}:${snapshot.path}`
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
    path: `${resolvedHermesRuntimeBaseUrl(connector) || ""}/events`,
  };
  runtime.lastAppliedSignature = snapshotSignature(runtime.lastSnapshot);

  applyProviderSyncResult(
    connectorId,
    buildHermesStateHealth(connector, nextAgents, `${resolvedHermesRuntimeBaseUrl(connector) || ""}/events`),
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
      buildHermesStateHealth(connector, resetAgents, `${resolvedHermesRuntimeBaseUrl(connector) || ""}/events`),
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
      `${resolvedHermesRuntimeBaseUrl(connector) || ""}/events`,
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
  const runtimeBaseUrl = connector ? resolvedHermesRuntimeBaseUrl(connector) : "";

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
  const sshHost = connector ? resolvedHermesSshHost(connector) : "";

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

function publicTaskShape(task: MissionTask): MissionTask {
  const automation = taskAutomationStates.get(task.id);
  if (!automation) {
    return task;
  }
  return {
    ...task,
    automation: { ...automation },
  };
}

function taskById(taskId: string): MissionTask | undefined {
  return taskSnapshot.find((task) => task.id === taskId);
}

function taskAutomationLabel(taskId: string, step?: string): string {
  const task = taskById(taskId);
  const prefix = task?.identifier ?? taskId;
  return step?.trim() ? `${prefix} · ${step.trim()}` : prefix;
}

function agentParentChain(agentId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = agentId;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const state = agentStates.get(currentId);
    if (!state) {
      break;
    }
    chain.unshift(state.id);
    currentId = state.parentAgentId ?? undefined;
  }

  return chain;
}

function providerStateForOfficeAgent(agentId: string): ProviderAgentRecord | null {
  const state = agentStates.get(agentId);
  const backendLink = state?.backendLink;
  const backendAgentId = backendLink?.agentId?.trim();
  if (!state || !backendLink || !backendAgentId) {
    return null;
  }

  const aliases = providerExternalIdAliases(backendAgentId);
  return providerAgents.find((entry) => {
    if (backendLink.connectorId && entry.connectorId !== backendLink.connectorId) {
      return false;
    }
    return aliases.has(entry.externalId);
  }) ?? null;
}

function optimisticTaskLabelForAgent(agentId: string): string | null {
  const entries = optimisticAgentTaskLabels.get(agentId);
  if (!entries || entries.size === 0) {
    return null;
  }
  const values = Array.from(entries.values());
  return values[values.length - 1] ?? null;
}

function syncOfficeAgentRuntimeState(agentId: string, providerState?: ProviderAgentRecord | null): void {
  const state = agentStates.get(agentId);
  if (!state) {
    return;
  }

  const optimisticLabel = optimisticTaskLabelForAgent(agentId);
  const linkedProviderState = providerState ?? providerStateForOfficeAgent(agentId);
  const nextStatus = optimisticLabel
    ? "working"
    : linkedProviderState && isProviderAgentActivelyExecuting(linkedProviderState)
      ? "working"
      : "idle";
  const nextTask = optimisticLabel
    ?? linkedProviderState?.taskStage
    ?? linkedProviderState?.task
    ?? linkedProviderState?.currentTicket
    ?? "";

  if (state.status === nextStatus && (state.task ?? "") === nextTask) {
    return;
  }

  applyEvent({
    agentId,
    status: nextStatus,
    task: nextTask,
    location: "desk",
    timestamp: Date.now(),
  });
}

function reconcileTaskAgentChain(taskId: string, nextChain: string[], label: string): void {
  const previousChain = optimisticTaskAgentChains.get(taskId) ?? [];
  const touched = new Set<string>([...previousChain, ...nextChain]);

  previousChain.forEach((agentId) => {
    const labels = optimisticAgentTaskLabels.get(agentId);
    if (!labels) {
      return;
    }
    labels.delete(taskId);
    if (labels.size === 0) {
      optimisticAgentTaskLabels.delete(agentId);
    }
  });

  if (nextChain.length > 0) {
    optimisticTaskAgentChains.set(taskId, nextChain);
    nextChain.forEach((agentId) => {
      const labels = optimisticAgentTaskLabels.get(agentId) ?? new Map<string, string>();
      labels.set(taskId, label);
      optimisticAgentTaskLabels.set(agentId, labels);
    });
  } else {
    optimisticTaskAgentChains.delete(taskId);
  }

  touched.forEach((agentId) => syncOfficeAgentRuntimeState(agentId));
}

function updateTaskAutomation(
  taskId: string,
  input: {
    runId?: string | undefined;
    status: MissionTaskAutomationStatus;
    ownerAgentName?: string | undefined;
    route?: WorkerRoute | undefined;
    step?: string | undefined;
    message?: string | undefined;
  },
): MissionTaskAutomation {
  const current = taskAutomationStates.get(taskId);
  const next: MissionTaskAutomation = {
    runId: input.runId ?? current?.runId ?? generateId(),
    status: input.status,
    ownerAgentName: input.ownerAgentName ?? current?.ownerAgentName,
    route: input.route ?? current?.route,
    step: input.step ?? current?.step,
    message: input.message ?? current?.message,
    updatedAt: Date.now(),
  };
  taskAutomationStates.set(taskId, next);
  const shouldShowActiveChain = next.status === "running" || next.status === "in_review";
  const chain = shouldShowActiveChain && next.ownerAgentName
    ? agentParentChain(next.ownerAgentName)
    : [];
  reconcileTaskAgentChain(taskId, chain, taskAutomationLabel(taskId, next.step ?? next.message));
  broadcastMissionSnapshot();
  return next;
}

async function delayAgentJsonRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, AGENT_JSON_MESSAGE_RETRY_DELAY_MS * attempt));
}

async function sendAgentMessageForJson(agentId: string, prompt: string, label: string): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_AGENT_JSON_MESSAGE_ATTEMPTS; attempt += 1) {
    try {
      const response = await sendAgentMessage(agentId, prompt);
      const content = response?.content?.trim() ?? "";
      if (!content) {
        lastError = new RequestBodyError(`${label} returned no content.`, 502);
      } else {
        const transportIssue = detectAgentTransportIssue(content);
        if (!transportIssue) {
          return content;
        }

        lastError = new RequestBodyError(`${label} failed: ${transportIssue.message}`, transportIssue.statusCode);
        if (!transportIssue.retryable) {
          throw lastError;
        }
      }
    } catch (error) {
      if (!isRetryableAgentTransportError(error) || attempt === MAX_AGENT_JSON_MESSAGE_ATTEMPTS) {
        throw error;
      }
      lastError = error instanceof Error ? error : new RequestBodyError(`${label} failed.`, 502);
    }

    if (attempt < MAX_AGENT_JSON_MESSAGE_ATTEMPTS) {
      logWarn("mission-control", "Retrying transient agent JSON request", {
        agentId,
        label,
        attempt,
        maxAttempts: MAX_AGENT_JSON_MESSAGE_ATTEMPTS,
        error: lastError?.message ?? "",
      });
      await delayAgentJsonRetry(attempt);
    }
  }

  throw lastError ?? new RequestBodyError(`${label} returned no content.`, 502);
}
async function sendAgentJsonMessage<T>(agentId: string, prompt: string, label: string, schema: string): Promise<T> {
  const content = await sendAgentMessageForJson(agentId, prompt, label);

  try {
    return parseAgentJson<T>(content, label);
  } catch (error) {
    const repairedContent = await sendAgentMessageForJson(
      agentId,
      [
        "Reformat the following content as valid JSON only.",
        "Do not include markdown fences, commentary, plans, or tool output.",
        `Use exactly this schema: ${schema}`,
        "",
        "Content to reformat:",
        content,
      ].join("\n"),
      `${label} JSON repair`,
    );
    return parseAgentJson<T>(repairedContent, label);
  }
}

async function createAcceptedHandoff(
  taskId: string,
  fromAgentName: string,
  toAgentName: string,
  note: string,
): Promise<void> {
  const handoff = await createMissionTaskHandoff(taskId, {
    fromAgentId: fromAgentName,
    fromAgentName,
    toAgentId: toAgentName,
    toAgentName,
    note,
  });
  await respondMissionTaskHandoff(handoff.id, { status: "accepted" });
}

function ensureAgentSuffix(body: string, suffix: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return suffix;
  }
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed} ${suffix}`;
}

function buildMissionSnapshot(): MissionControlSnapshot {
  return {
    connectors: Array.from(connectorInstances.values()).map(publicConnectorShape),
    hermesDefaults: publicHermesDefaultsShape(),
    providerAgents: [...providerAgents],
    schedules: [...schedules],
    tasks: taskSnapshot.map(publicTaskShape),
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
      hermesDefaults: isPersistedHermesDefaults(parsed.hermesDefaults) ? parsed.hermesDefaults : undefined,
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
    hermesDefaults: persistedHermesDefaultsShape(),
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
  hermesDefaults = hydrateHermesDefaults(persisted.hermesDefaults ?? inferHermesDefaultsFromConnectors(persisted.connectors));

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
    useHermesDefaults: updates.useHermesDefaults ?? current.useHermesDefaults,
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

export async function updateHermesDefaults(updates: HermesDefaultsUpdateRequest): Promise<HermesDefaults> {
  const nextToken = updates.token !== undefined ? updates.token.trim() : (hermesDefaults.token ?? "");
  hermesDefaults = {
    sshHost: updates.sshHost !== undefined ? (updates.sshHost.trim() || undefined) : hermesDefaults.sshHost,
    runtimeHost: updates.runtimeHost !== undefined ? (normalizeHermesRuntimeHost(updates.runtimeHost) || undefined) : hermesDefaults.runtimeHost,
    token: nextToken || undefined,
    tokenConfigured: Boolean(nextToken),
  };
  await queuePersistMissionControl();
  await Promise.allSettled(
    Array.from(connectorInstances.values())
      .filter((connector) => connector.provider === "hermes" && connectorUsesHermesDefaults(connector))
      .map((connector) => reconcileConnectorRuntime(connector.id)),
  );
  broadcastMissionSnapshot();
  return publicHermesDefaultsShape();
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
    const liveTaskIds = new Set(snapshot.tasks.map((task) => task.id));
    Array.from(taskAutomationStates.keys()).forEach((taskId) => {
      if (!liveTaskIds.has(taskId)) {
        taskAutomationStates.delete(taskId);
        reconcileTaskAgentChain(taskId, [], taskId);
      }
    });
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
  return taskSnapshot.map(publicTaskShape);
}

export async function getMissionTaskDetail(taskId: string): Promise<MissionTaskDetail> {
  const detail = await fetchLinearTaskDetail(taskId, taskHandoffs);
  return {
    ...detail,
    task: publicTaskShape(detail.task),
  };
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
    websocketUrl: connector.provider === "hermes" ? resolvedHermesSshHost(connector) : connector.websocketUrl,
    runtimeBaseUrl: connector.provider === "hermes" ? resolvedHermesRuntimeBaseUrl(connector) : connector.runtimeBaseUrl,
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
  const startedAt = Date.now();
  logDebug("mission-control", "Sending agent message", {
    agentId,
    agentName: state.name,
    connectorId,
    externalId,
    messagePreview: message,
  });
  const result = await adapter.sendMessage(config, externalId, message);
  logDebug("mission-control", "Agent message completed", {
    agentId,
    agentName: state.name,
    connectorId,
    externalId,
    durationMs: Date.now() - startedAt,
    resultRole: result?.role ?? "null",
    resultPreview: result?.content ?? "",
    finishReason: result?.finishReason ?? "",
  });

  pushActivity(
    "agent-message",
    `Message sent to ${state.name}: ${message.length > 80 ? `${message.slice(0, 80)}...` : message}`,
    agentId,
  );

  return result;
}

async function runMissionTaskWorkflow(taskId: string, runId: string): Promise<void> {
  return executeMissionTaskWorkflow(taskId, runId, {
    addMissionTaskComment,
    createAcceptedHandoff,
    ensureAgentSuffix,
    getMissionTaskDetail,
    pushActivity,
    sendAgentJsonMessage,
    sendAgentMessage,
    updateTaskAutomation,
  });
}

export function startMissionTaskWorkflow(taskId: string): MissionTaskAutomation {
  const task = taskSnapshot.find((entry) => entry.id === taskId);
  if (!task) {
    throw new RequestBodyError("Mission task not found.", 404);
  }

  if (runningTaskAutomations.has(taskId)) {
    throw new RequestBodyError("Task workflow is already running.", 409);
  }

  const runId = generateId();
  const automation = updateTaskAutomation(taskId, {
    runId,
    status: "running",
    ownerAgentName: "Hermes",
    step: "Queued",
    message: "Queued for the Hermes workflow runner.",
  });

  const run = (async () => {
    try {
      await runMissionTaskWorkflow(taskId, runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown workflow failure.";
      updateTaskAutomation(taskId, {
        runId,
        status: "failed",
        step: "Failed",
        message,
      });
      const issueKey = taskSnapshot.find((entry) => entry.id === taskId)?.identifier ?? taskId;
      pushActivity("workflow-item", `${issueKey}: automated workflow failed. ${message}`, "Hermes");
      console.error(`[mission-control] automated task workflow failed for ${taskId}:`, error);
    } finally {
      runningTaskAutomations.delete(taskId);
    }
  })();

  runningTaskAutomations.set(taskId, run);
  return automation;
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

export const missionControlTestExports = {
  developBranchPolicyInstructions,
  buildWorkerExecutionPrompt,
  buildWorkerMalformedResultPrompt,
  canRetryScoutReview,
  detectAgentTransportIssue,
  isRetryableAgentTransportError,
  looksLikeMetaWorkerResult,
  mergeWorkerExecutionContext,
  workerExecutionContextFromTask,
};

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
  const sshHost = resolvedHermesSshHost(connector);
  const runtimeBaseUrl = resolvedHermesRuntimeBaseUrl(connector);

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
    && (value.useHermesDefaults === undefined || typeof value.useHermesDefaults === "boolean")
    && (value.adapterConfig === undefined || isRecord(value.adapterConfig));
}

export function isHermesDefaultsUpdateRequest(value: unknown): value is HermesDefaultsUpdateRequest {
  return isRecord(value)
    && (value.sshHost === undefined || typeof value.sshHost === "string")
    && (value.runtimeHost === undefined || typeof value.runtimeHost === "string")
    && (value.token === undefined || typeof value.token === "string");
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
