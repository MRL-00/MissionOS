import { getApiBase } from "../config/api";
import type { AgentRuntimeState } from "../types";
import type {
  MissionControlSnapshot,
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

export async function respondMissionTaskHandoff(handoffId: string, input: MissionTaskHandoffResponseRequest): Promise<MissionTaskHandoff> {
  const payload = await requestJson<{ handoff: MissionTaskHandoff }>(`/api/mission/handoffs/${encodeURIComponent(handoffId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return payload.handoff;
}

export async function updateMissionConnector(provider: ProviderConnector["provider"], input: ProviderConnectorUpdateRequest): Promise<ProviderConnector> {
  const payload = await requestJson<{ connector: ProviderConnector }>(`/api/mission/connectors/${encodeURIComponent(provider)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return payload.connector;
}

export async function testMissionConnector(provider: ProviderConnector["provider"]): Promise<ProviderConnector> {
  const payload = await requestJson<{ connector: ProviderConnector }>(`/api/mission/connectors/${encodeURIComponent(provider)}/test`, {
    method: "POST",
  });
  return payload.connector;
}

export async function syncMissionConnector(provider: ProviderConnector["provider"]): Promise<ProviderConnector> {
  const payload = await requestJson<{ connector: ProviderConnector }>(`/api/mission/connectors/${encodeURIComponent(provider)}/sync`, {
    method: "POST",
  });
  return payload.connector;
}
