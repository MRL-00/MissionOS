import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { buildAgentConfig, createDeterministicAppearance, getDefaultAgentConfig, getKnownDeskIndex } from "./agentDefaults";
import { getApiBase } from "./config/api";
import { AgentController, STATUS } from "./characters/agentController";
import { moveAgentToDestination } from "./demo";
import { OfficeWebSocketClient } from "./network/websocket";
import { createOfficeScene } from "./scene/officeScene";
import { createLayoutEditor, type LayoutTransformMode } from "./ui/layoutEditor";
import { createHud, LabelRenderer } from "./ui/overlay";
import { SpeechBubbleRenderer } from "./ui/speechBubble";
import type {
  ActivityLogEntry,
  AgentAppearance,
  AgentConfig,
  AgentEvent,
  AgentRuntimeState,
  AgentSnapshotState,
  AgentStatus,
  DeskSlot,
  DestinationWaypoint,
  MeetingState,
  MeetingTurn,
  ServerMessage,
} from "./types";

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

const cameraMoveKeys = new Set<string>();
const cameraMoveVector = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const CAMERA_MOVE_SPEED = 10;

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

const { office, waypoints, updaters, layout } = createOfficeScene();
scene.add(office);

const agents = new Map<string, AgentController>();
const agentStates = new Map<string, AgentRuntimeState>();
const deskAssignments = new Map<string, DeskSlot>();
const agentAppearances = new Map<string, AgentAppearance>();
const agentColors = new Map<string, string>();
const removalTimers = new Map<string, number>();
const activityEntries: ActivityLogEntry[] = [];
let meetingTranscript: MeetingTurn[] = [];
let currentMeeting: MeetingState = {
  active: false,
  transcript: [],
  progress: { currentTurn: 0, totalTurns: 0 },
  speed: 1,
  stopped: false,
};

const hud = createHud({
  onResetCamera: resetCamera,
});
const labelRenderer = new LabelRenderer(hud.labelLayer);
const speechBubbleRenderer = new SpeechBubbleRenderer(hud.speechLayer);
const transformControls = new TransformControls(camera, renderer.domElement);
const transformControlsHelper = transformControls.getHelper();
transformControlsHelper.visible = false;
scene.add(transformControlsHelper);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let layoutEditorEnabled = false;
let layoutTransformMode: LayoutTransformMode = "translate";
let selectedLayoutItemId: string | null = null;
let selectionHelper: THREE.BoxHelper | null = null;
let selectionPointerDown = false;
let layoutDragMoved = false;

const layoutEditor = createLayoutEditor({
  getExportText: () => layout.exportLayout(),
  onEnabledChange(enabled) {
    layoutEditorEnabled = enabled;
    if (!enabled) {
      clearLayoutSelection();
    }
  },
  onSelectItem(id) {
    selectLayoutItem(id);
  },
  onSetMode(mode) {
    setLayoutTransformMode(mode);
  },
  onUpdateSelectionTransform(patch) {
    if (!selectedLayoutItemId) {
      return;
    }
    layout.updateItemTransform(selectedLayoutItemId, patch);
    syncLayoutEditor();
    syncSelectionHelper();
  },
  onAddItem(templateId) {
    const id = layout.addItem(templateId);
    if (id) {
      selectLayoutItem(id);
      layoutEditor.setNotice("New item added. Drag it in the scene or adjust the fields.");
    }
  },
  onDeleteSelected() {
    if (!selectedLayoutItemId) {
      return;
    }
    const removedId = selectedLayoutItemId;
    clearLayoutSelection();
    layout.removeItem(removedId);
    syncLayoutEditor();
    layoutEditor.setNotice("Selected item removed from the layout.");
  },
  onResetLayout() {
    clearLayoutSelection();
    layout.reset();
    repairDeskAssignments();
    syncLayoutEditor();
  },
});

void hydrateOverlay();
syncHudState();
syncLayoutEditor();

function getControllerStatus(status: AgentEvent["status"]): AgentStatus {
  if (status === "meeting") {
    return STATUS.meeting;
  }
  if (status === "working") {
    return STATUS.working;
  }
  return STATUS.idle;
}

function getOrderedAgentIds(): string[] {
  return Array.from(agentStates.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((state) => state.id);
}

function syncHudState(): void {
  hud.syncAgentStates(Array.from(agentStates.values()).sort((left, right) => left.name.localeCompare(right.name)));
}

function syncSelectionHelper(): void {
  if (!selectedLayoutItemId) {
    selectionHelper?.removeFromParent();
    selectionHelper = null;
    return;
  }

  const object = layout.getObjectForItem(selectedLayoutItemId);
  if (!object) {
    selectionHelper?.removeFromParent();
    selectionHelper = null;
    return;
  }

  if (!selectionHelper) {
    selectionHelper = new THREE.BoxHelper(object, 0xd88a35);
    scene.add(selectionHelper);
  } else {
    selectionHelper.setFromObject(object);
  }

  selectionHelper.visible = true;
}

function syncLayoutEditor(): void {
  layoutEditor.sync({
    enabled: layoutEditorEnabled,
    mode: layoutTransformMode,
    items: layout.getItems(),
    selection: layout.getSelection(selectedLayoutItemId),
    catalog: layout.getCatalog(),
  });
}

function clearLayoutSelection(): void {
  selectedLayoutItemId = null;
  transformControls.detach();
  transformControlsHelper.visible = false;
  syncSelectionHelper();
  syncLayoutEditor();
}

function selectLayoutItem(itemId: string | null): void {
  if (!layoutEditorEnabled || !itemId) {
    clearLayoutSelection();
    return;
  }

  const object = layout.getObjectForItem(itemId);
  if (!object) {
    clearLayoutSelection();
    return;
  }

  selectedLayoutItemId = itemId;
  transformControls.attach(object);
  transformControlsHelper.visible = true;
  setLayoutTransformMode(layoutTransformMode);
  syncSelectionHelper();
  syncLayoutEditor();
}

function setLayoutTransformMode(mode: LayoutTransformMode): void {
  layoutTransformMode = mode;
  transformControls.setMode(mode);
  transformControls.showX = mode === "translate";
  transformControls.showY = mode === "rotate";
  transformControls.showZ = mode === "translate";
  syncLayoutEditor();
}

function cancelRemoval(agentId: string): void {
  const timer = removalTimers.get(agentId);
  if (timer === undefined) {
    return;
  }
  window.clearTimeout(timer);
  removalTimers.delete(agentId);
}

function releaseDesk(agentId: string): void {
  deskAssignments.delete(agentId);
}

function repairDeskAssignments(): void {
  deskAssignments.forEach((desk, agentId) => {
    const replacement = waypoints.deskSlots.find((candidate) => candidate.nodeId === desk.nodeId);
    if (!replacement) {
      deskAssignments.delete(agentId);
      return;
    }
    if (replacement !== desk) {
      deskAssignments.set(agentId, replacement);
    }
  });
}

function getPreferredDesk(agentId: string, preferredIndex?: number): DeskSlot | null {
  const assignedDesks = new Set(deskAssignments.values());

  if (typeof preferredIndex === "number") {
    const preferredDesk = waypoints.deskSlots[preferredIndex];
    const currentOwner = preferredDesk ? Array.from(deskAssignments.entries()).find(([, desk]) => desk === preferredDesk)?.[0] : undefined;
    if (preferredDesk && (!currentOwner || currentOwner === agentId)) {
      return preferredDesk;
    }
  }

  return waypoints.deskSlots.find((desk) => !assignedDesks.has(desk)) ?? null;
}

function assignDesk(agentId: string, preferredIndex?: number): DeskSlot | null {
  const assignedDesk = deskAssignments.get(agentId);
  if (assignedDesk) {
    if (typeof preferredIndex !== "number") {
      return assignedDesk;
    }

    const preferredDesk = waypoints.deskSlots[preferredIndex];
    if (!preferredDesk || preferredDesk === assignedDesk) {
      return assignedDesk;
    }

    releaseDesk(agentId);
    const reassignedDesk = getPreferredDesk(agentId, preferredIndex);
    if (!reassignedDesk) {
      deskAssignments.set(agentId, assignedDesk);
      return assignedDesk;
    }
    deskAssignments.set(agentId, reassignedDesk);
    return reassignedDesk;
  }

  const desk = getPreferredDesk(agentId, preferredIndex);
  if (!desk) {
    return null;
  }

  deskAssignments.set(agentId, desk);
  return desk;
}

function appearancesMatch(left: AgentAppearance, right: AgentAppearance): boolean {
  const leftAccessories = left.accessories ?? [];
  const rightAccessories = right.accessories ?? [];
  return (
    left.height === right.height &&
    left.headShape === right.headShape &&
    left.skinColor === right.skinColor &&
    left.hairStyle === right.hairStyle &&
    left.hairColor === right.hairColor &&
    left.bodyColor === right.bodyColor &&
    left.pantsColor === right.pantsColor &&
    leftAccessories.length === rightAccessories.length &&
    leftAccessories.every((accessory, index) => accessory === rightAccessories[index])
  );
}

function resolveAppearance(agentId: string, appearance?: AgentAppearance): AgentAppearance {
  const cached = agentAppearances.get(agentId);
  if (appearance) {
    agentAppearances.set(agentId, appearance);
    return appearance;
  }

  if (cached) {
    return cached;
  }

  const fallback = getDefaultAgentConfig(agentId)?.appearance ?? createDeterministicAppearance(agentId);
  agentAppearances.set(agentId, fallback);
  return fallback;
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

function createController(state: AgentRuntimeState, appearance?: AgentAppearance): AgentController {
  const desk = assignDesk(state.id, state.deskIndex ?? getKnownDeskIndex(state.id));
  const startAtDoor = state.location === "door" || state.status === "entering" || state.status === "leaving";
  const initialPosition = startAtDoor
    ? waypoints.entrance.position.clone()
    : (desk?.sit ?? waypoints.entrance.position).clone();
  const initialFacing = startAtDoor ? waypoints.entrance.facing : (desk?.facing ?? 0);
  const controller = new AgentController(buildRuntimeConfig(state, appearance), initialPosition, initialFacing);
  controller.navNodeId = startAtDoor ? waypoints.entrance.nodeId : (desk?.nodeId ?? waypoints.entrance.nodeId);
  scene.add(controller.mesh);
  agents.set(state.id, controller);
  agentColors.set(state.id, resolveAppearance(state.id, appearance).bodyColor);
  return controller;
}

function ensureController(state: AgentRuntimeState, appearance?: AgentAppearance): AgentController {
  cancelRemoval(state.id);

  const existing = agents.get(state.id);
  if (existing) {
    const currentAppearance = resolveAppearance(state.id);
    const config = buildRuntimeConfig(state, appearance);
    if (!appearancesMatch(currentAppearance, config.appearance)) {
      const meshPosition = existing.mesh.position.clone();
      const meshRotation = existing.mesh.rotation.y;
      const navNodeId = existing.navNodeId;
      const status = existing.status;
      const task = existing.task;
      const highlightTarget = existing.highlightTarget;

      scene.remove(existing.mesh);
      agents.delete(state.id);

      const replacement = createController(state, config.appearance);
      replacement.mesh.position.copy(meshPosition);
      replacement.mesh.rotation.y = meshRotation;
      replacement.targetPosition.copy(meshPosition);
      replacement.targetFacing = meshRotation;
      replacement.navNodeId = navNodeId;
      replacement.status = status;
      replacement.task = task;
      replacement.highlightTarget = highlightTarget;
      replacement.highlightAmount = highlightTarget;
      return replacement;
    }

    existing.name = config.name;
    existing.role = config.role;
    existing.emoji = config.emoji;
    existing.bodyColor = config.appearance.bodyColor;
    agentColors.set(state.id, config.appearance.bodyColor);
    if (typeof state.deskIndex === "number") {
      assignDesk(state.id, state.deskIndex);
    }
    return existing;
  }

  return createController(state, appearance);
}

function getDeskDestination(agentId: string): DeskSlot | null {
  const state = agentStates.get(agentId);
  return deskAssignments.get(agentId) ?? assignDesk(agentId, state?.deskIndex ?? getKnownDeskIndex(agentId));
}

function getMeetingDestination(agentId: string): DestinationWaypoint | null {
  if (!waypoints.meetingSeats.length) {
    return null;
  }

  const participantOrder = currentMeeting.config?.participants ?? getOrderedAgentIds();
  const participantIndex = participantOrder.indexOf(agentId);
  const seatIndex = participantIndex >= 0 ? participantIndex % waypoints.meetingSeats.length : 0;
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

function upsertAgentState(state: AgentRuntimeState): AgentRuntimeState {
  const previous = agentStates.get(state.id);
  const next: AgentRuntimeState = {
    ...previous,
    ...state,
  };
  agentStates.set(state.id, next);
  if (typeof next.deskIndex === "number") {
    assignDesk(next.id, next.deskIndex);
  }
  return next;
}

function removeAgentImmediately(agentId: string): void {
  cancelRemoval(agentId);
  const controller = agents.get(agentId);
  if (controller) {
    scene.remove(controller.mesh);
    agents.delete(agentId);
  }
  releaseDesk(agentId);
  agentColors.delete(agentId);
  speechBubbleRenderer.hide(agentId);
}

function scheduleAgentRemoval(agentId: string, delayMs = 900): void {
  cancelRemoval(agentId);
  const timer = window.setTimeout(() => {
    removalTimers.delete(agentId);
    removeAgentImmediately(agentId);
  }, delayMs);
  removalTimers.set(agentId, timer);
}

function clearMeetingHighlights(): void {
  agents.forEach((controller) => controller.setMeetingHighlight(false));
}

function showSpeech(agentId: string, message: string, mode: "default" | "meeting", typing = false): void {
  speechBubbleRenderer.show(agentId, message, {
    color: agentColors.get(agentId),
    persistent: mode === "meeting",
    variant: mode,
    typing,
  });
}

function syncTranscript(): void {
  hud.syncMeetingTranscript(meetingTranscript, currentMeeting.summary);
}

function pushActivity(entry: ActivityLogEntry): void {
  activityEntries.unshift(entry);
  activityEntries.splice(40);
  hud.syncActivityLog(activityEntries);
}

function handleAgentRegistered(message: Extract<ServerMessage, { type: "agent-registered" }>): void {
  const { appearance, ...state } = message.agent;
  if (appearance) {
    agentAppearances.set(state.id, appearance);
  }
  const next = upsertAgentState({
    ...state,
    appearance,
  });
  ensureController(next, appearance);
  syncHudState();
}

function handleAgentEvent(event: AgentEvent): void {
  const previous = agentStates.get(event.agentId);
  const next = upsertAgentState({
    id: event.agentId,
    name: previous?.name ?? getDefaultAgentConfig(event.agentId)?.name ?? event.agentId,
    role: previous?.role ?? getDefaultAgentConfig(event.agentId)?.role ?? "Temporary Agent",
    emoji: previous?.emoji ?? getDefaultAgentConfig(event.agentId)?.emoji,
    appearance: previous?.appearance,
    type: previous?.type ?? "visitor",
    deskIndex: previous?.deskIndex ?? getKnownDeskIndex(event.agentId),
    backendLink: previous?.backendLink,
    connected: true,
    status: event.status,
    timestamp: event.timestamp,
    location: event.location ?? previous?.location,
    task: event.task ?? previous?.task,
    message: event.message ?? previous?.message,
  });

  const controller = ensureController(next);
  controller.status = getControllerStatus(event.status);
  controller.task = event.task ?? previous?.task;
  moveControllerForEvent(controller, event);

  if (event.message) {
    showSpeech(event.agentId, event.message, currentMeeting.active ? "meeting" : "default");
  } else if (!currentMeeting.active && event.status !== "meeting") {
    speechBubbleRenderer.hide(event.agentId);
  }

  syncHudState();
}

function handleSnapshot(message: Extract<ServerMessage, { type: "agents-snapshot" }>): void {
  const snapshotIds = new Set(message.agents.map((state) => state.id));

  Array.from(agents.keys()).forEach((agentId) => {
    if (!snapshotIds.has(agentId)) {
      removeAgentImmediately(agentId);
    }
  });

  agentStates.clear();
  message.agents.forEach((snapshotState: AgentSnapshotState) => {
    agentAppearances.set(snapshotState.id, snapshotState.appearance);
    const next = upsertAgentState(snapshotState);
    const controller = ensureController(next, snapshotState.appearance);
    controller.status = getControllerStatus(next.status);
    controller.task = next.task;
    moveControllerForEvent(controller, {
      agentId: next.id,
      status: next.status,
      location: next.location,
      timestamp: next.timestamp,
    });
  });

  syncHudState();
}

function handleAgentRemoved(agentId: string): void {
  const controller = agents.get(agentId);
  agentStates.delete(agentId);
  syncHudState();

  if (!controller) {
    removeAgentImmediately(agentId);
    return;
  }

  moveControllerForEvent(controller, {
    agentId,
    status: "leaving",
    location: "door",
    timestamp: Date.now(),
  });
  scheduleAgentRemoval(agentId, 1000);
}

function applyMeetingStatus(state: MeetingState): void {
  currentMeeting = state;
  meetingTranscript = state.transcript;
  hud.setMeetingActive(state.active);
  syncTranscript();

  clearMeetingHighlights();
  if (state.currentSpeakerId) {
    agents.get(state.currentSpeakerId)?.setMeetingHighlight(true);
  }

  if (!state.active) {
    speechBubbleRenderer.clear();
  }
}

function handleServerMessage(message: ServerMessage): void {
  if (message.type === "agent-registered") {
    handleAgentRegistered(message);
    return;
  }

  if (message.type === "meeting-start") {
    meetingTranscript = [];
    currentMeeting = {
      active: true,
      config: message.config,
      transcript: [],
      progress: {
        currentTurn: 0,
        totalTurns: message.totalTurns,
      },
      startedAt: message.startedAt,
      speed: message.speed,
      stopped: false,
    };
    hud.setMeetingActive(true);
    syncTranscript();
    clearMeetingHighlights();
    return;
  }

  if (message.type === "meeting-turn") {
    clearMeetingHighlights();
    const controller = agents.get(message.agentId);
    controller?.setMeetingHighlight(true);

    if (message.isTyping) {
      showSpeech(message.agentId, "Typing...", "meeting", true);
      return;
    }

    showSpeech(message.agentId, message.message, "meeting");
    if (!meetingTranscript.some((turn) => turn.timestamp === message.timestamp && turn.agentId === message.agentId)) {
      meetingTranscript = [
        ...meetingTranscript,
        {
          agentId: message.agentId,
          message: message.message,
          timestamp: message.timestamp,
        },
      ];
    }
    currentMeeting = {
      ...currentMeeting,
      active: true,
      currentSpeakerId: message.agentId,
      transcript: meetingTranscript,
      progress: {
        currentTurn: Math.min(message.turnIndex + 1, currentMeeting.progress.totalTurns || message.totalTurns),
        totalTurns: currentMeeting.progress.totalTurns || message.totalTurns,
      },
    };
    syncTranscript();
    return;
  }

  if (message.type === "meeting-end") {
    currentMeeting = {
      ...currentMeeting,
      active: false,
      summary: message.summary,
      transcript: message.transcript,
      currentSpeakerId: undefined,
      stopped: false,
    };
    meetingTranscript = message.transcript;
    clearMeetingHighlights();
    hud.setMeetingActive(false);
    syncTranscript();
    return;
  }

  if (message.type === "meeting-status") {
    applyMeetingStatus(message.state);
    return;
  }

  if (message.type === "activity-log") {
    pushActivity(message.entry);
  }
}

const websocketClient = new OfficeWebSocketClient({
  onOpen() {
    hud.setRealtimeConnected(true);
  },
  onClose() {
    hud.setRealtimeConnected(false);
  },
  onEvent: handleAgentEvent,
  onServerMessage: handleServerMessage,
  onSnapshot: handleSnapshot,
  onAgentRemoved: handleAgentRemoved,
});
websocketClient.connect();

function resetCamera(): void {
  camera.position.copy(defaultCameraPosition);
  controls.target.copy(defaultTarget);
  controls.update();
}

layout.subscribe(() => {
  repairDeskAssignments();
  if (selectedLayoutItemId && !layout.getObjectForItem(selectedLayoutItemId)) {
    clearLayoutSelection();
    return;
  }
  syncLayoutEditor();
  syncSelectionHelper();
});

transformControls.addEventListener("dragging-changed", (event) => {
  controls.enabled = !event.value;
  if (event.value) {
    layoutDragMoved = false;
  }
});

transformControls.addEventListener("change", () => {
  if (selectedLayoutItemId) {
    syncSelectionHelper();
  }
});

transformControls.addEventListener("mouseUp", () => {
  if (!selectedLayoutItemId) {
    return;
  }

  const object = layout.getObjectForItem(selectedLayoutItemId);
  if (!object) {
    return;
  }

  layout.updateItemTransform(selectedLayoutItemId, {
    position: [object.position.x, object.position.y, object.position.z],
    rotationY: object.rotation.y,
    scale: [object.scale.x, object.scale.y, object.scale.z],
  });
  layoutDragMoved = true;
});

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function handleCameraMoveKey(event: KeyboardEvent, pressed: boolean): void {
  if (event.repeat && pressed) {
    return;
  }

  if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
    return;
  }

  const supportedKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);
  if (!supportedKeys.has(event.code)) {
    return;
  }

  event.preventDefault();
  if (pressed) {
    cameraMoveKeys.add(event.code);
    return;
  }
  cameraMoveKeys.delete(event.code);
}

function updateKeyboardCamera(delta: number): void {
  cameraMoveVector.set(0, 0, 0);

  if (cameraMoveKeys.has("KeyW") || cameraMoveKeys.has("ArrowUp")) {
    cameraMoveVector.z += 1;
  }
  if (cameraMoveKeys.has("KeyS") || cameraMoveKeys.has("ArrowDown")) {
    cameraMoveVector.z -= 1;
  }
  if (cameraMoveKeys.has("KeyA") || cameraMoveKeys.has("ArrowLeft")) {
    cameraMoveVector.x -= 1;
  }
  if (cameraMoveKeys.has("KeyD") || cameraMoveKeys.has("ArrowRight")) {
    cameraMoveVector.x += 1;
  }

  if (cameraMoveVector.lengthSq() === 0) {
    return;
  }

  cameraForward.subVectors(controls.target, camera.position);
  cameraForward.y = 0;
  if (cameraForward.lengthSq() === 0) {
    return;
  }
  cameraForward.normalize();
  cameraRight.crossVectors(cameraForward, worldUp).normalize();

  const translation = new THREE.Vector3()
    .addScaledVector(cameraForward, cameraMoveVector.z)
    .addScaledVector(cameraRight, cameraMoveVector.x)
    .normalize()
    .multiplyScalar(CAMERA_MOVE_SPEED * delta);

  camera.position.add(translation);
  controls.target.add(translation);
}

async function hydrateOverlay(): Promise<void> {
  try {
    const [activityResponse, transcriptResponse] = await Promise.all([
      fetch(`${getApiBase()}/api/activity`),
      fetch(`${getApiBase()}/api/meeting/transcript`),
    ]);

    if (activityResponse.ok) {
      const payload = (await activityResponse.json()) as { entries: ActivityLogEntry[] };
      activityEntries.splice(0, activityEntries.length, ...payload.entries);
      hud.syncActivityLog(activityEntries);
    }

    if (transcriptResponse.ok) {
      const payload = (await transcriptResponse.json()) as { transcript: { turns: MeetingTurn[]; summary: string } | null };
      if (payload.transcript) {
        meetingTranscript = payload.transcript.turns;
        hud.syncMeetingTranscript(meetingTranscript, payload.transcript.summary);
      }
    }
  } catch {
    hud.syncActivityLog(activityEntries);
  }
}

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => handleCameraMoveKey(event, true));
window.addEventListener("keyup", (event) => handleCameraMoveKey(event, false));
window.addEventListener("blur", () => cameraMoveKeys.clear());
window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) {
    return;
  }

  if (event.key === "Escape" && layoutEditorEnabled) {
    clearLayoutSelection();
    return;
  }

  if (!layoutEditorEnabled) {
    return;
  }

  if (event.key.toLowerCase() === "g") {
    setLayoutTransformMode("translate");
  }
  if (event.key.toLowerCase() === "r") {
    setLayoutTransformMode("rotate");
  }
});

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!layoutEditorEnabled || event.button !== 0) {
    return;
  }
  selectionPointerDown = true;
  layoutDragMoved = false;
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (!layoutEditorEnabled || !selectionPointerDown || event.button !== 0) {
    return;
  }

  selectionPointerDown = false;
  if (layoutDragMoved) {
    layoutDragMoved = false;
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersections = raycaster.intersectObjects(office.children, true);
  const pickedId = intersections
    .map((intersection) => layout.getItemIdFromObject(intersection.object))
    .find((id): id is string => Boolean(id));

  if (pickedId) {
    selectLayoutItem(pickedId);
    return;
  }

  clearLayoutSelection();
});

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;

  updateKeyboardCamera(delta);
  controls.update();
  updaters.forEach((updater) => updater(delta, elapsed));

  const labels = Array.from(agents.values(), (controller) => {
    controller.update(delta, elapsed);
    return controller.getLabelState();
  });

  if (selectionHelper && selectedLayoutItemId) {
    syncSelectionHelper();
  }

  labelRenderer.sync(labels, camera, { width: window.innerWidth, height: window.innerHeight });
  speechBubbleRenderer.sync(labels, camera, { width: window.innerWidth, height: window.innerHeight });
  renderer.render(scene, camera);
});
