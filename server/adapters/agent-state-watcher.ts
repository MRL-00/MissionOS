import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ProviderAgentActivityStatus,
  ProviderAgentRecord,
} from "../../src/mission/types";

const execFileAsync = promisify(execFile);

const DEFAULT_AGENT_IDS = ["hermes", "scout", "atlas", "orbit"] as const;
const VALID_ACTIVITY_STATUSES = new Set<ProviderAgentActivityStatus>([
  "idle",
  "building",
  "reviewing",
  "spec-writing",
  "pr-opened",
  "approved",
  "rejected",
]);

export const DEFAULT_HERMES_AGENT_STATE_FILE = process.env.HERMES_AGENT_STATE_FILE?.trim()
  || path.join(os.homedir(), ".hermes", "profiles", "agent-state.json");
export const DEFAULT_REMOTE_HERMES_AGENT_STATE_FILE = process.env.HERMES_REMOTE_AGENT_STATE_FILE?.trim()
  || "~/.hermes/profiles/agent-state.json";
export const HERMES_AGENT_STATE_STALE_MS = 60_000;
const REMOTE_AGENT_STATE_BEGIN = "__hermes_agent_state_begin__";
const REMOTE_AGENT_STATE_END = "__hermes_agent_state_end__";

interface RawAgentStateEntry {
  status?: unknown;
  ticket?: unknown;
  stage?: unknown;
  since?: unknown;
  role?: unknown;
  title?: unknown;
  teamId?: unknown;
  teamName?: unknown;
  managerExternalId?: unknown;
  reportsToExternalId?: unknown;
}

export interface HermesAgentStateSnapshot {
  agents: ProviderAgentRecord[];
  exists: boolean;
  empty: boolean;
  mtimeMs: number | null;
  path: string;
}

export interface AgentStateWatcherOptions {
  debounceMs?: number;
  filePath?: string;
  onError?(error: Error): void;
  onSnapshot(snapshot: HermesAgentStateSnapshot): void | Promise<void>;
}

export interface AgentStateWatcherHandle {
  getLastSnapshot(): HermesAgentStateSnapshot | null;
  start(): Promise<void>;
  stop(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function titleizeAgentId(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeActivityStatus(value: unknown): ProviderAgentActivityStatus {
  if (typeof value !== "string") {
    return "idle";
  }

  const normalized = value.trim().toLowerCase() as ProviderAgentActivityStatus;
  return VALID_ACTIVITY_STATUSES.has(normalized) ? normalized : "idle";
}

function normalizeStateStatus(
  value: unknown,
): { status: ProviderAgentRecord["status"]; activityStatus: ProviderAgentActivityStatus | null } {
  if (typeof value !== "string") {
    return { status: "idle", activityStatus: "idle" };
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "working") {
    return { status: "working", activityStatus: null };
  }
  if (normalized === "online") {
    return { status: "online", activityStatus: null };
  }
  if (normalized === "offline") {
    return { status: "offline", activityStatus: null };
  }
  if (normalized === "unknown") {
    return { status: "unknown", activityStatus: null };
  }

  const activityStatus = normalizeActivityStatus(normalized);
  return {
    status: mapActivityStatusToProviderStatus(activityStatus),
    activityStatus,
  };
}

function mapActivityStatusToProviderStatus(
  status: ProviderAgentActivityStatus,
): ProviderAgentRecord["status"] {
  switch (status) {
    case "building":
    case "reviewing":
    case "spec-writing":
      return "working";
    case "idle":
    case "pr-opened":
    case "approved":
    case "rejected":
      return "idle";
    default:
      return "unknown";
  }
}

function normalizeIsoString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function buildTaskSummary(ticket: string | null, stage: string | null, status: ProviderAgentActivityStatus | null): string | undefined {
  const parts = [ticket, stage].filter((part): part is string => Boolean(part));
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  return status && status !== "idle" ? status.replace(/-/g, " ") : undefined;
}

function createAgentRecord(agentId: string, entry?: RawAgentStateEntry): ProviderAgentRecord {
  const { status, activityStatus } = normalizeStateStatus(entry?.status);
  const currentTicket = typeof entry?.ticket === "string" && entry.ticket.trim()
    ? entry.ticket.trim()
    : null;
  const taskStage = typeof entry?.stage === "string" && entry.stage.trim()
    ? entry.stage.trim()
    : null;
  const lastActivityAt = normalizeIsoString(entry?.since);
  const lastSeenAt = lastActivityAt ? Date.parse(lastActivityAt) : undefined;

  return {
    connectorId: "",
    provider: "hermes",
    externalId: agentId,
    name: titleizeAgentId(agentId),
    role: typeof entry?.role === "string" && entry.role.trim() ? entry.role.trim() : undefined,
    title: typeof entry?.title === "string" && entry.title.trim() ? entry.title.trim() : undefined,
    teamId: typeof entry?.teamId === "string" && entry.teamId.trim() ? entry.teamId.trim() : undefined,
    teamName: typeof entry?.teamName === "string" && entry.teamName.trim() ? entry.teamName.trim() : undefined,
    managerExternalId: typeof entry?.managerExternalId === "string" && entry.managerExternalId.trim()
      ? entry.managerExternalId.trim()
      : undefined,
    reportsToExternalId: typeof entry?.reportsToExternalId === "string" && entry.reportsToExternalId.trim()
      ? entry.reportsToExternalId.trim()
      : undefined,
    status,
    ...(activityStatus !== null ? { activityStatus } : {}),
    currentTicket,
    taskStage,
    lastActivityAt,
    ...(buildTaskSummary(currentTicket, taskStage, activityStatus)
      ? { task: buildTaskSummary(currentTicket, taskStage, activityStatus) }
      : {}),
    ...(lastSeenAt !== undefined ? { lastSeenAt } : {}),
    imported: false,
  };
}

function normalizeAgentStatePayload(value: unknown): ProviderAgentRecord[] {
  const entries = new Map<string, ProviderAgentRecord>(
    DEFAULT_AGENT_IDS.map((agentId) => [agentId, createAgentRecord(agentId)]),
  );

  if (!isRecord(value)) {
    return Array.from(entries.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  Object.entries(value).forEach(([agentId, entry]) => {
    entries.set(agentId, createAgentRecord(agentId, isRecord(entry) ? entry as RawAgentStateEntry : undefined));
  });

  return Array.from(entries.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export async function readHermesAgentStateSnapshot(
  filePath = DEFAULT_HERMES_AGENT_STATE_FILE,
): Promise<HermesAgentStateSnapshot> {
  try {
    const fileStats = await stat(filePath);
    const raw = await readFile(filePath, "utf8");
    return parseHermesAgentStateSnapshot(raw, {
      exists: true,
      filePath,
      mtimeMs: fileStats.mtimeMs,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        agents: normalizeAgentStatePayload(null),
        empty: true,
        exists: false,
        mtimeMs: null,
        path: filePath,
      };
    }
    throw error;
  }
}

function parseHermesAgentStateSnapshot(
  raw: string,
  options: {
    exists: boolean;
    filePath: string;
    mtimeMs: number | null;
  },
): HermesAgentStateSnapshot {
  const trimmed = raw.trim();

  if (!trimmed) {
    return {
      agents: normalizeAgentStatePayload(null),
      empty: true,
      exists: options.exists,
      mtimeMs: options.mtimeMs,
      path: options.filePath,
    };
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("agent-state.json must contain an object keyed by agent id.");
  }

  return {
    agents: normalizeAgentStatePayload(parsed),
    empty: false,
    exists: options.exists,
    mtimeMs: options.mtimeMs,
    path: options.filePath,
  };
}

export async function readHermesAgentStateSnapshotOverSsh(
  sshHost: string,
  filePath = DEFAULT_REMOTE_HERMES_AGENT_STATE_FILE,
): Promise<HermesAgentStateSnapshot> {
  const trimmedPath = filePath.trim() || DEFAULT_REMOTE_HERMES_AGENT_STATE_FILE;
  const remotePathExpression = trimmedPath.startsWith("~/")
    ? `"$HOME/${trimmedPath.slice(2).replace(/(["\\$`])/g, "\\$1")}"`
    : trimmedPath === "~"
      ? '"$HOME"'
      : `'${trimmedPath.replace(/'/g, "'\\''")}'`;
  const remoteCommand = [
    "set -e",
    `file=${remotePathExpression}`,
    'if [ ! -f "$file" ]; then exit 3; fi',
    `printf "${REMOTE_AGENT_STATE_BEGIN}%s\\n" "$(( $(stat -c %Y "$file") * 1000 ))"`,
    'cat "$file"',
    `printf "\\n${REMOTE_AGENT_STATE_END}\\n"`,
  ].join("; ");

  try {
    const { stdout } = await execFileAsync("ssh", [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=5",
      sshHost,
      "sh",
      "-c",
      remoteCommand,
    ], {
      env: process.env,
      timeout: 5_000,
    });

    const beginIndex = stdout.indexOf(REMOTE_AGENT_STATE_BEGIN);
    const endIndex = stdout.indexOf(REMOTE_AGENT_STATE_END, beginIndex >= 0 ? beginIndex : 0);
    if (beginIndex < 0 || endIndex < 0 || endIndex <= beginIndex) {
      throw new Error(`Remote Hermes state output was missing sentinels: ${stdout.slice(0, 160)}`);
    }

    const payload = stdout.slice(beginIndex + REMOTE_AGENT_STATE_BEGIN.length, endIndex);
    const newlineIndex = payload.indexOf("\n");
    const mtimeValue = (newlineIndex >= 0 ? payload.slice(0, newlineIndex) : payload).trim();
    const raw = newlineIndex >= 0 ? payload.slice(newlineIndex + 1) : "";
    const mtimeMs = /^\d+$/.test(mtimeValue) ? parseInt(mtimeValue, 10) : Date.now();

    return parseHermesAgentStateSnapshot(raw, {
      exists: true,
      filePath: trimmedPath,
      mtimeMs,
    });
  } catch (error) {
    const err = error as {
      code?: string | number;
      stderr?: Buffer | string;
      stdout?: Buffer | string;
      message?: string;
    };
    const stderr = String(err.stderr ?? err.message ?? "");
    const stdout = String(err.stdout ?? "");

    if (stderr.includes("No such file") || stdout.includes("No such file") || err.code === 3) {
      return {
        agents: normalizeAgentStatePayload(null),
        empty: true,
        exists: false,
        mtimeMs: null,
        path: trimmedPath,
      };
    }

    throw error;
  }
}

export function isHermesAgentStateFresh(
  snapshot: Pick<HermesAgentStateSnapshot, "mtimeMs">,
  now = Date.now(),
): boolean {
  return snapshot.mtimeMs !== null && now - snapshot.mtimeMs <= HERMES_AGENT_STATE_STALE_MS;
}

export function createAgentStateWatcher(options: AgentStateWatcherOptions): AgentStateWatcherHandle {
  const debounceMs = options.debounceMs ?? 200;
  const rewatchDelayMs = Math.max(debounceMs, 1_000);
  const filePath = options.filePath ?? DEFAULT_HERMES_AGENT_STATE_FILE;
  const parentDir = path.dirname(filePath);
  const fileName = path.basename(filePath);

  let fileWatcher: FSWatcher | null = null;
  let directoryWatcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  let started = false;
  let lastSnapshot: HermesAgentStateSnapshot | null = null;

  function clearTimer(timer: NodeJS.Timeout | null): null {
    if (timer) {
      clearTimeout(timer);
    }
    return null;
  }

  function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  async function emitSnapshot(): Promise<void> {
    try {
      const snapshot = await readHermesAgentStateSnapshot(filePath);
      lastSnapshot = snapshot;
      await options.onSnapshot(snapshot);
    } catch (error) {
      options.onError?.(toError(error));
    }
  }

  function scheduleRefresh(): void {
    if (stopped) {
      return;
    }
    debounceTimer = clearTimer(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void emitSnapshot();
    }, debounceMs);
    debounceTimer.unref?.();
  }

  function closeFileWatcher(): void {
    fileWatcher?.close();
    fileWatcher = null;
  }

  function closeDirectoryWatcher(): void {
    directoryWatcher?.close();
    directoryWatcher = null;
  }

  function scheduleRewatch(): void {
    if (stopped || restartTimer) {
      return;
    }
    restartTimer = setTimeout(() => {
      restartTimer = null;
      establishWatchers();
      scheduleRefresh();
    }, rewatchDelayMs);
    restartTimer.unref?.();
  }

  function handleWatchError(error: unknown): void {
    const err = toError(error);
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      options.onError?.(err);
    }
    closeFileWatcher();
    scheduleRewatch();
  }

  function establishFileWatcher(): void {
    closeFileWatcher();

    try {
      fileWatcher = watch(filePath, { persistent: false }, () => {
        scheduleRefresh();
      });
      fileWatcher.on("error", handleWatchError);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        options.onError?.(toError(error));
      }
      scheduleRewatch();
    }
  }

  function establishDirectoryWatcher(): void {
    closeDirectoryWatcher();

    try {
      directoryWatcher = watch(parentDir, { persistent: false }, (_eventType, changedFile) => {
        if (changedFile && changedFile.toString() !== fileName) {
          return;
        }
        establishFileWatcher();
        scheduleRefresh();
      });
      directoryWatcher.on("error", handleWatchError);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        options.onError?.(toError(error));
      }
      scheduleRewatch();
    }
  }

  function establishWatchers(): void {
    if (stopped) {
      return;
    }
    establishDirectoryWatcher();
    establishFileWatcher();
  }

  return {
    getLastSnapshot(): HermesAgentStateSnapshot | null {
      return lastSnapshot;
    },
    async start(): Promise<void> {
      if (started) {
        return;
      }
      started = true;
      stopped = false;
      await emitSnapshot();
      establishWatchers();
    },
    stop(): void {
      stopped = true;
      started = false;
      debounceTimer = clearTimer(debounceTimer);
      restartTimer = clearTimer(restartTimer);
      closeFileWatcher();
      closeDirectoryWatcher();
    },
  };
}
