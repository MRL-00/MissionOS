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
import type { AgentBackendProvider, AgentRegistration, AgentRuntimeState, ServerMessage } from "../src/types";
import type {
  HermesDefaults,
  HermesDefaultsUpdateRequest,
  MissionControlSnapshot,
  MissionProvider,
  MissionRosterImportStatus,
  MissionSyncStatus,
  MissionTask,
  MissionTaskCommentCreateRequest,
  MissionTaskDetail,
  MissionTaskExecution,
  MissionTaskRunArtifact,
  MissionTaskRunEvent,
  MissionTeamBootstrapAgentInput,
  MissionTeamBootstrapRequest,
  MissionTeamBootstrapResult,
  MissionTeamSettings,
  MissionTaskUpdateRequest,
  ProviderAgentRecord,
  ProviderConnector,
  ProviderConnectorUpdateRequest,
  ProviderHealth,
  ProviderScheduleEntry,
} from "../src/mission/types";
import { ensureDataDir } from "./auth/storage";
import { pushActivity } from "./activity";
import { agentAppearances, agentStates, applyEvent, getOrderedStates, residentDeskAssignments, upsertRegistration } from "./agents";
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
import { logDebug } from "./logger";
import { syncProviderConnector } from "./provider-connectors";
import { getAdapter, initializeAdapters } from "./adapters/registry";
import type { AdapterMessage, AdapterTaskRunArtifact, AdapterTaskRunEvent, AdapterType } from "./adapters/types";
import { generateId } from "./utils";
import { isProviderAgentActivelyExecuting } from "../src/mission/providerAgents";
import { queuePersistAgents } from "./persistence";

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

const CONNECTOR_PROVIDER_TO_BACKEND_PROVIDER: Record<MissionProvider, AgentBackendProvider> = {
  hermes: "hermes",
  "claude-local": "claude",
  "codex-local": "codex",
};

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
let taskRunEvents: MissionTaskRunEvent[] = [];
let taskRunArtifacts: MissionTaskRunArtifact[] = [];
const taskExecutions = new Map<string, MissionTaskExecution>();
const runningTaskExecutions = new Map<string, Promise<void>>();
const taskRunSessions = new Map<string, { taskId: string; runId: string; connectorId: string }>();
const taskRunIdsToSessions = new Map<string, Set<string>>();
let hermesDefaults: HermesDefaultsState = {
  sshHost: HERMES_WS_URL || undefined,
  runtimeHost: HERMES_RUNTIME_URL || HERMES_URL || undefined,
  token: HERMES_TOKEN.trim() || undefined,
  tokenConfigured: HERMES_TOKEN_CONFIGURED,
};
let teamSettings: MissionTeamSettings = {};

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

function hasExplicitUrlPort(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    return Boolean(new URL(trimmed).port);
  } catch {
    return /:\d+(?:\/|$)/.test(trimmed);
  }
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
  if (runtimeHost && hasExplicitUrlPort(runtimeHost)) {
    return normalizeHermesRuntimeHost(runtimeHost);
  }
  return "";
}

function connectorAccessToken(connector: ProviderConnectorState): string {
  if (connector.provider !== "hermes") {
    return connector.token?.trim() ?? "";
  }
  return connector.token?.trim() || (connectorUsesHermesDefaults(connector) ? defaultHermesToken() : "");
}

function connectorHasRunnableConfig(connector: ProviderConnectorState): boolean {
  if (!connector.enabled) {
    return false;
  }
  if (connector.provider === "hermes") {
    return Boolean(connector.baseUrl?.trim());
  }
  return true;
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
    adapterConfig: adapter?.defaultConfig(),
    capabilities: providerCapabilities(provider),
    health: {
      provider,
      status: "idle" as const,
      checkedAt: Date.now(),
      activeAgents: 0,
      schedules: 0,
      message: `Configure ${adapter?.label ?? provider} and test the CLI.`,
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

function isMissionTaskExecution(value: unknown): value is MissionTaskExecution {
  return isRecord(value)
    && typeof value.runId === "string"
    && typeof value.connectorId === "string"
    && typeof value.updatedAt === "number"
    && (value.status === "idle"
      || value.status === "queued"
      || value.status === "running"
      || value.status === "blocked"
      || value.status === "review_ready"
      || value.status === "completed"
      || value.status === "failed")
    && (value.activeOwnerId === undefined || typeof value.activeOwnerId === "string")
    && (value.activeOwnerLabel === undefined || typeof value.activeOwnerLabel === "string")
    && (value.stage === undefined || typeof value.stage === "string")
    && (value.message === undefined || typeof value.message === "string");
}

function isPersistedTaskExecution(value: unknown): value is MissionTaskExecution & { taskId: string } {
  return isMissionTaskExecution(value) && isRecord(value) && typeof value.taskId === "string";
}

function isMissionTaskRunEvent(value: unknown): value is MissionTaskRunEvent {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.taskId === "string"
    && typeof value.runId === "string"
    && typeof value.summary === "string"
    && typeof value.createdAt === "number"
    && (value.kind === "submitted"
      || value.kind === "started"
      || value.kind === "agent_state"
      || value.kind === "note"
      || value.kind === "completed"
      || value.kind === "failed")
    && (value.status === undefined
      || value.status === "idle"
      || value.status === "queued"
      || value.status === "running"
      || value.status === "blocked"
      || value.status === "review_ready"
      || value.status === "completed"
      || value.status === "failed")
    && (value.actorId === undefined || typeof value.actorId === "string")
    && (value.actorLabel === undefined || typeof value.actorLabel === "string");
}

function isMissionTaskRunArtifact(value: unknown): value is MissionTaskRunArtifact {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.taskId === "string"
    && typeof value.runId === "string"
    && typeof value.label === "string"
    && typeof value.createdAt === "number"
    && (value.kind === "response" || value.kind === "link" || value.kind === "log" || value.kind === "note")
    && (value.body === undefined || typeof value.body === "string")
    && (value.url === undefined || typeof value.url === "string");
}

function taskEventsForTask(taskId: string): MissionTaskRunEvent[] {
  return taskRunEvents
    .filter((event) => event.taskId === taskId)
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((event) => ({ ...event }));
}

function taskArtifactsForTask(taskId: string): MissionTaskRunArtifact[] {
  return taskRunArtifacts
    .filter((artifact) => artifact.taskId === taskId)
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((artifact) => ({ ...artifact }));
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

function isHermesRuntimeEventsMissing(error: unknown): boolean {
  return error instanceof Error
    && /Hermes runtime events request failed \(404\b/i.test(error.message);
}

function markConnectorRuntimeNotice(connectorId: string, message: string): void {
  const connector = connectorInstances.get(connectorId);
  if (!connector) {
    return;
  }

  connectorInstances.set(connectorId, {
    ...connector,
    health: {
      ...connector.health,
      status: connector.health.status === "disabled" ? "disabled" : "ok",
      checkedAt: Date.now(),
      message,
    },
  });
  broadcastMissionSnapshot();
}

function startHermesRemoteStatePolling(connectorId: string, sshHost: string): void {
  const connector = connectorInstances.get(connectorId);
  const runtime = hermesConnectorRuntimes.get(connectorId);
  if (!connector || connector.provider !== "hermes" || !connector.enabled || !runtime || !sshHost || runtime.remoteStateTimer) {
    return;
  }

  console.log(`[mission-control] Hermes remote state polling enabled for ${connectorId} via ${sshHost}.`);
  runtime.remoteStateTimer = setInterval(() => {
    void refreshRemoteHermesState(connectorId);
  }, HERMES_REMOTE_STATE_POLL_MS);
  runtime.remoteStateTimer.unref?.();
  void refreshRemoteHermesState(connectorId);
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
  if (!eventAgentId) {
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
  } else {
    const workingStartedAt = runtime.workingStartTimes.get(eventAgentId);
    runtime.workingStartTimes.delete(eventAgentId);
    const elapsed = workingStartedAt != null ? Date.now() - workingStartedAt : HERMES_MIN_WORKING_VISIBLE_MS;

    if (elapsed >= HERMES_MIN_WORKING_VISIBLE_MS) {
      commitHermesRuntimeAgent(connectorId, connector, runtime, nextAgent);
    } else {
      const delay = HERMES_MIN_WORKING_VISIBLE_MS - elapsed;
      const timer = setTimeout(() => {
        runtime.deferredIdleTimers.delete(eventAgentId);
        runtime.workingStartTimes.delete(eventAgentId);
        commitHermesRuntimeAgent(connectorId, connector, runtime, nextAgent);
      }, delay);
      timer.unref?.();
      runtime.deferredIdleTimers.set(eventAgentId, timer);
    }
  }

  const sessionKey = event.sessionId?.trim() || event.sessionKey?.trim() || "";
  if (!sessionKey) {
    return;
  }

  const trackedRun = taskRunSessions.get(sessionKey);
  if (!trackedRun) {
    return;
  }

  const actorId = nextAgent.officeAgentId ?? eventAgentId;
  const actorLabel = nextAgent.name;
  const eventStatus = event.status === "working" ? "running" : "running";
  const summary = event.status === "working"
    ? `${actorLabel} started work in Hermes.`
    : `${actorLabel} returned to idle in Hermes.`;
  taskRunEvents = [
    {
      id: generateId(),
      taskId: trackedRun.taskId,
      runId: trackedRun.runId,
      kind: "agent_state",
      summary,
      status: eventStatus,
      actorId,
      actorLabel,
      createdAt: Date.now(),
    },
    ...taskRunEvents,
  ];
  upsertTaskExecution(trackedRun.taskId, {
    runId: trackedRun.runId,
    connectorId,
    status: "running",
    activeOwnerId: actorId,
    activeOwnerLabel: actorLabel,
    stage: event.status === "working" ? "Running" : "Waiting",
    message: preview ?? undefined,
  });
  void queuePersistMissionControl();
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
    const currentConnector = connectorInstances.get(connectorId);
    const currentSshHost = currentConnector ? resolvedHermesSshHost(currentConnector) : "";
    const endpoint = `${runtimeBaseUrl.replace(/\/+$/, "")}/events`;

    if (isHermesRuntimeEventsMissing(error)) {
      if (currentSshHost) {
        console.warn(`[mission-control] Hermes runtime events are unavailable for ${connectorId} at ${endpoint}; falling back to SSH state polling via ${currentSshHost}.`);
        markConnectorRuntimeNotice(
          connectorId,
          `Live runtime events are unavailable at ${endpoint} (404). Falling back to SSH state polling via ${currentSshHost}.`,
        );
        startHermesRemoteStatePolling(connectorId, currentSshHost);
        return;
      }

      console.warn(`[mission-control] Hermes runtime events are unavailable for ${connectorId} at ${endpoint}.`);
      markConnectorRuntimeNotice(
        connectorId,
        `Live runtime events are unavailable at ${endpoint} (404). Hermes can still run tasks, but that runtime URL does not expose the event stream.`,
      );
      return;
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
  const execution = taskExecutions.get(task.id);
  if (!execution) {
    return task;
  }
  return {
    ...task,
    execution: { ...execution },
  };
}

function taskById(taskId: string): MissionTask | undefined {
  return taskSnapshot.find((task) => task.id === taskId);
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

function syncOfficeAgentRuntimeState(agentId: string, providerState?: ProviderAgentRecord | null): void {
  const state = agentStates.get(agentId);
  if (!state) {
    return;
  }

  const linkedProviderState = providerState ?? providerStateForOfficeAgent(agentId);
  const nextStatus = linkedProviderState && isProviderAgentActivelyExecuting(linkedProviderState)
    ? "working"
    : "idle";
  const nextTask = linkedProviderState?.taskStage
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

function upsertTaskExecution(
  taskId: string,
  input: {
    runId: string;
    connectorId: string;
    status: MissionTaskExecution["status"];
    activeOwnerId?: string | undefined;
    activeOwnerLabel?: string | undefined;
    stage?: string | undefined;
    message?: string | undefined;
  },
): MissionTaskExecution {
  const current = taskExecutions.get(taskId);
  const next: MissionTaskExecution = {
    runId: input.runId,
    connectorId: input.connectorId,
    status: input.status,
    activeOwnerId: input.activeOwnerId ?? current?.activeOwnerId,
    activeOwnerLabel: input.activeOwnerLabel ?? current?.activeOwnerLabel,
    stage: input.stage ?? current?.stage,
    message: input.message ?? current?.message,
    updatedAt: Date.now(),
  };
  taskExecutions.set(taskId, next);
  broadcastMissionSnapshot();
  return next;
}

function buildMissionSnapshot(): MissionControlSnapshot {
  return {
    connectors: Array.from(connectorInstances.values()).map(publicConnectorShape),
    hermesDefaults: publicHermesDefaultsShape(),
    teamSettings: { ...teamSettings },
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
      teamSettings: isMissionTeamSettings(parsed.teamSettings) ? parsed.teamSettings : undefined,
      taskExecutions: Array.isArray(parsed.taskExecutions) ? parsed.taskExecutions.filter(isPersistedTaskExecution) : [],
      events: Array.isArray(parsed.events) ? parsed.events.filter(isMissionTaskRunEvent) : [],
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.filter(isMissionTaskRunArtifact) : [],
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { connectors: [], teamSettings: {}, taskExecutions: [], events: [], artifacts: [] };
    }
    throw error;
  }
}

async function persistMissionControl(): Promise<void> {
  const payload: PersistedMissionControlFile = {
    connectors: Array.from(connectorInstances.values()).map(persistedConnectorShape),
    hermesDefaults: persistedHermesDefaultsShape(),
    teamSettings: { ...teamSettings },
    taskExecutions: Array.from(taskExecutions.entries())
      .map(([taskId, execution]) => ({ taskId, ...execution }))
      .sort((left, right) => right.updatedAt - left.updatedAt),
    events: [...taskRunEvents].sort((left, right) => right.createdAt - left.createdAt),
    artifacts: [...taskRunArtifacts].sort((left, right) => right.createdAt - left.createdAt),
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
  teamSettings = isMissionTeamSettings(persisted.teamSettings) ? { ...persisted.teamSettings } : {};

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

  taskExecutions.clear();
  for (const execution of persisted.taskExecutions ?? []) {
    taskExecutions.set(execution.taskId, {
      runId: execution.runId,
      connectorId: execution.connectorId,
      status: execution.status,
      activeOwnerId: execution.activeOwnerId,
      activeOwnerLabel: execution.activeOwnerLabel,
      stage: execution.stage,
      message: execution.message,
      updatedAt: execution.updatedAt,
    });
  }
  taskRunEvents = [...(persisted.events ?? [])].sort((left, right) => right.createdAt - left.createdAt);
  taskRunArtifacts = [...(persisted.artifacts ?? [])].sort((left, right) => right.createdAt - left.createdAt);
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

  if (current.enabled !== next.enabled) {
    next.health = {
      ...next.health,
      checkedAt: Date.now(),
      status: next.enabled ? "idle" : "disabled",
      message: next.enabled ? `Connector enabled. Test ${next.label} to confirm it is reachable.` : "Connector disabled.",
    };
  }

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

function officeAgentIdForLink(connectorId: string, externalId: string): string | undefined {
  return linkedOfficeAgent(connectorId, externalId);
}

function resolveBootstrapParentId(
  requestedParentId: string | null | undefined,
  idRemap: Map<string, string>,
): string | null | undefined {
  if (requestedParentId === undefined) {
    return undefined;
  }
  if (requestedParentId === null) {
    return null;
  }
  const normalized = requestedParentId.trim();
  if (!normalized) {
    return null;
  }
  return idRemap.get(normalized) ?? normalized;
}

function existingAgentForBootstrap(input: MissionTeamBootstrapAgentInput): AgentRuntimeState | undefined {
  const explicit = agentStates.get(input.officeAgentId.trim());
  if (explicit) {
    return explicit;
  }

  const linkedId = officeAgentIdForLink(input.connectorId, input.externalId);
  return linkedId ? agentStates.get(linkedId) : undefined;
}

function bootstrapScopeConnectorIds(entries: MissionTeamBootstrapAgentInput[]): Set<string> {
  const connectorIds = new Set<string>();
  entries.forEach((entry) => {
    const connectorId = entry.connectorId.trim();
    if (connectorId) {
      connectorIds.add(connectorId);
    }
  });

  if (connectorIds.size > 0) {
    return connectorIds;
  }

  agentStates.forEach((state) => {
    const connectorId = state.backendLink?.connectorId?.trim();
    if (connectorId) {
      connectorIds.add(connectorId);
    }
  });

  return connectorIds;
}

function removeBootstrappedAgents(scopeConnectorIds: Set<string>, retainedAgentIds: Set<string>): void {
  if (scopeConnectorIds.size === 0) {
    return;
  }

  const removedAgentIds: string[] = [];
  agentStates.forEach((state, agentId) => {
    const connectorId = state.backendLink?.connectorId?.trim();
    if (!connectorId || !scopeConnectorIds.has(connectorId) || retainedAgentIds.has(agentId)) {
      return;
    }

    agentStates.delete(agentId);
    residentDeskAssignments.delete(agentId);
    agentAppearances.delete(agentId);
    removedAgentIds.push(agentId);
  });

  if (removedAgentIds.length === 0) {
    return;
  }

  agentStates.forEach((state, agentId) => {
    if (state.parentAgentId && removedAgentIds.includes(state.parentAgentId)) {
      agentStates.set(agentId, {
        ...state,
        parentAgentId: undefined,
      });
    }
  });

  removedAgentIds.forEach((agentId) => {
    broadcast?.({ type: "agent-removed", agentId });
  });
}

async function upsertBootstrapAgent(
  input: MissionTeamBootstrapAgentInput,
  idRemap: Map<string, string>,
): Promise<AgentRuntimeState> {
  const connector = connectorInstances.get(input.connectorId);
  if (!connector) {
    throw new RequestBodyError(`Unknown connector ${input.connectorId}.`, 404);
  }

  const existing = existingAgentForBootstrap(input);
  const resolvedId = existing?.id ?? input.officeAgentId.trim();
  const registration: AgentRegistration = {
    id: resolvedId,
    name: input.name.trim(),
    role: input.role.trim(),
    emoji: input.emoji?.trim() || undefined,
    type: input.type ?? existing?.type ?? "resident",
    backendLink: {
      provider: CONNECTOR_PROVIDER_TO_BACKEND_PROVIDER[connector.provider],
      connectorId: connector.id,
      agentId: input.externalId.trim(),
      connected: true,
      connectedAt: Date.now(),
    },
    parentAgentId: resolveBootstrapParentId(input.parentOfficeAgentId, idRemap),
  };

  const nextState = await upsertRegistration(registration, existing ? "update" : "create");
  idRemap.set(input.officeAgentId.trim(), nextState.id);
  return nextState;
}

export async function bootstrapMissionTeam(input: MissionTeamBootstrapRequest): Promise<MissionTeamBootstrapResult> {
  const trimmedAgents = input.agents
    .map((entry) => ({
      ...entry,
      officeAgentId: entry.officeAgentId.trim(),
      connectorId: entry.connectorId.trim(),
      externalId: entry.externalId.trim(),
      name: entry.name.trim(),
      role: entry.role.trim(),
      emoji: entry.emoji?.trim() || undefined,
    }))
    .filter((entry) => entry.officeAgentId && entry.connectorId && entry.externalId && entry.name && entry.role);

  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  trimmedAgents.forEach((entry) => {
    if (seenIds.has(entry.officeAgentId)) {
      duplicateIds.add(entry.officeAgentId);
    }
    seenIds.add(entry.officeAgentId);
  });
  if (duplicateIds.size > 0) {
    throw new RequestBodyError(`Duplicate office agent ids: ${Array.from(duplicateIds).join(", ")}`);
  }

  const scopeConnectorIds = bootstrapScopeConnectorIds(trimmedAgents);
  const idRemap = new Map<string, string>();
  trimmedAgents.forEach((entry) => {
    const existing = existingAgentForBootstrap(entry);
    idRemap.set(entry.officeAgentId, existing?.id ?? entry.officeAgentId);
  });
  const touchedConnectors = new Set<string>();
  for (const entry of trimmedAgents) {
    const nextState = await upsertBootstrapAgent(entry, idRemap);
    touchedConnectors.add(entry.connectorId);
    idRemap.set(entry.officeAgentId, nextState.id);
  }
  removeBootstrappedAgents(scopeConnectorIds, new Set(idRemap.values()));
  if (scopeConnectorIds.size > 0) {
    await queuePersistAgents();
  }

  const requestedCommandAgentId = input.commandAgentId?.trim() || "";
  const resolvedCommandAgentId = requestedCommandAgentId
    ? (idRemap.get(requestedCommandAgentId) ?? requestedCommandAgentId)
    : undefined;
  const commandAgent = resolvedCommandAgentId ? agentStates.get(resolvedCommandAgentId) : undefined;
  const requestedDefaultConnectorId = input.defaultRunConnectorId?.trim() || "";

  teamSettings = {
    commandAgentId: commandAgent?.id,
    defaultRunConnectorId: trimmedAgents.length > 0
      ? (requestedDefaultConnectorId
      || commandAgent?.backendLink?.connectorId
      || undefined)
      : undefined,
  };

  const connectorsToRefresh = new Set<string>([...scopeConnectorIds, ...touchedConnectors]);
  connectorsToRefresh.forEach((connectorId) => {
    const currentProviderAgents = providerAgents.filter((entry) => entry.connectorId === connectorId);
    const connector = connectorInstances.get(connectorId);
    if (connector) {
      mergeProviderAgents(connectorId, connector.provider, currentProviderAgents);
    }
    syncConnectorOfficeAgents(connectorId, currentProviderAgents);
  });

  await queuePersistMissionControl();
  broadcastMissionSnapshot();

  return {
    agents: getOrderedStates(),
    snapshot: buildMissionSnapshot(),
  };
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
          status: connectorHasRunnableConfig(connector) ? "syncing" : "disabled",
          checkedAt: Date.now(),
          message: connectorHasRunnableConfig(connector) ? `Syncing ${connector.label}...` : "Connector disabled.",
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
    const snapshot = await syncLinearTasks();
    taskSnapshot = snapshot.tasks;
    const liveTaskIds = new Set(snapshot.tasks.map((task) => task.id));
    Array.from(taskExecutions.keys()).forEach((taskId) => {
      if (!liveTaskIds.has(taskId)) {
        taskExecutions.delete(taskId);
      }
    });
    taskRunEvents = taskRunEvents.filter((event) => liveTaskIds.has(event.taskId));
    taskRunArtifacts = taskRunArtifacts.filter((artifact) => liveTaskIds.has(artifact.taskId));
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
  const detail = await fetchLinearTaskDetail(taskId);
  return {
    ...detail,
    task: publicTaskShape(detail.task),
    events: taskEventsForTask(taskId),
    artifacts: taskArtifactsForTask(taskId),
  };
}

export async function updateMissionTask(taskId: string, input: MissionTaskUpdateRequest): Promise<MissionTask> {
  const task = await updateLinearTask(taskId, input);
  taskSnapshot = taskSnapshot
    .map((entry) => (entry.id === task.id ? publicTaskShape(task) : entry))
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

  const parentCommentId = input.parentCommentId?.trim() || undefined;
  await createLinearTaskComment(taskId, body, parentCommentId);
  const detail = await fetchLinearTaskDetail(taskId);
  taskSnapshot = taskSnapshot.map((entry) => (entry.id === detail.task.id ? publicTaskShape(detail.task) : entry));
  taskSync = {
    state: "ok",
    updatedAt: Date.now(),
    message: "Linear comment created.",
  };
  broadcastMissionSnapshot();
  return {
    ...detail,
    task: publicTaskShape(detail.task),
    events: taskEventsForTask(taskId),
    artifacts: taskArtifactsForTask(taskId),
  };
}

function adapterConfigForConnector(connectorId: string): Record<string, unknown> | null {
  const connector = connectorInstances.get(connectorId);
  if (!connector || !connectorHasRunnableConfig(connector)) return null;
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

function appendTaskRunEvents(taskId: string, runId: string, events: AdapterTaskRunEvent[] | MissionTaskRunEvent[]): void {
  const normalized = events.map((event) => ({
    id: "id" in event ? event.id : generateId(),
    taskId,
    runId,
    kind: event.kind,
    summary: event.summary,
    status: event.status,
    actorId: event.actorId,
    actorLabel: event.actorLabel,
    createdAt: event.createdAt ?? Date.now(),
  }));
  taskRunEvents = [...normalized, ...taskRunEvents].sort((left, right) => right.createdAt - left.createdAt);
}

function appendTaskRunArtifacts(taskId: string, runId: string, artifacts: AdapterTaskRunArtifact[] | MissionTaskRunArtifact[]): void {
  const normalized = artifacts.map((artifact) => ({
    id: "id" in artifact ? artifact.id : generateId(),
    taskId,
    runId,
    kind: artifact.kind,
    label: artifact.label,
    body: artifact.body,
    url: artifact.url,
    createdAt: artifact.createdAt ?? Date.now(),
  }));
  taskRunArtifacts = [...normalized, ...taskRunArtifacts].sort((left, right) => right.createdAt - left.createdAt);
}

function registerTaskRunSession(taskId: string, runId: string, connectorId: string, sessionId: string | undefined): void {
  const normalized = sessionId?.trim() ?? "";
  if (!normalized) {
    return;
  }
  taskRunSessions.set(normalized, { taskId, runId, connectorId });
  const sessions = taskRunIdsToSessions.get(runId) ?? new Set<string>();
  sessions.add(normalized);
  taskRunIdsToSessions.set(runId, sessions);
}

function clearTaskRunSessions(runId: string): void {
  const sessions = taskRunIdsToSessions.get(runId);
  if (!sessions) {
    return;
  }
  sessions.forEach((sessionId) => taskRunSessions.delete(sessionId));
  taskRunIdsToSessions.delete(runId);
}

function preferredRunConnector(): { connector: ProviderConnectorState; config: Record<string, unknown>; } {
  const preferredConnectorId = teamSettings.defaultRunConnectorId?.trim();
  if (preferredConnectorId) {
    const preferredConnector = connectorInstances.get(preferredConnectorId);
    const preferredAdapter = preferredConnector ? getAdapter(preferredConnector.provider as AdapterType) : null;
    const preferredConfig = preferredConnector ? adapterConfigForConnector(preferredConnector.id) : null;
    if (preferredConnector?.enabled && preferredAdapter?.startTaskRun && preferredConfig) {
      return { connector: preferredConnector, config: preferredConfig };
    }
  }

  const commandAgentId = teamSettings.commandAgentId?.trim();
  if (commandAgentId) {
    const commandAgent = agentStates.get(commandAgentId);
    const connectorId = commandAgent?.backendLink?.connectorId;
    if (connectorId) {
      const commandConnector = connectorInstances.get(connectorId);
      const commandAdapter = commandConnector ? getAdapter(commandConnector.provider as AdapterType) : null;
      const commandConfig = commandConnector ? adapterConfigForConnector(commandConnector.id) : null;
      if (commandConnector?.enabled && commandAdapter?.startTaskRun && commandConfig) {
        return { connector: commandConnector, config: commandConfig };
      }
    }
  }

  const candidates = Array.from(connectorInstances.values())
    .filter((connector) => connector.enabled)
    .map((connector) => ({
      connector,
      adapter: getAdapter(connector.provider as AdapterType),
    }))
    .filter((entry) => Boolean(entry.adapter?.startTaskRun))
    .sort((left, right) => {
      if (left.connector.provider === right.connector.provider) {
        return left.connector.label.localeCompare(right.connector.label);
      }
      if (left.connector.provider === "hermes") {
        return -1;
      }
      if (right.connector.provider === "hermes") {
        return 1;
      }
      return left.connector.label.localeCompare(right.connector.label);
    });

  for (const entry of candidates) {
    const config = adapterConfigForConnector(entry.connector.id);
    if (config) {
      return { connector: entry.connector, config };
    }
  }

  throw new RequestBodyError("No enabled provider connector can start task runs.", 409);
}

function resolveExecutionOwner(connectorId: string, actorId: string | undefined, actorLabel: string | undefined): {
  activeOwnerId?: string;
  activeOwnerLabel?: string;
} {
  const normalizedActorId = actorId?.trim() ?? "";
  const providerAgent = normalizedActorId
    ? providerAgents.find((entry) => entry.connectorId === connectorId && providerExternalIdAliases(entry.externalId).has(normalizedActorId))
    : undefined;
  const officeAgentId = providerAgent?.officeAgentId ?? (normalizedActorId ? linkedOfficeAgent(connectorId, normalizedActorId) : undefined);

  const resolvedOwnerId = officeAgentId ?? (normalizedActorId || undefined);
  const resolvedOwnerLabel = providerAgent?.name ?? (actorLabel?.trim() || undefined);
  return {
    ...(resolvedOwnerId ? { activeOwnerId: resolvedOwnerId } : {}),
    ...(resolvedOwnerLabel ? { activeOwnerLabel: resolvedOwnerLabel } : {}),
  };
}

export function startMissionTaskRun(taskId: string): MissionTaskExecution {
  const task = taskSnapshot.find((entry) => entry.id === taskId);
  if (!task) {
    throw new RequestBodyError("Mission task not found.", 404);
  }

  if (runningTaskExecutions.has(taskId)) {
    throw new RequestBodyError("Task run is already in progress.", 409);
  }

  const { connector } = preferredRunConnector();
  const runId = generateId();
  const queuedExecution = upsertTaskExecution(taskId, {
    runId,
    connectorId: connector.id,
    status: "queued",
    stage: "Queued",
    message: `Submitted to ${connector.label}.`,
  });
  appendTaskRunEvents(taskId, runId, [{
    kind: "submitted",
    summary: `Submitted to ${connector.label}.`,
    status: "queued",
  }]);
  void queuePersistMissionControl();
  pushActivity("workflow-item", `${task.identifier}: submitted to ${connector.label}.`, connectorRuntimeAgentId(connector));

  const run = (async () => {
    try {
      const detail = await getMissionTaskDetail(taskId);
      const { connector: selectedConnector, config } = preferredRunConnector();
      const adapter = getAdapter(selectedConnector.provider as AdapterType);
      if (!adapter?.startTaskRun) {
        throw new RequestBodyError(`${selectedConnector.label} cannot start task runs.`, 409);
      }

      const result = await adapter.startTaskRun(config, {
        connectorId: selectedConnector.id,
        task: detail,
      });

      const finalRunId = result.runId?.trim() || runId;
      registerTaskRunSession(taskId, finalRunId, selectedConnector.id, result.sessionId);
      const owner = resolveExecutionOwner(selectedConnector.id, result.activeOwnerId, result.activeOwnerLabel);
      const execution = upsertTaskExecution(taskId, {
        runId: finalRunId,
        connectorId: selectedConnector.id,
        status: result.status,
        activeOwnerId: owner.activeOwnerId,
        activeOwnerLabel: owner.activeOwnerLabel,
        stage: result.stage,
        message: result.message,
      });
      appendTaskRunEvents(taskId, finalRunId, result.events ?? []);
      appendTaskRunArtifacts(taskId, finalRunId, result.artifacts ?? []);
      clearTaskRunSessions(finalRunId);
      void queuePersistMissionControl();
      const outcome = execution.status === "failed" ? "failed" : "completed";
      pushActivity(
        "workflow-item",
        `${task.identifier}: ${selectedConnector.label} ${outcome}${execution.message ? ` · ${execution.message}` : ""}`,
        owner.activeOwnerId ?? connectorRuntimeAgentId(selectedConnector),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider execution failure.";
      upsertTaskExecution(taskId, {
        runId,
        connectorId: connector.id,
        status: "failed",
        stage: "Failed",
        message,
      });
      appendTaskRunEvents(taskId, runId, [{
        kind: "failed",
        summary: message,
        status: "failed",
      }]);
      void queuePersistMissionControl();
      pushActivity("workflow-item", `${task.identifier}: provider run failed. ${message}`, connectorRuntimeAgentId(connector));
      console.error(`[mission-control] provider task run failed for ${taskId}:`, error);
    } finally {
      runningTaskExecutions.delete(taskId);
    }
  })();

  runningTaskExecutions.set(taskId, run);
  return queuedExecution;
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
  connector.health = {
    ...connector.health,
    checkedAt: Date.now(),
    status: "idle",
    message: `Connector added. Configure ${connector.label} and run Test.`,
  };
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
  if (teamSettings.defaultRunConnectorId === connectorId) {
    teamSettings = {
      ...teamSettings,
      defaultRunConnectorId: undefined,
    };
  }
  const commandAgent = teamSettings.commandAgentId ? agentStates.get(teamSettings.commandAgentId) : undefined;
  if (commandAgent?.backendLink?.connectorId === connectorId) {
    teamSettings = {
      ...teamSettings,
      commandAgentId: undefined,
    };
  }
  providerAgents = providerAgents.filter((a) => a.connectorId !== connectorId);
  schedules = schedules.filter((s) => s.connectorId !== connectorId);
  Array.from(taskExecutions.entries()).forEach(([taskId, execution]) => {
    if (execution.connectorId === connectorId) {
      taskExecutions.delete(taskId);
      clearTaskRunSessions(execution.runId);
    }
  });
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
    startHermesRemoteStatePolling(connectorId, sshHost);
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

function isMissionTeamSettings(value: unknown): value is MissionTeamSettings {
  return isRecord(value)
    && (value.commandAgentId === undefined || typeof value.commandAgentId === "string")
    && (value.defaultRunConnectorId === undefined || typeof value.defaultRunConnectorId === "string");
}

function isMissionTeamBootstrapAgentInput(value: unknown): value is MissionTeamBootstrapAgentInput {
  return isRecord(value)
    && typeof value.officeAgentId === "string"
    && typeof value.connectorId === "string"
    && typeof value.externalId === "string"
    && typeof value.name === "string"
    && typeof value.role === "string"
    && (value.emoji === undefined || typeof value.emoji === "string")
    && (value.type === undefined || value.type === "resident" || value.type === "visitor")
    && (value.parentOfficeAgentId === undefined || value.parentOfficeAgentId === null || typeof value.parentOfficeAgentId === "string");
}

export function isMissionTeamBootstrapRequest(value: unknown): value is MissionTeamBootstrapRequest {
  return isRecord(value)
    && Array.isArray(value.agents)
    && value.agents.every((entry) => isMissionTeamBootstrapAgentInput(entry))
    && (value.commandAgentId === undefined || typeof value.commandAgentId === "string")
    && (value.defaultRunConnectorId === undefined || typeof value.defaultRunConnectorId === "string");
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
  return isRecord(value)
    && typeof value.body === "string"
    && (value.parentCommentId === undefined || typeof value.parentCommentId === "string");
}
