import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AgentController, STATUS } from "../../characters/agentController";
import { FishController } from "../../characters/fishController";
import { buildAgentConfig, createDeterministicAppearance, getDefaultAgentConfig, getKnownDeskIndex } from "../../agentDefaults";
import { moveAgentToDestination } from "../../demo";
import { createOfficeScene } from "../../scene/officeScene";
import type {
  AgentAppearance,
  AgentConfig,
  AgentRuntimeState,
  AgentSnapshotState,
  AgentStatus,
  DeskSlot,
  DestinationWaypoint,
  DemoContext,
} from "../../types";

type CharacterController = AgentController | FishController;

const MAX_RENDER_PIXEL_RATIO = 1.5;
const TARGET = new THREE.Vector3(1.5, 0.8, 0.4);
const CAMERA_OFFSET = new THREE.Vector3(1.5, 18, 16);
const CAMERA_BOUNDS = {
  minX: -4.5,
  maxX: 7.5,
  minZ: -6.5,
  maxZ: 6.5,
};

function resolveAppearance(agentId: string, appearance?: AgentAppearance): AgentAppearance {
  return appearance ?? getDefaultAgentConfig(agentId)?.appearance ?? createDeterministicAppearance(agentId);
}

function controllerStatus(status: AgentRuntimeState["status"]): AgentStatus {
  if (status === "meeting") {
    return STATUS.meeting;
  }
  if (status === "working") {
    return STATUS.working;
  }
  return STATUS.idle;
}

function buildRuntimeConfig(state: Pick<AgentRuntimeState, "id" | "name" | "role" | "emoji">, appearance?: AgentAppearance): AgentConfig {
  return buildAgentConfig({
    id: state.id,
    name: state.name,
    role: state.role,
    emoji: state.emoji,
    appearance: resolveAppearance(state.id, appearance),
  });
}

function nearestDesk(deskSlots: DeskSlot[], usedNodeIds: Set<string>): DeskSlot | null {
  return deskSlots.find((slot) => !usedNodeIds.has(slot.nodeId)) ?? deskSlots[0] ?? null;
}

export class MissionSceneController {
  container: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  clock: THREE.Clock;
  officeScene: ReturnType<typeof createOfficeScene>;
  agents: Map<string, CharacterController>;
  agentStates: Map<string, AgentRuntimeState>;
  deskAssignments: Map<string, DeskSlot>;
  demoContext: DemoContext;
  resizeObserver: ResizeObserver;
  frameHandle?: number | undefined;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;

  constructor(container: HTMLElement, onSelectAgent: (agentId: string) => void) {
    this.container = container;
    this.onSelectAgent = onSelectAgent;
    this.selectedAgentId = null;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.agents = new Map();
    this.agentStates = new Map();
    this.deskAssignments = new Map();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_RENDER_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "h-full w-full";
    container.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0a1421");
    this.scene.fog = new THREE.Fog("#0a1421", 26, 52);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
    this.camera.position.copy(CAMERA_OFFSET);
    this.camera.lookAt(TARGET);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enableRotate = false;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 16;
    this.controls.maxDistance = 30;
    this.controls.minPolarAngle = 0.74;
    this.controls.maxPolarAngle = 0.74;
    this.controls.minAzimuthAngle = 0;
    this.controls.maxAzimuthAngle = 0;
    this.controls.target.copy(TARGET);
    this.controls.addEventListener("change", () => this.clampCameraTarget());

    const ambient = new THREE.HemisphereLight("#f4f0df", "#0b1628", 1.7);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight("#ffe8be", 2.1);
    sun.position.set(12, 20, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    this.scene.add(sun);

    const rim = new THREE.PointLight("#74c6ff", 0.8, 40);
    rim.position.set(-10, 10, -4);
    this.scene.add(rim);

    this.officeScene = createOfficeScene();
    this.officeScene.office.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    this.scene.add(this.officeScene.office);

    this.demoContext = {
      agents: this.agents as DemoContext["agents"],
      deskAssignments: this.deskAssignments,
      waypoints: this.officeScene.waypoints,
    };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.animate();
  }

  setOnSelectAgent(onSelectAgent: (agentId: string) => void): void {
    this.onSelectAgent = onSelectAgent;
  }

  setAgents(nextAgents: AgentRuntimeState[]): void {
    const activeIds = new Set(nextAgents.map((state) => state.id));
    for (const [agentId] of this.agents) {
      if (!activeIds.has(agentId)) {
        this.removeAgent(agentId);
      }
    }

    nextAgents.forEach((state) => {
      this.agentStates.set(state.id, state);
      const appearance = (state as AgentSnapshotState).appearance;
      const controller = this.ensureController(state, appearance);
      controller.status = controllerStatus(state.status);
      controller.task = state.task;
      controller.message = state.message;
      this.moveControllerForState(controller, state);
    });
    this.applySelection();
  }

  setSelectedAgent(agentId: string | null): void {
    this.selectedAgentId = agentId;
    this.applySelection();
  }

  dispose(): void {
    if (this.frameHandle !== undefined) {
      window.cancelAnimationFrame(this.frameHandle);
    }
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private resize(): void {
    const width = Math.max(320, this.container.clientWidth);
    const height = Math.max(240, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private clampCameraTarget(): void {
    this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, CAMERA_BOUNDS.minX, CAMERA_BOUNDS.maxX);
    this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, CAMERA_BOUNDS.minZ, CAMERA_BOUNDS.maxZ);
  }

  private assignDesk(agentId: string, preferredDeskIndex?: number): DeskSlot | null {
    const existing = this.deskAssignments.get(agentId);
    if (existing) {
      return existing;
    }

    const preferred = typeof preferredDeskIndex === "number" ? this.officeScene.waypoints.deskSlots[preferredDeskIndex] : null;
    if (preferred) {
      this.deskAssignments.set(agentId, preferred);
      return preferred;
    }

    const usedNodeIds = new Set(
      Array.from(this.deskAssignments.entries())
        .filter(([id]) => id !== agentId)
        .map(([, desk]) => desk.nodeId),
    );
    const fallback = nearestDesk(this.officeScene.waypoints.deskSlots, usedNodeIds);
    if (fallback) {
      this.deskAssignments.set(agentId, fallback);
    }
    return fallback;
  }

  private createController(state: AgentRuntimeState, appearance?: AgentAppearance): CharacterController {
    const isCharlie = state.id === "charlie";
    const desk = isCharlie ? null : this.assignDesk(state.id, state.deskIndex ?? getKnownDeskIndex(state.id));
    const atDoor = state.location === "door" || state.status === "entering" || state.status === "leaving";
    const initialPosition = atDoor
      ? this.officeScene.waypoints.entrance.position.clone()
      : (desk?.sit ?? this.officeScene.waypoints.entrance.position).clone();
    const initialFacing = atDoor ? this.officeScene.waypoints.entrance.facing : (desk?.facing ?? 0);
    const config = buildRuntimeConfig(state, appearance);
    const controller = isCharlie
      ? new FishController(config, initialPosition, initialFacing)
      : new AgentController(config, initialPosition, initialFacing);
    controller.mesh.userData.agentId = state.id;
    controller.navNodeId = atDoor ? this.officeScene.waypoints.entrance.nodeId : (desk?.nodeId ?? this.officeScene.waypoints.entrance.nodeId);
    controller.task = state.task;
    controller.message = state.message;
    this.agents.set(state.id, controller);
    this.scene.add(controller.mesh);
    return controller;
  }

  private ensureController(state: AgentRuntimeState, appearance?: AgentAppearance): CharacterController {
    const existing = this.agents.get(state.id);
    if (existing) {
      existing.name = state.name;
      existing.role = state.role;
      existing.emoji = state.emoji ?? existing.emoji;
      existing.task = state.task;
      existing.message = state.message;
      if (state.id !== "charlie" && typeof state.deskIndex === "number") {
        this.assignDesk(state.id, state.deskIndex);
      }
      return existing;
    }
    return this.createController(state, appearance);
  }

  private getDeskDestination(agentId: string): DeskSlot | null {
    const state = this.agentStates.get(agentId);
    return this.deskAssignments.get(agentId) ?? this.assignDesk(agentId, state?.deskIndex ?? getKnownDeskIndex(agentId));
  }

  private getMeetingDestination(agentId: string): DestinationWaypoint | null {
    if (!this.officeScene.waypoints.meetingSeats.length) {
      return null;
    }
    const orderedIds = Array.from(this.agentStates.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => entry.id);
    const index = Math.max(0, orderedIds.indexOf(agentId));
    return this.officeScene.waypoints.meetingSeats[index % this.officeScene.waypoints.meetingSeats.length] ?? null;
  }

  private moveControllerForState(controller: CharacterController, state: AgentRuntimeState): void {
    if (state.location === "meeting-room" || state.status === "meeting") {
      const seat = this.getMeetingDestination(state.id);
      if (seat) {
        moveAgentToDestination(this.demoContext, controller, seat, {
          facing: seat.facing,
          seated: seat.seated ?? false,
          status: controllerStatus(state.status),
        });
      }
      return;
    }

    if (state.location === "cio-office") {
      moveAgentToDestination(this.demoContext, controller, this.officeScene.waypoints.cioOffice, {
        facing: this.officeScene.waypoints.cioOffice.facing,
        seated: false,
        status: controllerStatus(state.status),
      });
      return;
    }

    if (state.location === "door" || state.status === "entering" || state.status === "leaving") {
      moveAgentToDestination(this.demoContext, controller, this.officeScene.waypoints.entrance, {
        facing: this.officeScene.waypoints.entrance.facing,
        seated: false,
        status: controllerStatus(state.status),
      });
      return;
    }

    const desk = this.getDeskDestination(state.id);
    if (desk) {
      moveAgentToDestination(this.demoContext, controller, desk, {
        facing: desk.facing,
        seated: state.status === "working",
        status: controllerStatus(state.status),
      });
    }
  }

  private removeAgent(agentId: string): void {
    const controller = this.agents.get(agentId);
    if (controller) {
      this.scene.remove(controller.mesh);
      this.agents.delete(agentId);
    }
    this.agentStates.delete(agentId);
    this.deskAssignments.delete(agentId);
  }

  private applySelection(): void {
    this.agents.forEach((controller, agentId) => {
      controller.setMeetingHighlight(agentId === this.selectedAgentId);
    });
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = Array.from(this.agents.values(), (controller) => controller.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, true);
    const target = intersects.find((entry) => {
      let current: THREE.Object3D | null = entry.object;
      while (current) {
        if (typeof current.userData.agentId === "string") {
          return true;
        }
        current = current.parent;
      }
      return false;
    });

    if (!target) {
      return;
    }

    let current: THREE.Object3D | null = target.object;
    while (current) {
      if (typeof current.userData.agentId === "string") {
        this.onSelectAgent(current.userData.agentId);
        return;
      }
      current = current.parent;
    }
  };

  private animate = (): void => {
    this.frameHandle = window.requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;

    this.clampCameraTarget();
    this.controls.update();
    this.officeScene.updaters.forEach((updater) => updater(delta, elapsed));
    this.agents.forEach((controller) => controller.update(delta, elapsed));
    this.renderer.render(this.scene, this.camera);
  };
}
