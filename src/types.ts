import type * as THREE from "three";
import type { MissionControlSnapshot } from "./mission/types";

export type HeadShape = "round" | "oval" | "square";
export type HairStyle = "none" | "short" | "long" | "mohawk" | "messy" | "slicked" | "buzz" | "curly";
export type Accessory = "glasses" | "hat" | "tie" | "beard";
export type AgentBackendProvider = "openclaw" | "hermes" | "claude" | "codex" | "unlinked";
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
  agentId?: string | undefined;
  connected: boolean;
  tokenId?: string | undefined;
  connectedAt?: number | undefined;
  runtimeTarget?: AgentRuntimeTarget | undefined;
}

export interface AgentParts {
  bodyPivot: THREE.Group;
  headPivot: THREE.Group;
  legs: {
    leftLeg: THREE.Object3D;
    rightLeg: THREE.Object3D;
  };
  arms: {
    leftArm: THREE.Object3D;
    rightArm: THREE.Object3D;
  };
  body: THREE.Mesh;
}

export interface BuiltAgent {
  id: string;
  name: string;
  role: string;
  emoji: string;
  mesh: THREE.Group;
  parts: AgentParts;
}

export interface LabelState {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  message?: string | undefined;
  worldPosition: THREE.Vector3;
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

export interface NavigationNode {
  position: THREE.Vector3;
  links: string[];
}

export type NavigationGraph = Record<string, NavigationNode>;

export interface DeskSlot {
  nodeId: string;
  approach: THREE.Vector3;
  sit: THREE.Vector3;
  facing: number;
  assignedTo?: string;
}

export interface DestinationWaypoint {
  nodeId: string;
  facing: number;
  seated?: boolean;
  position?: THREE.Vector3;
  approach?: THREE.Vector3;
  sit?: THREE.Vector3;
}

export interface OfficeWaypoints {
  entrance: DestinationWaypoint & { position: THREE.Vector3 };
  reception: DestinationWaypoint & { position: THREE.Vector3 };
  kitchen: DestinationWaypoint & { position: THREE.Vector3 };
  cioOffice: DestinationWaypoint & { position: THREE.Vector3 };
  bullpen: THREE.Vector3[];
  deskSlots: DeskSlot[];
  meetingSeats: Array<DestinationWaypoint & { position: THREE.Vector3 }>;
  navigation: NavigationGraph;
}

export type SceneUpdater = (delta: number, elapsed: number) => void;

export type LayoutItemKind =
  | "box"
  | "glassWall"
  | "desk"
  | "meetingTable"
  | "plant"
  | "whiteboard"
  | "kanbanBoard"
  | "poster"
  | "abstractArt"
  | "waterCooler"
  | "kitchenCounter"
  | "bungyDeck";

export interface LayoutDeskSlotBinding {
  assignedTo?: string | undefined;
  chairSide?: -1 | 1 | undefined;
  connectToNode?: string | undefined;
}

export interface LayoutItemConfig {
  id: string;
  label: string;
  kind: LayoutItemKind;
  position: [number, number, number];
  rotationY?: number | undefined;
  scale?: [number, number, number] | undefined;
  removable?: boolean | undefined;
  size?: [number, number, number] | undefined;
  color?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  depth?: number | undefined;
  accent?: string | undefined;
  chairSide?: -1 | 1 | undefined;
  executive?: boolean | undefined;
  plantHeight?: number | undefined;
  posterLabel?: string | undefined;
  posterAccent?: string | undefined;
  artAccent?: string | undefined;
  artStripe?: string | undefined;
  glassColor?: string | undefined;
  deskSlot?: LayoutDeskSlotBinding | undefined;
}

export interface OfficeLayoutConfig {
  version: number;
  items: LayoutItemConfig[];
}

export interface LayoutCatalogItem {
  templateId: string;
  label: string;
  description: string;
  kind: LayoutItemKind;
}

export interface LayoutItemSummary {
  id: string;
  label: string;
  kind: LayoutItemKind;
  removable: boolean;
}

export interface LayoutSelectionState {
  id: string;
  label: string;
  kind: LayoutItemKind;
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
  removable: boolean;
}

export interface OfficeLayoutController {
  getCatalog(): LayoutCatalogItem[];
  getItems(): LayoutItemSummary[];
  getSelection(id: string | null): LayoutSelectionState | null;
  getObjectForItem(id: string): THREE.Object3D | null;
  getItemIdFromObject(object: THREE.Object3D | null): string | null;
  updateItemTransform(
    id: string,
    updates: {
      position?: [number, number, number] | undefined;
      rotationY?: number | undefined;
      scale?: [number, number, number] | undefined;
    },
  ): void;
  addItem(templateId: string): string | null;
  removeItem(id: string): void;
  reset(): void;
  exportLayout(): string;
  subscribe(listener: () => void): () => void;
}

export interface OfficeSceneResult {
  office: THREE.Group;
  waypoints: OfficeWaypoints;
  updaters: SceneUpdater[];
  layout: OfficeLayoutController;
}

export interface AgentTargetOptions {
  facing?: number;
  status?: AgentStatus;
  seated?: boolean;
  path?: THREE.Vector3[];
}

export interface DemoContext {
  agents: Map<string, {
    id: string;
    mesh: THREE.Group;
    navNodeId: string | null;
    setTarget(position: THREE.Vector3, options?: AgentTargetOptions): void;
    status: AgentStatus;
  }>;
  deskAssignments: Map<string, DeskSlot>;
  waypoints: OfficeWaypoints;
}
