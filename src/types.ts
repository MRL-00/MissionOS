import type * as THREE from "three";

export type HeadShape = "round" | "oval" | "square";
export type HairStyle = "none" | "short" | "long" | "mohawk" | "messy" | "slicked" | "buzz" | "curly";
export type Accessory = "glasses" | "hat" | "tie" | "beard";
export type AgentStatus = "idle" | "working" | "in-meeting";
export type RealtimeAgentStatus = "idle" | "working" | "meeting" | "entering" | "leaving";
export type AgentEventLocation = "desk" | "meeting-room" | "door" | "cio-office";
export type MeetingType = "standup" | "strategy" | "review";
export type MeetingSpeed = 1 | 2 | 3;

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

export interface AgentParts {
  bodyPivot: THREE.Group;
  headPivot: THREE.Group;
  legs: {
    leftLeg: THREE.Mesh;
    rightLeg: THREE.Mesh;
  };
  arms: {
    leftArm: THREE.Mesh;
    rightArm: THREE.Mesh;
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
  task?: string | undefined;
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
}

export interface AgentRuntimeState extends AgentRegistration {
  connected: boolean;
  status: RealtimeAgentStatus;
  task?: string | undefined;
  message?: string | undefined;
  location?: AgentEventLocation | undefined;
  timestamp: number;
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

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  kind:
    | "agent-status"
    | "agent-spawn"
    | "agent-complete"
    | "meeting-start"
    | "meeting-turn"
    | "meeting-end"
    | "meeting-stop"
    | "registration";
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
      agents: AgentRuntimeState[];
    }
  | {
      type: "agent-removed";
      agentId: string;
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

export interface OfficeSceneResult {
  office: THREE.Group;
  waypoints: OfficeWaypoints;
  updaters: SceneUpdater[];
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
