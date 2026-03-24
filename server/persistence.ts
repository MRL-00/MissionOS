import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRuntimeState } from "../src/types";
import { ensureDataDir } from "./auth/storage";
import {
  agentAppearances,
  agentStates,
  getAvailableDeskIndex,
  getOrderedStates,
  isAgentAppearance,
  isBackendLink,
  isRegistration,
  normalizeBackendLink,
  residentDeskAssignments,
  resolveAppearance,
} from "./agents";
import { getKnownDeskIndex } from "../src/agentDefaults";
import { agentsFilePath, dataDir, type PersistedAgentRecord, type PersistedAgentsFile } from "./types";

export async function readPersistedAgents(): Promise<PersistedAgentsFile> {
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

export function toPersistedRecord(state: AgentRuntimeState): PersistedAgentRecord {
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

export async function persistAgents(): Promise<void> {
  const payload: PersistedAgentsFile = {
    agents: getOrderedStates().map((state) => toPersistedRecord(state)),
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const tempPath = path.join(dataDir, `agents.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  await ensureDataDir();
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, agentsFilePath);
}

export let persistAgentsQueue: Promise<void> = Promise.resolve();

export function queuePersistAgents(): Promise<void> {
  const runPersist = async () => {
    await persistAgents();
  };
  const pending = persistAgentsQueue.then(runPersist, runPersist);
  persistAgentsQueue = pending.catch(() => undefined);
  return pending;
}

export function applyPersistedAgent(record: PersistedAgentRecord): void {
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

export async function loadPersistedAgents(): Promise<void> {
  const persisted = await readPersistedAgents();
  persisted.agents.forEach((record) => {
    if (isRegistration(record) && isAgentAppearance(record.appearance) && isBackendLink(record.backendLink) && typeof record.emoji === "string") {
      applyPersistedAgent(record as PersistedAgentRecord);
    }
  });
}
