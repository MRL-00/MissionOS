import type { AgentRuntimeState } from "../../types";

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

export function providerLabel(provider: string | undefined): string {
  switch (provider) {
    case "hermes":
      return "Hermes";
    case "openclaw":
      return "OpenClaw";
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    default:
      return "Unlinked";
  }
}
