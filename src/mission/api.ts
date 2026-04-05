import { getApiBase } from "../config/api";
import type {
  AgentMessageRecord,
  AgentRecord,
  AuthUser,
  BootstrapState,
  DocFileRecord,
  EngineConnectionResult,
  EngineDefinition,
  IssueCommentRecord,
  IssueRecord,
  MissionRecord,
  ProjectRecord,
  RelationshipRecord,
  RunRecord,
  ScheduleRecord,
  SearchResults,
} from "./appTypes";

export const AUTH_TOKEN_STORAGE_KEY = "missionos.jwt";

async function requestJson<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const text = await response.text().catch(() => "");
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "Request failed")
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export function getStoredAuthToken(): string | null {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function getBootstrap(): Promise<BootstrapState> {
  return requestJson<BootstrapState>("/api/bootstrap");
}

export function registerAccount(input: { username: string; password: string; displayName: string }) {
  return requestJson<{ token: string; user: AuthUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function loginAccount(input: { username: string; password: string }) {
  return requestJson<{ token: string; user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchCurrentUser(token: string) {
  return requestJson<{ user: AuthUser }>("/api/auth/me", undefined, token);
}

export function updateProfile(token: string, input: { displayName: string; avatarEmoji: string }) {
  return requestJson<{ user: AuthUser }>("/api/auth/profile", {
    method: "PUT",
    body: JSON.stringify(input),
  }, token);
}

export function changePassword(token: string, input: { currentPassword: string; newPassword: string }) {
  return requestJson<{ ok: boolean }>("/api/auth/password", {
    method: "PUT",
    body: JSON.stringify(input),
  }, token);
}

export function fetchProject(token: string) {
  return requestJson<{ project: ProjectRecord | null }>("/api/project", undefined, token);
}

export function createProject(token: string, input: { name: string; description: string }) {
  return requestJson<{ project: ProjectRecord }>("/api/project", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export function resetProject(token: string) {
  return requestJson<{ ok: boolean; bootstrap: BootstrapState }>("/api/project", {
    method: "DELETE",
  }, token);
}

export function fetchEngines(token: string) {
  return requestJson<{ engines: EngineDefinition[] }>("/api/engines", undefined, token);
}

export function testEngineConnection(token: string, engineId: string, config: Record<string, unknown>) {
  return requestJson<EngineConnectionResult>(
    `/api/engines/${encodeURIComponent(engineId)}/test`,
    {
      method: "POST",
      body: JSON.stringify({ config }),
    },
    token,
  );
}

export function fetchAgents(token: string) {
  return requestJson<{ agents: AgentRecord[] }>("/api/agents", undefined, token);
}

export function createAgent(token: string, input: Record<string, unknown>) {
  return requestJson<{ agent: AgentRecord }>("/api/agents", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export function updateAgent(token: string, agentId: string, input: Record<string, unknown>) {
  return requestJson<{ agent: AgentRecord }>(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }, token);
}

export function deleteAgent(token: string, agentId: string) {
  return requestJson<{ ok: boolean }>(`/api/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" }, token);
}

export function testAgentConnection(token: string, agentId: string) {
  return requestJson<{ ok: boolean; message: string; latency_ms: number }>(
    `/api/agents/${encodeURIComponent(agentId)}/test`,
    { method: "POST" },
    token,
  );
}

export function fetchRelationships(token: string) {
  return requestJson<{ relationships: RelationshipRecord[] }>("/api/relationships", undefined, token);
}

export function createRelationship(token: string, input: { parent_id: string; child_id: string }) {
  return requestJson<{ relationship: RelationshipRecord }>("/api/relationships", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export function deleteRelationship(token: string, relationshipId: string) {
  return requestJson<{ ok: boolean }>(`/api/relationships/${encodeURIComponent(relationshipId)}`, {
    method: "DELETE",
  }, token);
}

export function savePositions(token: string, positions: Array<{ agent_id: string; x: number; y: number }>) {
  return requestJson<{ ok: boolean }>("/api/positions", {
    method: "PUT",
    body: JSON.stringify(positions),
  }, token);
}

export function fetchMissions(token: string) {
  return requestJson<{ missions: MissionRecord[] }>("/api/missions", undefined, token);
}

export function createMission(token: string, input: Record<string, unknown>) {
  return requestJson<{ mission: MissionRecord }>("/api/missions", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export function updateMission(token: string, missionId: string, input: Record<string, unknown>) {
  return requestJson<{ mission: MissionRecord }>(`/api/missions/${encodeURIComponent(missionId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }, token);
}

export function deleteMission(token: string, missionId: string) {
  return requestJson<{ ok: boolean }>(`/api/missions/${encodeURIComponent(missionId)}`, {
    method: "DELETE",
  }, token);
}

export function assignMissionAgent(token: string, missionId: string, agentId: string) {
  return requestJson<{ ok: boolean }>(`/api/missions/${encodeURIComponent(missionId)}/agents`, {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
  }, token);
}

export function removeMissionAgent(token: string, missionId: string, agentId: string) {
  return requestJson<{ ok: boolean }>(`/api/missions/${encodeURIComponent(missionId)}/agents/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  }, token);
}

export function startMission(token: string, missionId: string) {
  return requestJson<{ ok: boolean; runId: string }>(`/api/missions/${encodeURIComponent(missionId)}/start`, {
    method: "POST",
  }, token);
}

export function fetchIssues(token: string, params?: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) {
      search.set(key, value);
    }
  });
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<{ issues: IssueRecord[] }>(`/api/issues${suffix}`, undefined, token);
}

export function createIssue(token: string, input: Record<string, unknown>) {
  return requestJson<{ issue: IssueRecord }>("/api/issues", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export function updateIssue(token: string, issueId: string, input: Record<string, unknown>) {
  return requestJson<{ issue: IssueRecord }>(`/api/issues/${encodeURIComponent(issueId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }, token);
}

export function deleteIssue(token: string, issueId: string) {
  return requestJson<{ ok: boolean }>(`/api/issues/${encodeURIComponent(issueId)}`, {
    method: "DELETE",
  }, token);
}

export function fetchIssueComments(token: string, issueId: string) {
  return requestJson<{ comments: IssueCommentRecord[] }>(`/api/issues/${encodeURIComponent(issueId)}/comments`, undefined, token);
}

export function createIssueComment(token: string, issueId: string, input: { body: string; parentId?: string }) {
  return requestJson<{ comment: IssueCommentRecord }>(`/api/issues/${encodeURIComponent(issueId)}/comments`, {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export function syncLinearIssues(token: string) {
  return requestJson<{ ok: boolean; issues: IssueRecord[] }>("/api/issues/sync-linear", { method: "POST" }, token);
}

export function fetchRuns(token: string, params?: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) {
      search.set(key, value);
    }
  });
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<{ runs: RunRecord[] }>(`/api/runs${suffix}`, undefined, token);
}

export function fetchSchedules(token: string) {
  return requestJson<{ schedules: ScheduleRecord[] }>("/api/schedules", undefined, token);
}

export function createSchedule(token: string, input: {
  name: string;
  agent_id: string;
  prompt: string;
  cron_expression: string;
  enabled: boolean;
  max_runs?: number | null;
}) {
  return requestJson<{ schedule: ScheduleRecord }>("/api/schedules", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export function updateSchedule(token: string, scheduleId: string, input: {
  name: string;
  agent_id: string;
  prompt: string;
  cron_expression: string;
  enabled: boolean;
  max_runs?: number | null;
}) {
  return requestJson<{ schedule: ScheduleRecord }>(`/api/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }, token);
}

export function deleteSchedule(token: string, scheduleId: string) {
  return requestJson<{ ok: boolean }>(`/api/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
  }, token);
}

export function runSchedule(token: string, scheduleId: string) {
  return requestJson<{ schedule: ScheduleRecord; run: RunRecord | null }>(`/api/schedules/${encodeURIComponent(scheduleId)}/run`, {
    method: "POST",
  }, token);
}

export function fetchRun(token: string, runId: string) {
  return requestJson<{ run: RunRecord }>(`/api/runs/${encodeURIComponent(runId)}`, undefined, token);
}

export function createRun(token: string, input: { agent_id: string; prompt: string; mission_id?: string; issue_id?: string }) {
  return requestJson<{ run: RunRecord }>("/api/runs", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export async function streamRun(
  token: string,
  runId: string,
  onEvent: (event: { type: string; output?: string; chunk?: string; message?: string; status?: string }) => void,
): Promise<void> {
  const response = await fetch(`${getApiBase()}/api/runs/${encodeURIComponent(runId)}/stream`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Stream failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((entry) => entry.startsWith("data:"));
      if (!line) {
        continue;
      }
      onEvent(JSON.parse(line.replace(/^data:\s*/u, "")) as { type: string; output?: string; chunk?: string; message?: string; status?: string });
    }
  }
}

export function fetchAgentMessages(token: string, missionId?: string) {
  const suffix = missionId ? `?mission_id=${encodeURIComponent(missionId)}` : "";
  return requestJson<{ messages: AgentMessageRecord[] }>(`/api/agent-messages${suffix}`, undefined, token);
}

export function createAgentMessage(token: string, input: Record<string, unknown>) {
  return requestJson<{ agent_message: AgentMessageRecord }>("/api/agent-messages", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export function fetchSettings(token: string) {
  return requestJson<{ settingsMap: Record<string, string> }>("/api/settings", undefined, token);
}

export function saveSettings(token: string, settings: Array<{ key: string; value: string }>) {
  return requestJson<{ ok: boolean; settingsMap: Record<string, string> }>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  }, token);
}

export function testLinearConnection(token: string) {
  return requestJson<{ ok: boolean; workspace: string }>("/api/linear/test", { method: "POST" }, token);
}

export function testGitHubConnection(token: string) {
  return requestJson<{ ok: boolean; username: string; message: string }>("/api/github/test", { method: "POST" }, token);
}

export function fetchGitHubRepos(token: string, query?: string) {
  const q = query ? `?q=${encodeURIComponent(query)}` : "";
  return requestJson<{ repos: Array<{ id: number; full_name: string; owner: string; name: string; default_branch: string; private: boolean; description: string | null }> }>(
    `/api/github/repos${q}`,
    undefined,
    token,
  );
}

export function syncGitHubIssues(token: string, missionId: string) {
  return requestJson<{ ok: boolean; synced: number; issues: IssueRecord[] }>(
    `/api/issues/sync-github?mission_id=${encodeURIComponent(missionId)}`,
    { method: "POST" },
    token,
  );
}

export function searchAll(token: string, q: string) {
  return requestJson<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`, undefined, token);
}

export function fetchDocsTree(token: string) {
  return requestJson<{ files: DocFileRecord[] }>("/api/docs/tree", undefined, token);
}

export function fetchDocContent(token: string, path: string) {
  return requestJson<{ path: string; content: string }>(`/api/docs/content?path=${encodeURIComponent(path)}`, undefined, token);
}

export function submitFeedback(token: string, input: { type: string; message: string }) {
  return requestJson<{ feedback: { id: string; type: string; message: string } }>("/api/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}
