import type { ActivityLogEntry, AgentRuntimeState, ServerMessage } from "../src/types";
import { MAX_LOG_ENTRIES } from "./types";
import { generateId } from "./utils";

export const activityLog: ActivityLogEntry[] = [];

let broadcast: ((message: ServerMessage) => void) | null = null;

export function configureActivityBroadcast(callback: (message: ServerMessage) => void): void {
  broadcast = callback;
}

export function pushActivity(kind: ActivityLogEntry["kind"], message: string, agentId?: string): ActivityLogEntry {
  const entry: ActivityLogEntry = {
    id: generateId(),
    timestamp: Date.now(),
    kind,
    message,
    agentId,
  };
  activityLog.unshift(entry);
  activityLog.splice(MAX_LOG_ENTRIES);
  broadcast?.({
    type: "activity-log",
    entry,
  });
  return entry;
}

export function pushAgentMessageActivity(
  kind: Extract<ActivityLogEntry["kind"], "agent-message" | "meeting-turn">,
  state: AgentRuntimeState,
  message?: string,
): ActivityLogEntry | undefined {
  const trimmed = message?.trim();
  if (!trimmed) {
    return undefined;
  }
  return pushActivity(kind, `${state.name}: ${trimmed}`, state.id);
}
