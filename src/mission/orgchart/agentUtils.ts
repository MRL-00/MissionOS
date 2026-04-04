import type { AgentRuntimeState } from "../../types";
import { formatProviderAgentStatus } from "../providerAgents";
import type { ProviderAgentActivityStatus, ProviderAgentRecord } from "../types";

interface ProviderNodeTheme {
  dotClass: string;
  nodeClass: string;
}

const PROVIDER_NODE_THEMES: Record<ProviderAgentActivityStatus, ProviderNodeTheme> = {
  idle: {
    dotClass: "org-chart__status-dot--idle",
    nodeClass: "org-chart__node--provider-idle",
  },
  building: {
    dotClass: "org-chart__status-dot--building",
    nodeClass: "org-chart__node--provider-building",
  },
  reviewing: {
    dotClass: "org-chart__status-dot--reviewing",
    nodeClass: "org-chart__node--provider-reviewing",
  },
  "spec-writing": {
    dotClass: "org-chart__status-dot--spec-writing",
    nodeClass: "org-chart__node--provider-spec-writing",
  },
  "pr-opened": {
    dotClass: "org-chart__status-dot--pr-opened",
    nodeClass: "org-chart__node--provider-pr-opened",
  },
  approved: {
    dotClass: "org-chart__status-dot--approved",
    nodeClass: "org-chart__node--provider-approved",
  },
  rejected: {
    dotClass: "org-chart__status-dot--rejected",
    nodeClass: "org-chart__node--provider-rejected",
  },
};

const GENERIC_WORKING_THEME: ProviderNodeTheme = {
  dotClass: "org-chart__status-dot--working",
  nodeClass: "org-chart__node--provider-working",
};

export function formatStatus(status: AgentRuntimeState["status"], connected: boolean): string {
  if (!connected) {
    return "offline";
  }

  switch (status) {
    case "meeting":
      return "in meeting";
    case "entering":
      return "arriving";
    case "leaving":
      return "leaving";
    default:
      return status;
  }
}

export function statusColor(agent: AgentRuntimeState): string {
  if (!agent.connected) {
    return "#7d8a9c";
  }

  switch (agent.status) {
    case "working":
      return "#ffcf5c";
    case "meeting":
      return "#72a8ff";
    case "entering":
      return "#78f1c7";
    case "leaving":
      return "#ff8f7b";
    default:
      return "#d7f3b7";
  }
}

export function statusLabel(status: AgentRuntimeState["status"]): string {
  switch (status) {
    case "working":
      return "Working";
    case "meeting":
      return "In Meeting";
    case "idle":
      return "Idle";
    default:
      return status;
  }
}

export function providerNodeTheme(providerAgent?: ProviderAgentRecord | null): ProviderNodeTheme | null {
  if (!providerAgent) {
    return null;
  }
  if (providerAgent.activityStatus) {
    return PROVIDER_NODE_THEMES[providerAgent.activityStatus];
  }
  if (providerAgent.status === "working") {
    return GENERIC_WORKING_THEME;
  }
  return null;
}

export function agentNodeStatus(agent: AgentRuntimeState, providerAgent?: ProviderAgentRecord | null): string {
  if (providerAgent) {
    return formatProviderAgentStatus(providerAgent);
  }
  return formatStatus(agent.status, agent.connected);
}

export function agentNodeTitle(agent: AgentRuntimeState, providerAgent?: ProviderAgentRecord | null): string {
  const details = [`${agent.name} (${agent.role})`, `Status: ${agentNodeStatus(agent, providerAgent)}`];

  if (providerAgent?.currentTicket) {
    details.push(`Ticket: ${providerAgent.currentTicket}`);
  }
  if (providerAgent?.taskStage) {
    details.push(`Stage: ${providerAgent.taskStage}`);
  }
  if (providerAgent?.lastActivityAt) {
    details.push(`Since: ${providerAgent.lastActivityAt}`);
  }

  return details.join("\n");
}

export function providerLabel(provider: string | undefined): string {
  switch (provider) {
    case "hermes":
      return "Hermes";
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    default:
      return "Unlinked";
  }
}
