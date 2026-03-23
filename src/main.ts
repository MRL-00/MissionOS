import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import agentsConfig from "./config/agents.json";
import { AgentController, STATUS } from "./characters/agentController";
import { DemoDirector, moveAgentToDestination } from "./demo";
import { OfficeWebSocketClient } from "./network/websocket";
import { createOfficeScene } from "./scene/officeScene";
import { createHud, LabelRenderer } from "./ui/overlay";
import { SpeechBubbleRenderer } from "./ui/speechBubble";
import type {
  AgentConfig,
  AgentEvent,
  AgentRuntimeState,
  AgentStatus,
  DeskSlot,
  DestinationWaypoint,
  ServerMessage,
} from "./types";

const typedAgentsConfig = agentsConfig as AgentConfig[];
const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("Missing #app root element");
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#e9d5b4");
scene.fog = new THREE.Fog("#ead7b7", 28, 52);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 120);
const defaultCameraPosition = new THREE.Vector3(-17, 14, 17);
const defaultTarget = new THREE.Vector3(0, 1.6, 0);
camera.position.copy(defaultCameraPosition);
camera.lookAt(defaultTarget);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.minDistance = 7;
controls.maxDistance = 42;
controls.target.copy(defaultTarget);

const ambient = new THREE.HemisphereLight("#fff5de", "#b98f60", 1.9);
scene.add(ambient);

const sun = new THREE.DirectionalLight("#fff4d6", 2.2);
sun.position.set(12, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 50;
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

const fill = new THREE.DirectionalLight("#c0e1ff", 0.9);
fill.position.set(-10, 12, -6);
scene.add(fill);

const roomGlow = new THREE.PointLight("#fff0d0", 0.8, 24);
roomGlow.position.set(0, 7, 0);
scene.add(roomGlow);

const { office, waypoints, updaters } = createOfficeScene();
scene.add(office);

const agents = new Map<string, AgentController>();
const deskAssignments = new Map<string, DeskSlot>();
const unassignedDesks = waypoints.deskSlots.filter((desk) => !desk.assignedTo);

typedAgentsConfig.forEach((agentConfig, index) => {
  const assignedDesk =
    waypoints.deskSlots.find((desk) => desk.assignedTo === agentConfig.id) ??
    unassignedDesks.shift() ??
    null;
  const initialPosition = assignedDesk?.sit ?? waypoints.bullpen[index % waypoints.bullpen.length] ?? new THREE.Vector3();
  const controller = new AgentController(agentConfig, initialPosition.clone(), assignedDesk?.facing ?? 0);
  controller.navNodeId = assignedDesk?.nodeId ?? waypoints.entrance.nodeId;
  scene.add(controller.mesh);
  agents.set(agentConfig.id, controller);

  if (assignedDesk) {
    deskAssignments.set(agentConfig.id, assignedDesk);
    moveAgentToDestination({ agents, deskAssignments, waypoints }, controller, assignedDesk, {
      facing: assignedDesk.facing,
      status: STATUS.working,
      seated: false,
    });
    controller.mesh.position.copy(assignedDesk.sit);
  }
});

const hud = createHud({
  onToggleDemo: toggleDemo,
  onResetCamera: resetCamera,
});
const labelRenderer = new LabelRenderer(hud.labelLayer);
const speechBubbleRenderer = new SpeechBubbleRenderer(hud.speechLayer);

const demo = new DemoDirector({
  agents,
  deskAssignments,
  waypoints,
});
const agentOrder = typedAgentsConfig.map((agent) => agent.id);
const agentStates = new Map<string, AgentRuntimeState>(
  typedAgentsConfig.map((agent) => [
    agent.id,
    {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      connected: false,
      status: "idle",
      location: "desk",
      timestamp: Date.now(),
    },
  ]),
);

function getControllerStatus(status: AgentEvent["status"]): AgentStatus {
  if (status === "meeting") {
    return STATUS.meeting;
  }
  if (status === "working") {
    return STATUS.working;
  }
  return STATUS.idle;
}

function syncHudState(): void {
  hud.syncAgentStates(Array.from(agentStates.values()).sort((left, right) => left.name.localeCompare(right.name)));
}

function stopDemoForRealtime(): void {
  if (!demo.running) {
    return;
  }
  demo.stop();
  hud.setDemoRunning(false);
}

function getDeskDestination(agentId: string): DeskSlot | null {
  const assignedDesk = deskAssignments.get(agentId);
  if (assignedDesk) {
    return assignedDesk;
  }

  const agentIndex = agentOrder.indexOf(agentId);
  if (agentIndex < 0) {
    return null;
  }

  return waypoints.deskSlots[agentIndex] ?? null;
}

function getMeetingDestination(agentId: string): DestinationWaypoint | null {
  if (!waypoints.meetingSeats.length) {
    return null;
  }

  const agentIndex = agentOrder.indexOf(agentId);
  const seatIndex = agentIndex >= 0 ? agentIndex % waypoints.meetingSeats.length : 0;
  return waypoints.meetingSeats[seatIndex] ?? null;
}

function moveControllerForEvent(controller: AgentController, event: AgentEvent): void {
  const location = event.location ?? (event.status === "entering" || event.status === "leaving" ? "door" : undefined);
  if (!location) {
    return;
  }

  if (location === "desk") {
    const desk = getDeskDestination(event.agentId);
    if (!desk) {
      return;
    }
    moveAgentToDestination({ agents, deskAssignments, waypoints }, controller, desk, {
      facing: desk.facing,
      status: getControllerStatus(event.status),
      seated: event.status === "working",
    });
    return;
  }

  if (location === "meeting-room") {
    const seat = getMeetingDestination(event.agentId);
    if (!seat) {
      return;
    }
    moveAgentToDestination({ agents, deskAssignments, waypoints }, controller, seat, {
      facing: seat.facing,
      status: getControllerStatus(event.status),
      seated: seat.seated ?? false,
    });
    return;
  }

  if (location === "cio-office") {
    moveAgentToDestination({ agents, deskAssignments, waypoints }, controller, waypoints.cioOffice, {
      facing: waypoints.cioOffice.facing,
      status: getControllerStatus(event.status),
      seated: false,
    });
    return;
  }

  moveAgentToDestination({ agents, deskAssignments, waypoints }, controller, waypoints.entrance, {
    facing: waypoints.entrance.facing,
    status: getControllerStatus(event.status),
    seated: false,
  });
}

function applyAgentState(state: AgentRuntimeState): void {
  agentStates.set(state.id, state);
  const controller = agents.get(state.id);
  if (!controller) {
    return;
  }

  controller.status = getControllerStatus(state.status);
  controller.task = state.task;
}

function handleAgentEvent(event: AgentEvent): void {
  stopDemoForRealtime();

  const previous = agentStates.get(event.agentId);
  const next: AgentRuntimeState = {
    id: event.agentId,
    name: previous?.name ?? event.agentId,
    role: previous?.role ?? "Temporary Agent",
    connected: true,
    status: event.status,
    timestamp: event.timestamp,
    location: event.location ?? previous?.location,
    task: event.task ?? previous?.task,
    message: event.message ?? previous?.message,
  };
  agentStates.set(event.agentId, next);

  const controller = agents.get(event.agentId);
  if (controller) {
    controller.status = getControllerStatus(event.status);
    controller.task = event.task ?? previous?.task;
    moveControllerForEvent(controller, event);
  }

  if (event.message) {
    speechBubbleRenderer.show(event.agentId, event.message);
  }

  syncHudState();
}

function handleSnapshot(message: Extract<ServerMessage, { type: "agents-snapshot" }>): void {
  agentStates.clear();
  message.agents.forEach((state) => {
    applyAgentState(state);
    const controller = agents.get(state.id);
    if (controller) {
      moveControllerForEvent(controller, {
        agentId: state.id,
        status: state.status,
        location: state.location,
        timestamp: state.timestamp,
      });
    }
  });
  syncHudState();
}

function handleAgentRemoved(agentId: string): void {
  agentStates.delete(agentId);
  syncHudState();
}

const websocketClient = new OfficeWebSocketClient({
  onOpen() {
    hud.setRealtimeConnected(true);
  },
  onClose() {
    hud.setRealtimeConnected(false);
  },
  onEvent: handleAgentEvent,
  onSnapshot: handleSnapshot,
  onAgentRemoved: handleAgentRemoved,
});
websocketClient.connect();
syncHudState();

function toggleDemo(): void {
  if (demo.running) {
    demo.stop();
    hud.setDemoRunning(false);
    resetAgentsToDesks();
    return;
  }

  demo.start();
  hud.setDemoRunning(true);
}

function resetAgentsToDesks(): void {
  agents.forEach((controller, id) => {
    const desk = deskAssignments.get(id);
    if (!desk) {
      return;
    }
    moveAgentToDestination({ agents, deskAssignments, waypoints }, controller, desk, {
      facing: desk.facing,
      status: STATUS.working,
      seated: false,
    });
  });
}

function resetCamera(): void {
  camera.position.copy(defaultCameraPosition);
  controls.target.copy(defaultTarget);
  controls.update();
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener("resize", resize);

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;

  demo.update(delta);
  controls.update();
  updaters.forEach((updater) => updater(delta, elapsed));

  const labels = Array.from(agents.values(), (controller) => {
    controller.update(delta, elapsed);
    return controller.getLabelState();
  });

  labelRenderer.sync(labels, camera, { width: window.innerWidth, height: window.innerHeight });
  speechBubbleRenderer.sync(labels, camera, { width: window.innerWidth, height: window.innerHeight });
  renderer.render(scene, camera);
});
