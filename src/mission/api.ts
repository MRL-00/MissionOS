import { getApiBase } from "../config/api";
import type { ActivityLogEntry, AgentRegistration, AgentRuntimeState } from "../types";
import type {
  AgentMessage,
  HermesDefaults,
  HermesDefaultsUpdateRequest,
  MissionControlSnapshot,
  MissionTaskAutomation,
  MissionTaskCommentCreateRequest,
  MissionTaskDetail,
  MissionTaskHandoff,
  MissionTaskHandoffCreateRequest,
  MissionTaskHandoffResponseRequest,
  MissionTaskUpdateRequest,
  ProviderConnector,
  ProviderConnectorUpdateRequest,
} from "./types";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload
      ? String((payload as { error?: unknown }).error ?? "Request failed")
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function fetchAgents(): Promise<AgentRuntimeState[]> {
  const payload = await requestJson<{ agents: AgentRuntimeState[] }>("/api/agents");
  return payload.agents;
}

export async function fetchMissionSnapshot(): Promise<MissionControlSnapshot> {
  return requestJson<MissionControlSnapshot>("/api/mission");
}

export async function fetchMissionTaskDetail(taskId: string): Promise<MissionTaskDetail> {
  return requestJson<MissionTaskDetail>(`/api/mission/tasks/${encodeURIComponent(taskId)}`);
}

export async function updateMissionTask(taskId: string, input: MissionTaskUpdateRequest): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/mission/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function createMissionTaskComment(taskId: string, input: MissionTaskCommentCreateRequest): Promise<MissionTaskDetail> {
  return requestJson<MissionTaskDetail>(`/api/mission/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createMissionTaskHandoff(taskId: string, input: MissionTaskHandoffCreateRequest): Promise<MissionTaskHandoff> {
  const payload = await requestJson<{ handoff: MissionTaskHandoff }>(`/api/mission/tasks/${encodeURIComponent(taskId)}/handoffs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload.handoff;
}

export async function startMissionTaskWorkflow(taskId: string): Promise<MissionTaskAutomation> {
  const payload = await requestJson<{ ok: boolean; automation: MissionTaskAutomation }>(`/api/mission/tasks/${encodeURIComponent(taskId)}/run`, {
    method: "POST",
  });
  return payload.automation;
}

export async function respondMissionTaskHandoff(handoffId: string, input: MissionTaskHandoffResponseRequest): Promise<MissionTaskHandoff> {
  const payload = await requestJson<{ handoff: MissionTaskHandoff }>(`/api/mission/handoffs/${encodeURIComponent(handoffId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return payload.handoff;
}

export async function updateMissionConnector(connectorId: string, input: ProviderConnectorUpdateRequest): Promise<ProviderConnector> {
  const payload = await requestJson<{ connector: ProviderConnector }>(`/api/mission/connectors/${encodeURIComponent(connectorId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return payload.connector;
}

export async function updateHermesDefaults(input: HermesDefaultsUpdateRequest): Promise<HermesDefaults> {
  const payload = await requestJson<{ defaults: HermesDefaults }>("/api/mission/hermes-defaults", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return payload.defaults;
}

export async function testMissionConnector(connectorId: string): Promise<ProviderConnector> {
  const payload = await requestJson<{ connector: ProviderConnector }>(`/api/mission/connectors/${encodeURIComponent(connectorId)}/test`, {
    method: "POST",
  });
  return payload.connector;
}

export async function syncMissionConnector(connectorId: string): Promise<ProviderConnector> {
  const payload = await requestJson<{ connector: ProviderConnector }>(`/api/mission/connectors/${encodeURIComponent(connectorId)}/sync`, {
    method: "POST",
  });
  return payload.connector;
}

export async function createMissionConnector(provider: string, label?: string): Promise<ProviderConnector> {
  const payload = await requestJson<{ connector: ProviderConnector }>("/api/mission/connectors", {
    method: "POST",
    body: JSON.stringify({ provider, label }),
  });
  return payload.connector;
}

export async function deleteMissionConnector(connectorId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/mission/connectors/${encodeURIComponent(connectorId)}`, {
    method: "DELETE",
  });
}

export async function registerAgent(input: AgentRegistration): Promise<AgentRuntimeState> {
  return requestJson<AgentRuntimeState>("/api/agents/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAgent(agentId: string, input: Partial<AgentRegistration>): Promise<AgentRuntimeState> {
  return requestJson<AgentRuntimeState>(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteAgent(agentId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  });
}

export async function fetchActivityLog(): Promise<ActivityLogEntry[]> {
  const payload = await requestJson<{ entries: ActivityLogEntry[] }>("/api/activity");
  return payload.entries;
}

export async function fetchAgentMessages(agentId: string): Promise<AgentMessage[]> {
  const payload = await requestJson<{ messages: AgentMessage[] }>(`/api/agents/${encodeURIComponent(agentId)}/messages`);
  return payload.messages;
}

export async function sendAgentMessage(agentId: string, message: string): Promise<AgentMessage | null> {
  const payload = await requestJson<{ message: AgentMessage | null }>(`/api/agents/${encodeURIComponent(agentId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  return payload.message;
}
