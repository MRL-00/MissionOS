import type * as THREE from "three";

export type HeadShape = "round" | "oval" | "square";
export type HairStyle = "none" | "short" | "long" | "mohawk";
export type Accessory = "glasses" | "hat" | "tie";
export type AgentStatus = "idle" | "working" | "in-meeting";

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
  worldPosition: THREE.Vector3;
}

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
  }>;
  deskAssignments: Map<string, DeskSlot>;
  waypoints: OfficeWaypoints;
}
