import type {
  MissionTaskDetail,
  MissionTaskExecutionStatus,
  MissionTaskRunArtifactKind,
  MissionTaskRunEventKind,
  ProviderAgentRecord,
  ProviderHealth,
  ProviderScheduleEntry,
} from "../../src/mission/types";

export type AdapterType = "hermes" | "claude-local" | "codex-local";

export interface AdapterConfigField {
  key: string;
  label: string;
  type: "text" | "url" | "password" | "number" | "boolean";
  placeholder?: string;
  hint?: string;
  required?: boolean;
  colSpan?: 1 | 2;
}

export interface AdapterTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface AdapterMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  agentName?: string;
  finishReason?: string;
}

export interface AdapterTaskRunEvent {
  kind: MissionTaskRunEventKind;
  summary: string;
  status?: MissionTaskExecutionStatus;
  actorId?: string;
  actorLabel?: string;
  createdAt?: number;
}

export interface AdapterTaskRunArtifact {
  kind: MissionTaskRunArtifactKind;
  label: string;
  body?: string;
  url?: string;
  createdAt?: number;
}

export interface AdapterTaskRunRequest {
  connectorId: string;
  task: MissionTaskDetail;
}

export interface AdapterTaskRunResult {
  runId: string;
  status: MissionTaskExecutionStatus;
  activeOwnerId?: string;
  activeOwnerLabel?: string;
  stage?: string;
  message?: string;
  sessionId?: string;
  events?: AdapterTaskRunEvent[];
  artifacts?: AdapterTaskRunArtifact[];
}

export interface AdapterModule {
  type: AdapterType;
  label: string;
  configFields(): AdapterConfigField[];
  defaultConfig(): Record<string, unknown>;
  testConnection(config: Record<string, unknown>): Promise<AdapterTestResult>;
  syncAgents(config: Record<string, unknown>): Promise<ProviderAgentRecord[]>;
  syncOrg?(config: Record<string, unknown>): Promise<ProviderAgentRecord[]>;
  syncSchedules?(config: Record<string, unknown>): Promise<ProviderScheduleEntry[]>;
  startTaskRun?(config: Record<string, unknown>, request: AdapterTaskRunRequest): Promise<AdapterTaskRunResult>;
  fetchMessages?(config: Record<string, unknown>, externalAgentId: string): Promise<AdapterMessage[]>;
  sendMessage?(config: Record<string, unknown>, externalAgentId: string, message: string): Promise<AdapterMessage | null>;
}

export type { ProviderAgentRecord, ProviderHealth, ProviderScheduleEntry };
