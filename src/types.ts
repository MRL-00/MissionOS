import type { MissionControlSnapshot } from "./mission/types";

export type HeadShape = "round" | "oval" | "square";
export type HairStyle = "none" | "short" | "long" | "mohawk" | "messy" | "slicked" | "buzz" | "curly";
export type Accessory = "glasses" | "hat" | "tie" | "beard";
export type AgentBackendProvider = "hermes" | "claude" | "codex" | "unlinked";
export type AgentStatus = "idle" | "working" | "in-meeting";
export type RealtimeAgentStatus = "idle" | "working" | "meeting" | "entering" | "leaving";
export type AgentEventLocation = "desk" | "meeting-room" | "door" | "cio-office";
export type MeetingType = "standup" | "strategy" | "review";
export type MeetingSpeed = 1 | 2 | 3;
export type WorkflowStatus = "backlog" | "todo" | "in_progress" | "blocked" | "in_review" | "qa" | "merged_ready" | "done" | "canceled";
export type WorkflowEventKind =
  | "item-created"
  | "item-updated"
  | "status-changed"
  | "ownership-changed"
  | "handoff-requested"
  | "handoff-accepted"
  | "handoff-declined"
  | "comment-added"
  | "qa-triggered";
export type WorkflowActorRole = "pickle" | "engineer" | "reviewer" | "qa" | "observer";
export type WorkflowCommentTarget = "office" | "linear";
export type WorkflowHandoffStatus = "pending" | "accepted" | "declined";
export type WorkflowQaStatus = "idle" | "queued" | "running" | "passed" | "failed" | "skipped";

export interface AgentAppearance {
  height?: number;
  headShape: HeadShape;
  skinColor: string;
  hairStyle: HairStyle;
  hairColor: string;
  bodyColor: string;
  pantsColor: string;
  accessories?: Accessory[];
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  emoji: string;
  appearance: AgentAppearance;
}

export interface AgentRuntimeTarget {
  baseUrl: string;
  launchProfile?: string | undefined;
}

export interface AgentBackendLink {
  provider: AgentBackendProvider;
  connectorId?: string | undefined;
  agentId?: string | undefined;
  connected: boolean;
  tokenId?: string | undefined;
  connectedAt?: number | undefined;
  runtimeTarget?: AgentRuntimeTarget | undefined;
}

export interface AgentEvent {
  agentId: string;
  status: RealtimeAgentStatus;
  task?: string | undefined;
  message?: string | undefined;
  location?: AgentEventLocation | undefined;
  timestamp: number;
}

export interface AgentSpawnRequest {
  agentId: string;
  task: string;
  message?: string | undefined;
}

export interface AgentCompleteRequest {
  agentId: string;
  result?: string | undefined;
  message?: string | undefined;
}

export interface AgentRegistration {
  id: string;
  name: string;
  role: string;
  emoji?: string | undefined;
  appearance?: AgentAppearance | undefined;
  type?: "resident" | "visitor" | undefined;
  deskIndex?: number | undefined;
  backendLink?: AgentBackendLink | undefined;
  parentAgentId?: string | null | undefined;
}

export interface AgentRuntimeState extends AgentRegistration {
  connected: boolean;
  status: RealtimeAgentStatus;
  task?: string | undefined;
  message?: string | undefined;
  location?: AgentEventLocation | undefined;
  timestamp: number;
}

export interface AgentSnapshotState extends AgentRuntimeState {
  appearance: AgentAppearance;
}

export interface MeetingRequest {
  agentIds: string[];
}

export interface MeetingConfig {
  type: MeetingType;
  topic?: string | undefined;
  participants: string[];
  facilitatorId: string;
  presenter?: string | undefined;
}

export interface MeetingTurn {
  agentId: string;
  message: string;
  timestamp: number;
}

export interface MeetingScript {
  config: MeetingConfig;
  turns: MeetingTurn[];
  summary: string;
}

export interface MeetingRunRequest {
  script: MeetingScript;
  speed?: MeetingSpeed | undefined;
}

export interface MeetingState {
  active: boolean;
  config?: MeetingConfig | undefined;
  transcript: MeetingTurn[];
  summary?: string | undefined;
  currentSpeakerId?: string | undefined;
  progress: {
    currentTurn: number;
    totalTurns: number;
  };
  startedAt?: number | undefined;
  speed: MeetingSpeed;
  stopped: boolean;
}

export interface WorkflowActor {
  agentId: string;
  name: string;
  role: WorkflowActorRole;
}

export interface WorkflowLinearRef {
  issueId: string;
  issueKey: string;
  url?: string | undefined;
  projectId?: string | undefined;
}

export interface WorkflowGithubRef {
  repository?: string | undefined;
  branch?: string | undefined;
  pullRequestNumber?: number | undefined;
  pullRequestUrl?: string | undefined;
  headSha?: string | undefined;
  mergedAt?: number | undefined;
}

export interface WorkflowOwnership {
  ownerAgentId?: string | undefined;
  reviewerAgentId?: string | undefined;
  qaAgentId?: string | undefined;
}

export interface WorkflowQaState {
  status: WorkflowQaStatus;
  lastTriggeredAt?: number | undefined;
  lastTriggerReason?: string | undefined;
  lastTriggeredBy?: WorkflowActor | undefined;
}

export interface WorkflowItem {
  id: string;
  sprintId: string;
  title: string;
  summary?: string | undefined;
  status: WorkflowStatus;
  linear: WorkflowLinearRef;
  github: WorkflowGithubRef;
  ownership: WorkflowOwnership;
  qa: WorkflowQaState;
  createdAt: number;
  updatedAt: number;
  lastEventAt: number;
}

export interface WorkflowEventRecord {
  id: string;
  itemId: string;
  sprintId: string;
  kind: WorkflowEventKind;
  actor: WorkflowActor;
  timestamp: number;
  message: string;
  fromStatus?: WorkflowStatus | undefined;
  toStatus?: WorkflowStatus | undefined;
  metadata?: Record<string, string | number | boolean> | undefined;
}

export interface WorkflowHandoff {
  id: string;
  itemId: string;
  sprintId: string;
  from: WorkflowActor;
  to: WorkflowActor;
  status: WorkflowHandoffStatus;
  summary: string;
  checklist: string[];
  createdAt: number;
  respondedAt?: number | undefined;
}

export interface WorkflowComment {
  id: string;
  itemId: string;
  sprintId: string;
  actor: WorkflowActor;
  target: WorkflowCommentTarget;
  body: string;
  createdAt: number;
}

export interface WorkflowQaTrigger {
  id: string;
  itemId: string;
  sprintId: string;
  status: Exclude<WorkflowQaStatus, "idle">;
  reason: string;
  auto: boolean;
  triggeredBy: WorkflowActor;
  createdAt: number;
}

export interface WorkflowSnapshot {
  currentSprintId: string;
  items: WorkflowItem[];
  events: WorkflowEventRecord[];
  handoffs: WorkflowHandoff[];
  comments: WorkflowComment[];
  qaTriggers: WorkflowQaTrigger[];
}

export interface WorkflowItemCreateRequest {
  id: string;
  sprintId: string;
  title: string;
  summary?: string | undefined;
  status?: WorkflowStatus | undefined;
  linear: WorkflowLinearRef;
  github?: WorkflowGithubRef | undefined;
  ownership?: WorkflowOwnership | undefined;
  actor: WorkflowActor;
}

export interface WorkflowItemUpdateRequest {
  sprintId?: string | undefined;
  title?: string | undefined;
  summary?: string | undefined;
  status?: WorkflowStatus | undefined;
  github?: WorkflowGithubRef | undefined;
  ownership?: WorkflowOwnership | undefined;
  actor: WorkflowActor;
}

export interface WorkflowEventCreateRequest {
  actor: WorkflowActor;
  kind: WorkflowEventKind;
  message: string;
  fromStatus?: WorkflowStatus | undefined;
  toStatus?: WorkflowStatus | undefined;
  metadata?: Record<string, string | number | boolean> | undefined;
}

export interface WorkflowHandoffCreateRequest {
  from: WorkflowActor;
  to: WorkflowActor;
  summary: string;
  checklist?: string[] | undefined;
}

export interface WorkflowHandoffResponseRequest {
  actor: WorkflowActor;
  status: Extract<WorkflowHandoffStatus, "accepted" | "declined">;
}

export interface WorkflowCommentCreateRequest {
  actor: WorkflowActor;
  target: WorkflowCommentTarget;
  body: string;
}

export interface WorkflowQaTriggerRequest {
  actor: WorkflowActor;
  reason: string;
  auto?: boolean | undefined;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  kind:
    | "agent-status"
    | "agent-message"
    | "agent-spawn"
    | "agent-complete"
    | "meeting-start"
    | "meeting-turn"
    | "meeting-end"
    | "meeting-stop"
    | "registration"
    | "workflow-item"
    | "workflow-handoff"
    | "workflow-comment"
    | "workflow-qa";
  message: string;
  agentId?: string | undefined;
}

export type ServerMessage =
  | {
      type: "agent-event";
      event: AgentEvent;
    }
  | {
      type: "agents-snapshot";
      agents: AgentSnapshotState[];
    }
  | {
      type: "agent-removed";
      agentId: string;
    }
  | {
      type: "agent-registered";
      agent: AgentRuntimeState & { appearance?: AgentAppearance | undefined };
    }
  | {
      type: "meeting-start";
      config: MeetingConfig;
      participants: string[];
      startedAt: number;
      totalTurns: number;
      speed: MeetingSpeed;
    }
  | {
      type: "meeting-turn";
      agentId: string;
      message: string;
      turnIndex: number;
      totalTurns: number;
      timestamp: number;
      isTyping?: boolean | undefined;
    }
  | {
      type: "meeting-end";
      summary: string;
      transcript: MeetingTurn[];
      endedAt: number;
    }
  | {
      type: "meeting-status";
      state: MeetingState;
    }
  | {
      type: "activity-log";
      entry: ActivityLogEntry;
    }
  | {
      type: "workflow-snapshot";
      snapshot: WorkflowSnapshot;
    }
  | {
      type: "workflow-item-updated";
      item: WorkflowItem;
    }
  | {
      type: "workflow-event";
      event: WorkflowEventRecord;
    }
  | {
      type: "mission-snapshot";
      snapshot: MissionControlSnapshot;
    };
