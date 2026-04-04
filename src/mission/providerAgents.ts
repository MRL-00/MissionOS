import type { ProviderAgentActivityStatus, ProviderAgentRecord } from "./types";

const EXECUTING_PROVIDER_AGENT_STATUSES = new Set<ProviderAgentActivityStatus>([
  "building",
  "reviewing",
  "spec-writing",
]);

function humanizeStatus(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function formatProviderAgentStatus(agent: Pick<ProviderAgentRecord, "status" | "activityStatus">): string {
  return humanizeStatus(agent.activityStatus ?? agent.status);
}

export function hasProviderAgentActivity(agent: Pick<ProviderAgentRecord, "status" | "activityStatus">): boolean {
  if (agent.activityStatus) {
    return agent.activityStatus !== "idle";
  }
  return agent.status === "working";
}

export function isProviderAgentActivelyExecuting(agent: Pick<ProviderAgentRecord, "status" | "activityStatus">): boolean {
  if (agent.activityStatus) {
    return EXECUTING_PROVIDER_AGENT_STATUSES.has(agent.activityStatus);
  }
  return agent.status === "working";
}
