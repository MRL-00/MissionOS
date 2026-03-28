import { useEffect, useEffectEvent, useState } from "react";
import { OfficeWebSocketClient } from "../../network/websocket";
import type { AgentEvent, AgentRuntimeState, AgentSnapshotState, ServerMessage } from "../../types";
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
} from "../types";
import {
  createMissionTaskComment,
  createMissionTaskHandoff,
  fetchAgents,
  fetchMissionSnapshot,
  fetchMissionTaskDetail,
  respondMissionTaskHandoff,
  syncMissionConnector,
  testMissionConnector,
  updateMissionConnector,
  updateMissionTask,
} from "../api";

export type MissionView = "mission" | "tasks" | "schedules" | "settings";
type ConnectionState = "connecting" | "connected" | "offline";

const EMPTY_SNAPSHOT: MissionControlSnapshot = {
  connectors: [],
  providerAgents: [],
  schedules: [],
  tasks: [],
  rosterImport: {
    imported: 0,
    linked: 0,
    staged: 0,
    updatedAt: Date.now(),
  },
  taskSync: {
    state: "idle",
    updatedAt: Date.now(),
    message: "Waiting for mission sync.",
  },
  syncedAt: Date.now(),
};

function sortAgents(agents: AgentRuntimeState[]): AgentRuntimeState[] {
  return [...agents].sort((left, right) => left.name.localeCompare(right.name));
}

function mergeAgentState(previous: AgentRuntimeState[], next: AgentRuntimeState): AgentRuntimeState[] {
  const matchIndex = previous.findIndex((agent) => agent.id === next.id);
  if (matchIndex === -1) {
    return sortAgents([...previous, next]);
  }

  const merged = [...previous];
  merged[matchIndex] = {
    ...merged[matchIndex],
    ...next,
  };
  return sortAgents(merged);
}

function applyAgentEvent(previous: AgentRuntimeState[], event: AgentEvent): AgentRuntimeState[] {
  const existing = previous.find((agent) => agent.id === event.agentId);
  if (!existing) {
    return previous;
  }

  const next: AgentRuntimeState = {
    ...existing,
    status: event.status,
    timestamp: event.timestamp,
    location: event.location ?? existing.location,
    task: event.task ?? existing.task,
    message: event.message ?? existing.message,
  };
  return mergeAgentState(previous, next);
}

export function useMissionControl() {
  const [activeView, setActiveView] = useState<MissionView>("mission");
  const [agents, setAgents] = useState<AgentRuntimeState[]>([]);
  const [missionSnapshot, setMissionSnapshot] = useState<MissionControlSnapshot>(EMPTY_SNAPSHOT);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<MissionTaskDetail | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = useEffectEvent(async () => {
    setLoading(true);
    try {
      const [nextAgents, nextMission] = await Promise.all([fetchAgents(), fetchMissionSnapshot()]);
      setAgents(sortAgents(nextAgents));
      setMissionSnapshot(nextMission);
      setError(null);
      if (!selectedTaskId && nextMission.tasks[0]) {
        setSelectedTaskId(nextMission.tasks[0].id);
      }
      if (!selectedAgentId && nextAgents[0]) {
        setSelectedAgentId(nextAgents[0].id);
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load mission control.");
    } finally {
      setLoading(false);
    }
  });

  const hydrateTaskDetail = useEffectEvent(async (taskId: string) => {
    try {
      const detail = await fetchMissionTaskDetail(taskId);
      setSelectedTaskDetail(detail);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load task detail.");
    }
  });

  const applyServerMessage = useEffectEvent((message: ServerMessage) => {
    if (message.type === "mission-snapshot") {
      setMissionSnapshot(message.snapshot);
      return;
    }

    if (message.type === "agent-registered") {
      const { appearance: _appearance, ...agent } = message.agent;
      setAgents((current) => mergeAgentState(current, agent));
      return;
    }

    if (message.type === "agent-event") {
      setAgents((current) => applyAgentEvent(current, message.event));
      return;
    }

    if (message.type === "agents-snapshot") {
      setAgents(sortAgents(message.agents));
      return;
    }

    if (message.type === "agent-removed") {
      setAgents((current) => current.filter((agent) => agent.id !== message.agentId));
    }
  });

  useEffect(() => {
    void hydrate();

    const client = new OfficeWebSocketClient({
      onOpen: () => setConnectionState("connected"),
      onClose: () => setConnectionState("offline"),
      onEvent: (event) => setAgents((current) => applyAgentEvent(current, event)),
      onSnapshot: (message) => setAgents(sortAgents(message.agents)),
      onAgentRemoved: (agentId) => setAgents((current) => current.filter((agent) => agent.id !== agentId)),
      onServerMessage: applyServerMessage,
    });
    client.connect();

    return () => {
      client.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTaskDetail(null);
      return;
    }
    void hydrateTaskDetail(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    if (selectedTaskId && !missionSnapshot.tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(missionSnapshot.tasks[0]?.id ?? null);
    }
  }, [missionSnapshot.tasks, selectedTaskId]);

  useEffect(() => {
    if (selectedAgentId && !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(agents[0]?.id ?? null);
    }
  }, [agents, selectedAgentId]);

  async function runBusyAction<T>(key: string, operation: () => Promise<T>): Promise<T | null> {
    setBusyKey(key);
    setError(null);
    try {
      return await operation();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Mission control action failed.");
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  async function saveTaskUpdate(taskId: string, input: MissionTaskUpdateRequest): Promise<void> {
    const updated = await runBusyAction(`task:${taskId}:update`, async () => {
      await updateMissionTask(taskId, input);
      const [nextMission, detail] = await Promise.all([
        fetchMissionSnapshot(),
        fetchMissionTaskDetail(taskId),
      ]);
      setMissionSnapshot(nextMission);
      setSelectedTaskDetail(detail);
    });
    void updated;
  }

  async function addComment(taskId: string, input: MissionTaskCommentCreateRequest): Promise<void> {
    const detail = await runBusyAction(`task:${taskId}:comment`, () => createMissionTaskComment(taskId, input));
    if (detail) {
      setSelectedTaskDetail(detail);
      const nextMission = await fetchMissionSnapshot();
      setMissionSnapshot(nextMission);
    }
  }

  async function createHandoff(taskId: string, input: MissionTaskHandoffCreateRequest): Promise<MissionTaskHandoff | null> {
    const handoff = await runBusyAction(`task:${taskId}:handoff`, () => createMissionTaskHandoff(taskId, input));
    if (handoff) {
      const [nextMission, detail] = await Promise.all([
        fetchMissionSnapshot(),
        fetchMissionTaskDetail(taskId),
      ]);
      setMissionSnapshot(nextMission);
      setSelectedTaskDetail(detail);
    }
    return handoff;
  }

  async function respondToHandoff(handoffId: string, input: MissionTaskHandoffResponseRequest, taskId: string): Promise<void> {
    const updated = await runBusyAction(`handoff:${handoffId}`, () => respondMissionTaskHandoff(handoffId, input));
    if (updated) {
      const [nextMission, detail] = await Promise.all([
        fetchMissionSnapshot(),
        fetchMissionTaskDetail(taskId),
      ]);
      setMissionSnapshot(nextMission);
      setSelectedTaskDetail(detail);
    }
  }

  async function saveConnector(provider: ProviderConnector["provider"], input: ProviderConnectorUpdateRequest): Promise<void> {
    const connector = await runBusyAction(`connector:${provider}:save`, () => updateMissionConnector(provider, input));
    if (connector) {
      setMissionSnapshot((current) => ({
        ...current,
        connectors: current.connectors.map((entry) => (entry.provider === provider ? connector : entry)),
      }));
      const nextMission = await fetchMissionSnapshot();
      setMissionSnapshot(nextMission);
    }
  }

  async function syncConnector(provider: ProviderConnector["provider"]): Promise<void> {
    const connector = await runBusyAction(`connector:${provider}:sync`, () => syncMissionConnector(provider));
    if (connector) {
      const nextMission = await fetchMissionSnapshot();
      setMissionSnapshot(nextMission);
    }
  }

  async function testConnectorHealth(provider: ProviderConnector["provider"]): Promise<void> {
    const connector = await runBusyAction(`connector:${provider}:test`, () => testMissionConnector(provider));
    if (connector) {
      setMissionSnapshot((current) => ({
        ...current,
        connectors: current.connectors.map((entry) => (entry.provider === provider ? connector : entry)),
      }));
    }
  }

  async function refreshMission(): Promise<void> {
    await runBusyAction("mission:refresh", hydrate);
  }

  return {
    activeView,
    setActiveView,
    agents,
    missionSnapshot,
    selectedAgentId,
    setSelectedAgentId,
    selectedTaskId,
    setSelectedTaskId,
    selectedTaskDetail,
    connectionState,
    busyKey,
    error,
    loading,
    refreshMission,
    saveTaskUpdate,
    addComment,
    createHandoff,
    respondToHandoff,
    saveConnector,
    syncConnector,
    testConnectorHealth,
  };
}
