export type MissionProvider = "hermes" | "claude-local" | "codex-local";
export type ProviderAgentActivityStatus =
  | "idle"
  | "building"
  | "reviewing"
  | "spec-writing"
  | "pr-opened"
  | "approved"
  | "rejected";

export interface AdapterConfigField {
  key: string;
  label: string;
  type: "text" | "url" | "password" | "number" | "boolean";
  placeholder?: string;
  hint?: string;
  required?: boolean;
  colSpan?: 1 | 2;
}
export type MissionHealthStatus = "idle" | "syncing" | "ok" | "error" | "disabled";
export type MissionScheduleStatus = "scheduled" | "running" | "paused" | "error" | "unknown";
export type MissionSyncState = "idle" | "syncing" | "ok" | "error";
export type MissionHandoffStatus = "pending" | "accepted" | "declined";

export interface MissionProviderCapabilities {
  agents: boolean;
  schedules: boolean;
  activeWork: boolean;
  launch: boolean;
  subscribe: boolean;
}

export interface ProviderHealth {
  provider: MissionProvider;
  status: MissionHealthStatus;
  checkedAt: number;
  latencyMs?: number | undefined;
  message?: string | undefined;
  activeAgents: number;
  schedules: number;
}

export interface ProviderConnector {
  id: string;
  provider: MissionProvider;
  label: string;
  enabled: boolean;
  baseUrl?: string | undefined;
  websocketUrl?: string | undefined;
  runtimeBaseUrl?: string | undefined;
  authMode: "none" | "bearer";
  tokenConfigured: boolean;
  capabilities: MissionProviderCapabilities;
  health: ProviderHealth;
  lastSyncAt?: number | undefined;
  adapterConfig?: Record<string, unknown> | undefined;
  configFields?: AdapterConfigField[] | undefined;
  useHermesDefaults?: boolean | undefined;
}

export interface ProviderConnectorUpdateRequest {
  enabled?: boolean | undefined;
  baseUrl?: string | undefined;
  websocketUrl?: string | undefined;
  runtimeBaseUrl?: string | undefined;
  authMode?: "none" | "bearer" | undefined;
  token?: string | undefined;
  adapterConfig?: Record<string, unknown> | undefined;
  useHermesDefaults?: boolean | undefined;
}

export interface HermesDefaults {
  sshHost?: string | undefined;
  runtimeHost?: string | undefined;
  tokenConfigured: boolean;
}

export interface HermesDefaultsUpdateRequest {
  sshHost?: string | undefined;
  runtimeHost?: string | undefined;
  token?: string | undefined;
}

export interface ProviderAgentRecord {
  connectorId: string;
  provider: MissionProvider;
  externalId: string;
  name: string;
  role?: string | undefined;
  officeAgentId?: string | undefined;
  status: "online" | "offline" | "working" | "idle" | "unknown";
  activityStatus?: ProviderAgentActivityStatus | null;
  currentTicket?: string | null;
  taskStage?: string | null;
  lastActivityAt?: string | null;
  task?: string | undefined;
  lastSeenAt?: number | undefined;
  runtimeBaseUrl?: string | undefined;
  imported: boolean;
}

export interface ProviderScheduleEntry {
  connectorId: string;
  id: string;
  provider: MissionProvider;
  name: string;
  recurrence: string;
  nextRunAt?: number | undefined;
  lastRunAt?: number | undefined;
  targetAgentExternalId?: string | undefined;
  targetAgentId?: string | undefined;
  targetLabel?: string | undefined;
  status: MissionScheduleStatus;
  sourceUrl?: string | undefined;
}

export interface MissionTaskStatus {
  id?: string | undefined;
  name: string;
  type?: string | undefined;
  color?: string | undefined;
}

export interface MissionTaskAssignee {
  id: string;
  name: string;
  avatarUrl?: string | undefined;
  officeAgentId?: string | undefined;
}

export interface MissionTaskLabel {
  id: string;
  name: string;
  color?: string | undefined;
}

export interface MissionTaskProject {
  id: string;
  name: string;
}

export interface MissionTaskCycle {
  id: string;
  name: string;
  number?: number | undefined;
}

export type MissionTaskAutomationStatus =
  | "idle"
  | "running"
  | "needs_info"
  | "in_review"
  | "completed"
  | "failed";

export interface MissionTaskAutomation {
  runId: string;
  status: MissionTaskAutomationStatus;
  ownerAgentName?: string | undefined;
  route?: "ios" | "fullstack" | undefined;
  step?: string | undefined;
  message?: string | undefined;
  updatedAt: number;
}

export interface MissionTask {
  id: string;
  identifier: string;
  title: string;
  description?: string | undefined;
  gitBranchName?: string | undefined;
  pullRequestUrls?: string[] | undefined;
  url?: string | undefined;
  priority: number;
  state: MissionTaskStatus;
  team: {
    id?: string | undefined;
    key?: string | undefined;
    name: string;
  };
  project?: MissionTaskProject | undefined;
  cycle?: MissionTaskCycle | undefined;
  assignee?: MissionTaskAssignee | undefined;
  labels: MissionTaskLabel[];
  dueDate?: string | undefined;
  createdAt: number;
  updatedAt: number;
  handoffCount: number;
  commentCount: number;
  automation?: MissionTaskAutomation | undefined;
}

export interface MissionTaskComment {
  id: string;
  taskId: string;
  body: string;
  authorName: string;
  authorId?: string | undefined;
  parentCommentId?: string | undefined;
  createdAt: number;
  source: "linear" | "office";
}

export interface MissionTaskHandoff {
  id: string;
  taskId: string;
  fromAgentId?: string | undefined;
  fromAgentName: string;
  toAgentId?: string | undefined;
  toAgentName: string;
  note: string;
  status: MissionHandoffStatus;
  createdAt: number;
  respondedAt?: number | undefined;
}

export interface MissionTaskDetail {
  task: MissionTask;
  comments: MissionTaskComment[];
  handoffs: MissionTaskHandoff[];
}

export interface MissionTaskSnapshot {
  tasks: MissionTask[];
  syncedAt: number;
  syncState: MissionSyncState;
  error?: string | undefined;
  message?: string | undefined;
}

export interface MissionSyncStatus {
  state: MissionSyncState;
  updatedAt: number;
  message?: string | undefined;
}

export interface MissionRosterImportStatus {
  imported: number;
  linked: number;
  staged: number;
  updatedAt: number;
}

export interface MissionControlSnapshot {
  connectors: ProviderConnector[];
  hermesDefaults: HermesDefaults;
  providerAgents: ProviderAgentRecord[];
  schedules: ProviderScheduleEntry[];
  tasks: MissionTask[];
  rosterImport: MissionRosterImportStatus;
  taskSync: MissionSyncStatus;
  syncedAt: number;
}

export interface MissionTaskUpdateRequest {
  title?: string | undefined;
  description?: string | undefined;
  stateId?: string | undefined;
  stateName?: string | undefined;
  assigneeId?: string | null | undefined;
  priority?: number | undefined;
  dueDate?: string | null | undefined;
}

export interface MissionTaskCommentCreateRequest {
  body: string;
  parentCommentId?: string | undefined;
}

export interface MissionTaskHandoffCreateRequest {
  fromAgentId?: string | undefined;
  fromAgentName?: string | undefined;
  toAgentId?: string | undefined;
  toAgentName?: string | undefined;
  note: string;
}

export interface MissionTaskHandoffResponseRequest {
  status: Extract<MissionHandoffStatus, "accepted" | "declined">;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number | undefined;
  agentName?: string | undefined;
}

export interface MissionTaskMutationResult {
  ok: boolean;
  task?: MissionTask | undefined;
  error?: string | undefined;
}
