import * as THREE from "three";
import defaultLayoutConfig from "../config/office-layout.json";
import {
  CHAIR_OFFSET,
  CHAIR_SIT_INSET,
  createDesk,
  createGlassWall,
  createKitchenCounter,
  createMeetingTable,
  createPlant,
  getDeskSeatOffsetX,
} from "./furniture";
import { makeGlass, makeMaterial } from "./materials";
import type {
  DeskSlot,
  LayoutCatalogItem,
  LayoutItemConfig,
  LayoutItemSummary,
  LayoutSelectionState,
  NavigationGraph,
  OfficeLayoutConfig,
  OfficeLayoutController,
  OfficeSceneResult,
  OfficeWaypoints,
  SceneUpdater,
} from "../types";

type VectorTuple = [number, number, number];

interface BoxOptions extends THREE.MeshStandardMaterialParameters {
  rotationY?: number;
}

interface RuntimeLayoutItem {
  config: LayoutItemConfig;
  object: THREE.Object3D;
  updaters: SceneUpdater[];
}

interface LayoutCatalogTemplate extends LayoutCatalogItem {
  create(id: string): LayoutItemConfig;
}

const LAYOUT_STORAGE_KEY = "the-office.layout.v1";
const NON_BULLPEN_AGENTS = new Set(["pickle", "randall", "cio", "jared"]);
const DEFAULT_LAYOUT = defaultLayoutConfig as unknown as OfficeLayoutConfig;

function addBox(
  parent: THREE.Object3D,
  size: VectorTuple,
  position: VectorTuple,
  color: string,
  options: BoxOptions = {},
): THREE.Mesh {
  const { rotationY = 0, ...materialOptions } = options;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), makeMaterial(color, materialOptions));
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.y = rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: THREE.Object3D,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: VectorTuple,
  color: string,
  radialSegments = 8,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
    makeMaterial(color),
  );
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function rotateYOffset(vector: THREE.Vector3, rotation: number): THREE.Vector3 {
  return vector.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
}

function connect(graph: NavigationGraph, left: string, right: string): void {
  graph[left]?.links.push(right);
  graph[right]?.links.push(left);
}

function createWhiteboard(): THREE.Group {
  const group = new THREE.Group();
  addBox(group, [2.8, 1.4, 0.08], [0, 1.9, 0], "#f7f7f2");
  addBox(group, [2.98, 1.58, 0.06], [0, 1.9, -0.03], "#9f8f7e");
  addBox(group, [0.55, 0.05, 0.05], [-0.65, 1.95, 0.05], "#4e9ac9");
  addBox(group, [0.42, 0.05, 0.05], [-0.25, 1.68, 0.05], "#d95b5b");
  addBox(group, [0.78, 0.05, 0.05], [0.4, 2.2, 0.05], "#5d8c62");
  return group;
}

function createKanbanBoard(): THREE.Group {
  const group = new THREE.Group();
  addBox(group, [3.2, 1.7, 0.08], [0, 1.9, 0], "#f6f2ea");
  addBox(group, [3.36, 1.86, 0.06], [0, 1.9, -0.03], "#7a6554");
  addBox(group, [0.05, 1.62, 0.05], [-0.54, 1.9, 0.05], "#cbb9a6");
  addBox(group, [0.05, 1.62, 0.05], [0.54, 1.9, 0.05], "#cbb9a6");

  [
    { x: -1.08, color: "#d47d63" },
    { x: 0, color: "#e0b75c" },
    { x: 1.08, color: "#6ba37d" },
  ].forEach(({ x, color }) => {
    addBox(group, [0.78, 0.18, 0.04], [x, 2.5, 0.05], color);
  });

  [
    { x: -1.22, y: 2.12, color: "#f1c96c" },
    { x: -0.92, y: 1.78, color: "#f1c96c" },
    { x: -0.1, y: 2.02, color: "#86b9d9" },
    { x: 0.18, y: 1.74, color: "#86b9d9" },
    { x: 0.92, y: 2.08, color: "#93c47d" },
    { x: 1.18, y: 1.76, color: "#e89b9b" },
  ].forEach(({ x, y, color }) => {
    addBox(group, [0.26, 0.24, 0.04], [x, y, 0.06], color);
  });

  return group;
}

function createWaterCooler(): THREE.Group {
  const group = new THREE.Group();
  addBox(group, [0.72, 1.12, 0.72], [0, 0.56, 0], "#dfe8ec");
  addBox(group, [0.44, 0.72, 0.44], [0, 1.52, 0], "#8cc2dc", { transparent: true, opacity: 0.82 });
  addBox(group, [0.12, 0.06, 0.12], [-0.12, 0.96, 0.34], "#4774b0");
  addBox(group, [0.12, 0.06, 0.12], [0.12, 0.96, 0.34], "#d87b5f");
  return group;
}

function createPoster(label: string, accent = "#d7b469"): THREE.Group {
  const poster = new THREE.Group();
  addBox(poster, [1.9, 1.25, 0.06], [0, 0, 0], accent);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#f8f2e8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#241d18";
    context.font = "bold 56px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";

    label.split(" x ").forEach((line, index, lines) => {
      const offset = (index - (lines.length - 1) / 2) * 70;
      context.fillText(line, canvas.width / 2, canvas.height / 2 + offset);
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const print = new THREE.Mesh(
    new THREE.PlaneGeometry(1.72, 1.08),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0 }),
  );
  print.position.z = 0.05;
  poster.add(print);
  return poster;
}

function createAbstractArt(accent: string, stripe: string): THREE.Group {
  const art = new THREE.Group();
  addBox(art, [1.8, 1.15, 0.06], [0, 0, 0], "#efe7dd");
  addBox(art, [0.95, 0.24, 0.05], [-0.24, 0.22, 0.04], accent);
  addBox(art, [1.18, 0.18, 0.05], [0.14, -0.12, 0.05], stripe);
  addBox(art, [0.34, 0.52, 0.05], [0.54, 0.24, 0.05], "#324655");
  addBox(art, [1.92, 1.27, 0.05], [0, 0, -0.03], "#8f7f72");
  return art;
}

function createBungyDeck(): { group: THREE.Group; updaters: SceneUpdater[] } {
  const group = new THREE.Group();
  const updaters: SceneUpdater[] = [];

  addBox(group, [1.9, 0.16, 1.55], [0, 0, 0], "#7f6857");

  addBox(group, [0.1, 0.96, 1.55], [-0.94, 0.4, 0], "#524439");
  addBox(group, [0.1, 0.96, 1.55], [0.94, 0.4, 0], "#524439");
  addBox(group, [1.9, 0.1, 0.1], [0, 0.84, 0.72], "#524439");
  addBox(group, [1.9, 0.1, 0.1], [0, 0.84, -0.72], "#524439");

  addBox(group, [0.14, 2.5, 0.14], [0.68, 1.1, 0], "#3f352d");
  addBox(group, [1.38, 0.12, 0.12], [0.62, 2.27, 0], "#3f352d");

  const cordPivot = new THREE.Group();
  cordPivot.position.set(1.2, 2.27, 0);
  group.add(cordPivot);

  const cordLength = 4.1;
  const cord = addCylinder(cordPivot, 0.02, 0.032, cordLength, [0, -cordLength / 2, 0], "#f1be47", 10);
  const jumperAnchor = new THREE.Group();
  jumperAnchor.position.y = -cordLength;
  cordPivot.add(jumperAnchor);

  const jumper = new THREE.Group();
  addBox(jumper, [0.12, 0.34, 0.12], [-0.08, -0.18, 0], "#2a2f39");
  addBox(jumper, [0.12, 0.34, 0.12], [0.08, -0.18, 0], "#2a2f39");
  addBox(jumper, [0.2, 0.42, 0.16], [0, -0.62, 0], "#2a2f39");
  addBox(jumper, [0.11, 0.24, 0.11], [-0.15, -0.58, 0], "#da8b60");
  addBox(jumper, [0.11, 0.24, 0.11], [0.15, -0.58, 0], "#da8b60");
  addCylinder(jumper, 0.1, 0.1, 0.18, [0, -0.94, 0], "#f1c39b", 10);
  jumperAnchor.add(jumper);

  updaters.push((_, elapsed) => {
    const stretch = 1.08 + Math.sin(elapsed * 2.1) * 0.12;
    const sway = Math.sin(elapsed * 1.05) * 0.2;

    cordPivot.rotation.z = 0.08 + sway * 0.14;
    cord.scale.y = stretch;
    cord.position.y = -(cordLength * stretch) / 2;
    jumperAnchor.position.y = -cordLength * stretch;
    jumperAnchor.rotation.z = Math.PI / 14 + sway * 0.32;
    jumper.position.y = Math.sin(elapsed * 3.2) * 0.08;
    jumper.rotation.z = Math.PI / 20 + sway * 0.12;
  });

  return { group, updaters };
}

function createBoxItem(item: LayoutItemConfig): THREE.Group {
  const group = new THREE.Group();
  addBox(group, item.size ?? [1, 1, 1], [0, 0, 0], item.color ?? "#ffffff");
  return group;
}

function createDeskSlotForItem(item: LayoutItemConfig, slotId: string): DeskSlot {
  const [x, , z] = item.position;
  const origin = new THREE.Vector3(x, 0, z);
  const rotation = item.rotationY ?? 0;
  const chairSide = item.deskSlot?.chairSide ?? item.chairSide ?? 1;
  const seatOffsetX = getDeskSeatOffsetX(item.executive ?? false);
  const sitDistance = CHAIR_OFFSET - CHAIR_SIT_INSET;
  const chairOffset = rotateYOffset(new THREE.Vector3(seatOffsetX, 0, chairSide * sitDistance), rotation);
  const approachOffset = rotateYOffset(new THREE.Vector3(seatOffsetX, 0, chairSide * (CHAIR_OFFSET + 1.02)), rotation);

  const slot: DeskSlot = {
    nodeId: slotId,
    approach: origin.clone().add(approachOffset),
    sit: origin.clone().add(chairOffset),
    facing: rotation + (chairSide > 0 ? Math.PI : 0),
  };

  if (item.deskSlot?.assignedTo) {
    slot.assignedTo = item.deskSlot.assignedTo;
  }

  return slot;
}

function applyLayoutTransform(object: THREE.Object3D, item: LayoutItemConfig): void {
  const [x, y, z] = item.position;
  const [sx, sy, sz] = item.scale ?? [1, 1, 1];
  object.position.set(x, y, z);
  object.rotation.set(0, item.rotationY ?? 0, 0);
  object.scale.set(sx, sy, sz);
}

function applyLayoutMetadata(object: THREE.Object3D, itemId: string): void {
  object.userData.layoutItemId = itemId;
  object.traverse((child) => {
    child.userData.layoutItemId = itemId;
  });
}

function buildRuntimeItem(item: LayoutItemConfig): RuntimeLayoutItem {
  let object: THREE.Object3D;
  let updaters: SceneUpdater[] = [];

  switch (item.kind) {
    case "box":
      object = createBoxItem(item);
      break;
    case "glassWall":
      object = createGlassWall(item.width ?? 2, item.height ?? 2, item.depth ?? 0.08);
      if (item.glassColor) {
        const material = (object as THREE.Mesh).material;
        if (material instanceof THREE.MeshPhysicalMaterial) {
          material.color.set(item.glassColor);
        }
      }
      break;
    case "desk":
      object = createDesk({
        x: 0,
        z: 0,
        chairSide: item.chairSide ?? 1,
        accent: item.accent ?? "#7e5b43",
        rotation: 0,
        executive: item.executive ?? false,
      });
      break;
    case "meetingTable":
      object = createMeetingTable();
      break;
    case "plant":
      object = createPlant(item.plantHeight ?? 1.1);
      break;
    case "whiteboard":
      object = createWhiteboard();
      break;
    case "kanbanBoard":
      object = createKanbanBoard();
      break;
    case "poster":
      object = createPoster(item.posterLabel ?? "Poster", item.posterAccent);
      break;
    case "abstractArt":
      object = createAbstractArt(item.artAccent ?? "#bccb96", item.artStripe ?? "#d37b53");
      break;
    case "waterCooler":
      object = createWaterCooler();
      break;
    case "kitchenCounter":
      object = createKitchenCounter();
      break;
    case "bungyDeck": {
      const deck = createBungyDeck();
      object = deck.group;
      updaters = deck.updaters;
      break;
    }
    default:
      object = new THREE.Group();
  }

  applyLayoutTransform(object, item);
  applyLayoutMetadata(object, item.id);

  return { config: item, object, updaters };
}

function buildBaseNavigation(): NavigationGraph {
  return {
    entranceExterior: { position: new THREE.Vector3(-9.55, 0, 9.4), links: [] },
    entranceInterior: { position: new THREE.Vector3(-9.55, 0, 7.45), links: [] },
    receptionFront: { position: new THREE.Vector3(-8.15, 0, 7.05), links: [] },
    northHallWest: { position: new THREE.Vector3(-5.35, 0, 5.05), links: [] },
    northHallCenter: { position: new THREE.Vector3(0, 0, 5.05), links: [] },
    northHallEast: { position: new THREE.Vector3(4.95, 0, 5.05), links: [] },
    deskAisleNorthWest: { position: new THREE.Vector3(-3.9, 0, 4.55), links: [] },
    deskAisleNorthCenter: { position: new THREE.Vector3(0, 0, 4.55), links: [] },
    deskAisleNorthEast: { position: new THREE.Vector3(3.9, 0, 4.55), links: [] },
    centerHallWest: { position: new THREE.Vector3(-5.35, 0, 1.1), links: [] },
    centerHallCenter: { position: new THREE.Vector3(0, 0, 1.1), links: [] },
    centerHallEast: { position: new THREE.Vector3(4.95, 0, 1.1), links: [] },
    deskAisleSouthWest: { position: new THREE.Vector3(-3.9, 0, 0.5), links: [] },
    deskAisleSouthCenter: { position: new THREE.Vector3(0, 0, 0.5), links: [] },
    deskAisleSouthEast: { position: new THREE.Vector3(3.9, 0, 0.5), links: [] },
    deskAisleFarSouthWest: { position: new THREE.Vector3(-3.9, 0, -2.75), links: [] },
    deskAisleFarSouthCenter: { position: new THREE.Vector3(-1.1, 0, -2.75), links: [] },
    southHallWest: { position: new THREE.Vector3(-5.45, 0, -2.55), links: [] },
    southHallCenter: { position: new THREE.Vector3(0, 0, -2.55), links: [] },
    southHallEast: { position: new THREE.Vector3(4.65, 0, -2.55), links: [] },
    scrumDeskHub: { position: new THREE.Vector3(0.05, 0, -2.05), links: [] },
    kitchenDoor: { position: new THREE.Vector3(-7.55, 0, -2.55), links: [] },
    kitchenHub: { position: new THREE.Vector3(-9.25, 0, -4.95), links: [] },
    meetingDoorOuter: { position: new THREE.Vector3(4.8, 0, -4.35), links: [] },
    meetingDoorInner: { position: new THREE.Vector3(5.95, 0, -4.35), links: [] },
    meetingNorthAisle: { position: new THREE.Vector3(8.6, 0, -2.2), links: [] },
    meetingSouthAisle: { position: new THREE.Vector3(8.6, 0, -6.4), links: [] },
    meetingWestInner: { position: new THREE.Vector3(6.0, 0, -4.35), links: [] },
    meetingEastInner: { position: new THREE.Vector3(11.2, 0, -4.35), links: [] },
    meetingWestAisle: { position: new THREE.Vector3(6.25, 0, -4.35), links: [] },
    meetingEastAisle: { position: new THREE.Vector3(10.95, 0, -4.35), links: [] },
    cioDoorOuter: { position: new THREE.Vector3(6.05, 0, 5.9), links: [] },
    cioDoorInner: { position: new THREE.Vector3(7.2, 0, 5.9), links: [] },
    cioHub: { position: new THREE.Vector3(9.45, 0, 5.9), links: [] },
  };
}

function wireNavigation(graph: NavigationGraph, deskItems: LayoutItemConfig[]): void {
  connect(graph, "entranceExterior", "entranceInterior");
  connect(graph, "entranceInterior", "receptionFront");
  connect(graph, "receptionFront", "northHallWest");
  connect(graph, "northHallWest", "northHallCenter");
  connect(graph, "northHallCenter", "northHallEast");
  connect(graph, "northHallWest", "centerHallWest");
  connect(graph, "northHallCenter", "centerHallCenter");
  connect(graph, "northHallEast", "centerHallEast");
  connect(graph, "centerHallWest", "centerHallCenter");
  connect(graph, "centerHallCenter", "centerHallEast");
  connect(graph, "centerHallWest", "southHallWest");
  connect(graph, "centerHallCenter", "southHallCenter");
  connect(graph, "centerHallEast", "southHallEast");
  connect(graph, "southHallWest", "southHallCenter");
  connect(graph, "southHallCenter", "southHallEast");
  connect(graph, "southHallWest", "deskAisleFarSouthWest");
  connect(graph, "southHallCenter", "deskAisleFarSouthCenter");
  connect(graph, "deskAisleFarSouthWest", "deskAisleFarSouthCenter");
  connect(graph, "southHallCenter", "scrumDeskHub");
  connect(graph, "scrumDeskHub", "southHallEast");
  connect(graph, "deskAisleFarSouthCenter", "scrumDeskHub");
  connect(graph, "southHallWest", "kitchenDoor");
  connect(graph, "kitchenDoor", "kitchenHub");
  connect(graph, "southHallEast", "meetingDoorOuter");
  connect(graph, "meetingDoorOuter", "meetingDoorInner");
  connect(graph, "meetingDoorInner", "meetingWestInner");
  connect(graph, "meetingWestInner", "meetingNorthAisle");
  connect(graph, "meetingWestInner", "meetingSouthAisle");
  connect(graph, "meetingDoorInner", "meetingWestAisle");
  connect(graph, "meetingWestAisle", "meetingNorthAisle");
  connect(graph, "meetingWestAisle", "meetingSouthAisle");
  connect(graph, "meetingNorthAisle", "meetingEastInner");
  connect(graph, "meetingSouthAisle", "meetingEastInner");
  connect(graph, "meetingEastInner", "meetingEastAisle");
  connect(graph, "meetingNorthAisle", "meetingEastAisle");
  connect(graph, "meetingSouthAisle", "meetingEastAisle");
  connect(graph, "northHallEast", "cioDoorOuter");
  connect(graph, "cioDoorOuter", "cioDoorInner");
  connect(graph, "cioDoorInner", "cioHub");
  connect(graph, "deskAisleNorthWest", "northHallWest");
  connect(graph, "deskAisleNorthCenter", "northHallCenter");
  connect(graph, "deskAisleNorthEast", "northHallEast");
  connect(graph, "deskAisleSouthWest", "centerHallWest");
  connect(graph, "deskAisleSouthCenter", "centerHallCenter");
  connect(graph, "deskAisleSouthEast", "centerHallEast");

  deskItems.forEach((item) => {
    const slotId = item.id;
    graph[slotId] = {
      position: createDeskSlotForItem(item, slotId).approach.clone(),
      links: [],
    };
    const connectToNode = item.deskSlot?.connectToNode;
    if (connectToNode && graph[connectToNode]) {
      connect(graph, slotId, connectToNode);
    }
  });
}

function copyVectorTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function cloneLayoutConfig(source: OfficeLayoutConfig): OfficeLayoutConfig {
  return structuredClone(source);
}

function loadStoredLayout(): OfficeLayoutConfig {
  const fallback = cloneLayoutConfig(DEFAULT_LAYOUT);

  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<OfficeLayoutConfig>;
    if (!parsed || !Array.isArray(parsed.items)) {
      return fallback;
    }

    return {
      version: typeof parsed.version === "number" ? parsed.version : fallback.version,
      items: parsed.items as LayoutItemConfig[],
    };
  } catch {
    return fallback;
  }
}

const LAYOUT_CATALOG: LayoutCatalogTemplate[] = [
  {
    templateId: "desk-standard",
    label: "Standard Desk",
    description: "Brown team desk with monitor and mug.",
    kind: "desk",
    create: (id) => ({
      id,
      label: "Custom desk",
      kind: "desk",
      position: [0, 0, 0],
      accent: "#8a6248",
      chairSide: 1,
      removable: true,
    }),
  },
  {
    templateId: "desk-executive",
    label: "Executive Desk",
    description: "Wider desk for offices and lead roles.",
    kind: "desk",
    create: (id) => ({
      id,
      label: "Custom executive desk",
      kind: "desk",
      position: [0, 0, 0],
      accent: "#6d4d38",
      chairSide: 1,
      executive: true,
      removable: true,
    }),
  },
  {
    templateId: "plant-tall",
    label: "Tall Plant",
    description: "Large potted plant for corners and hallways.",
    kind: "plant",
    create: (id) => ({
      id,
      label: "Custom tall plant",
      kind: "plant",
      position: [0, 0, 0],
      plantHeight: 1.35,
      removable: true,
    }),
  },
  {
    templateId: "plant-small",
    label: "Small Plant",
    description: "Shorter potted plant for desks and glass edges.",
    kind: "plant",
    create: (id) => ({
      id,
      label: "Custom small plant",
      kind: "plant",
      position: [0, 0, 0],
      plantHeight: 0.85,
      removable: true,
    }),
  },
  {
    templateId: "glass-panel",
    label: "Glass Panel",
    description: "Movable glass wall segment for offices and rooms.",
    kind: "glassWall",
    create: (id) => ({
      id,
      label: "Custom glass panel",
      kind: "glassWall",
      position: [0, 1.48, 0],
      width: 2.4,
      height: 2.35,
      removable: true,
    }),
  },
  {
    templateId: "wall-segment",
    label: "Wall Segment",
    description: "Solid wall piece for patching or extending rooms.",
    kind: "box",
    create: (id) => ({
      id,
      label: "Custom wall segment",
      kind: "box",
      position: [0, 1.6, 0],
      size: [3, 3.2, 0.35],
      color: "#f3eadf",
      removable: true,
    }),
  },
  {
    templateId: "meeting-table",
    label: "Meeting Table",
    description: "Conference table that can anchor a room.",
    kind: "meetingTable",
    create: (id) => ({
      id,
      label: "Custom meeting table",
      kind: "meetingTable",
      position: [0, 0, 0],
      removable: true,
    }),
  },
  {
    templateId: "whiteboard",
    label: "Whiteboard",
    description: "Presentation board for walls and meeting rooms.",
    kind: "whiteboard",
    create: (id) => ({
      id,
      label: "Custom whiteboard",
      kind: "whiteboard",
      position: [0, 0, 0],
      removable: true,
    }),
  },
  {
    templateId: "kanban-board",
    label: "Kanban Board",
    description: "Task board for walls and collaboration spaces.",
    kind: "kanbanBoard",
    create: (id) => ({
      id,
      label: "Custom kanban board",
      kind: "kanbanBoard",
      position: [0, 0, 0],
      removable: true,
    }),
  },
  {
    templateId: "water-cooler",
    label: "Water Cooler",
    description: "Break area prop for corners and shared spaces.",
    kind: "waterCooler",
    create: (id) => ({
      id,
      label: "Custom water cooler",
      kind: "waterCooler",
      position: [0, 0, 0],
      removable: true,
    }),
  },
  {
    templateId: "kitchen-counter",
    label: "Kitchen Counter",
    description: "Counter, fridge, and machine for kitchen areas.",
    kind: "kitchenCounter",
    create: (id) => ({
      id,
      label: "Custom kitchen counter",
      kind: "kitchenCounter",
      position: [0, 0, 0],
      removable: true,
    }),
  },
  {
    templateId: "poster",
    label: "Poster",
    description: "Framed wall poster for decoration.",
    kind: "poster",
    create: (id) => ({
      id,
      label: "Custom poster",
      kind: "poster",
      position: [0, 2.05, 0],
      posterLabel: "Office x Values",
      posterAccent: "#cf7f4d",
      removable: true,
    }),
  },
  {
    templateId: "abstract-art",
    label: "Abstract Art",
    description: "Decorative framed art for executive spaces.",
    kind: "abstractArt",
    create: (id) => ({
      id,
      label: "Custom art",
      kind: "abstractArt",
      position: [0, 2.05, 0],
      artAccent: "#bccb96",
      artStripe: "#d37b53",
      removable: true,
    }),
  },
];

class OfficeLayoutManager implements OfficeLayoutController {
  office: THREE.Group;
  waypoints: OfficeWaypoints;
  updaters: SceneUpdater[];
  state: OfficeLayoutConfig;
  items: Map<string, RuntimeLayoutItem>;
  deskSlotsById: Map<string, DeskSlot>;
  listeners: Set<() => void>;

  constructor(office: THREE.Group, waypoints: OfficeWaypoints, updaters: SceneUpdater[]) {
    this.office = office;
    this.waypoints = waypoints;
    this.updaters = updaters;
    this.state = loadStoredLayout();
    this.items = new Map();
    this.deskSlotsById = new Map();
    this.listeners = new Set();
    this.rebuild();
  }

  getCatalog(): LayoutCatalogItem[] {
    return LAYOUT_CATALOG.map(({ templateId, label, description, kind }) => ({
      templateId,
      label,
      description,
      kind,
    }));
  }

  getItems(): LayoutItemSummary[] {
    return this.state.items.map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind,
      removable: item.removable ?? false,
    }));
  }

  getSelection(id: string | null): LayoutSelectionState | null {
    if (!id) {
      return null;
    }

    const runtime = this.items.get(id);
    if (!runtime) {
      return null;
    }

    return {
      id,
      label: runtime.config.label,
      kind: runtime.config.kind,
      position: copyVectorTuple(runtime.object.position),
      rotationY: runtime.object.rotation.y,
      scale: copyVectorTuple(runtime.object.scale),
      removable: runtime.config.removable ?? false,
    };
  }

  getObjectForItem(id: string): THREE.Object3D | null {
    return this.items.get(id)?.object ?? null;
  }

  getItemIdFromObject(object: THREE.Object3D | null): string | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (typeof current.userData.layoutItemId === "string") {
        return current.userData.layoutItemId;
      }
      current = current.parent;
    }
    return null;
  }

  updateItemTransform(
    id: string,
    updates: {
      position?: [number, number, number] | undefined;
      rotationY?: number | undefined;
      scale?: [number, number, number] | undefined;
    },
  ): void {
    const runtime = this.items.get(id);
    const item = this.state.items.find((entry) => entry.id === id);
    if (!runtime || !item) {
      return;
    }

    if (updates.position) {
      item.position = [...updates.position];
    }
    if (typeof updates.rotationY === "number") {
      item.rotationY = updates.rotationY;
    }
    if (updates.scale) {
      item.scale = [...updates.scale];
    }

    applyLayoutTransform(runtime.object, item);
    this.syncDerivedWaypoints();
    this.persist();
    this.emit();
  }

  addItem(templateId: string): string | null {
    const template = LAYOUT_CATALOG.find((entry) => entry.templateId === templateId);
    if (!template) {
      return null;
    }

    const id = `${template.templateId}-${Date.now().toString(36)}`;
    const item = template.create(id);
    this.state.items.push(item);

    const runtime = buildRuntimeItem(item);
    this.items.set(id, runtime);
    this.office.add(runtime.object);
    this.updaters.push(...runtime.updaters);

    this.syncDerivedWaypoints();
    this.persist();
    this.emit();
    return id;
  }

  removeItem(id: string): void {
    const runtime = this.items.get(id);
    if (!runtime || !(runtime.config.removable ?? false)) {
      return;
    }

    this.office.remove(runtime.object);
    runtime.updaters.forEach((updater) => {
      const index = this.updaters.indexOf(updater);
      if (index >= 0) {
        this.updaters.splice(index, 1);
      }
    });
    this.items.delete(id);
    this.deskSlotsById.delete(id);
    this.state.items = this.state.items.filter((item) => item.id !== id);

    this.syncDerivedWaypoints();
    this.persist();
    this.emit();
  }

  reset(): void {
    this.state = cloneLayoutConfig(DEFAULT_LAYOUT);
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
    this.rebuild();
    this.emit();
  }

  exportLayout(): string {
    return JSON.stringify(this.state, null, 2);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private rebuild(): void {
    this.office.clear();
    this.updaters.length = 0;
    this.items.clear();

    this.state.items.forEach((item) => {
      const runtime = buildRuntimeItem(item);
      this.items.set(item.id, runtime);
      this.office.add(runtime.object);
      this.updaters.push(...runtime.updaters);
    });

    this.syncDerivedWaypoints();
  }

  private syncDerivedWaypoints(): void {
    const deskItems = this.state.items.filter((item) => item.deskSlot);
    const nextDeskSlotIds = new Set(deskItems.map((item) => item.id));

    deskItems.forEach((item) => {
      const slot = this.deskSlotsById.get(item.id) ?? createDeskSlotForItem(item, item.id);
      const next = createDeskSlotForItem(item, item.id);
      slot.nodeId = next.nodeId;
      slot.approach.copy(next.approach);
      slot.sit.copy(next.sit);
      slot.facing = next.facing;
      if (next.assignedTo) {
        slot.assignedTo = next.assignedTo;
      } else {
        delete slot.assignedTo;
      }
      this.deskSlotsById.set(item.id, slot);
    });

    Array.from(this.deskSlotsById.keys()).forEach((id) => {
      if (!nextDeskSlotIds.has(id)) {
        this.deskSlotsById.delete(id);
      }
    });

    this.waypoints.deskSlots.length = 0;
    deskItems.forEach((item) => {
      const slot = this.deskSlotsById.get(item.id);
      if (slot) {
        this.waypoints.deskSlots.push(slot);
      }
    });

    this.waypoints.bullpen.length = 0;
    this.waypoints.deskSlots
      .filter((desk) => desk.assignedTo && !NON_BULLPEN_AGENTS.has(desk.assignedTo))
      .forEach((desk) => {
        this.waypoints.bullpen.push(desk.approach.clone());
      });

    const navigation = buildBaseNavigation();
    wireNavigation(navigation, deskItems);

    deskItems.forEach((item) => {
      const node = navigation[item.id];
      const slot = this.deskSlotsById.get(item.id);
      if (node && slot) {
        node.position.copy(slot.approach);
      }
    });

    Object.keys(this.waypoints.navigation).forEach((key) => {
      delete this.waypoints.navigation[key];
    });
    Object.assign(this.waypoints.navigation, navigation);

    const entranceInterior = this.waypoints.navigation.entranceInterior;
    const cioHub = this.waypoints.navigation.cioHub;
    if (entranceInterior) {
      this.waypoints.entrance.position.copy(entranceInterior.position);
      this.waypoints.entrance.nodeId = "entranceInterior";
      this.waypoints.entrance.facing = Math.PI;
    }
    this.waypoints.reception.position.set(-8.15, 0, 6.2);
    this.waypoints.reception.nodeId = "receptionFront";
    this.waypoints.reception.facing = Math.PI / 2;
    this.waypoints.kitchen.position.set(-10.25, 0, -5.35);
    this.waypoints.kitchen.nodeId = "kitchenHub";
    this.waypoints.kitchen.facing = Math.PI / 2;
    if (cioHub) {
      this.waypoints.cioOffice.position.copy(cioHub.position);
      this.waypoints.cioOffice.nodeId = "cioHub";
      this.waypoints.cioOffice.facing = Math.PI / 2;
    }

    this.syncMeetingSeats();
  }

  private syncMeetingSeats(): void {
    const table = this.items.get("meeting-table")?.object;
    const origin = table?.position ?? new THREE.Vector3(8.6, 0, -4.3);
    const rotation = table?.rotation.y ?? 0;
    const northOffsets = [-2.8, -1.4, 0, 1.4, 2.8].map((x) => new THREE.Vector3(x, 0, 1.75));
    const southOffsets = [-2.8, -1.4, 0, 1.4, 2.8].map((x) => new THREE.Vector3(x, 0, -1.75));
    const seats = [
      ...northOffsets.map((offset) => ({
        nodeId: "meetingNorthAisle",
        position: rotateYOffset(offset, rotation).add(origin),
        facing: Math.PI + rotation,
        seated: false,
      })),
      ...southOffsets.map((offset) => ({
        nodeId: "meetingSouthAisle",
        position: rotateYOffset(offset, rotation).add(origin),
        facing: rotation,
        seated: false,
      })),
    ];

    this.waypoints.meetingSeats.length = 0;
    seats.forEach((seat) => {
      this.waypoints.meetingSeats.push(seat);
    });
  }

  private persist(): void {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, this.exportLayout());
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export function createOfficeScene(): OfficeSceneResult {
  const office = new THREE.Group();
  office.name = "office";
  const updaters: SceneUpdater[] = [];
  const navigation = buildBaseNavigation();

  const waypoints: OfficeWaypoints = {
    entrance: {
      position: navigation.entranceInterior!.position.clone(),
      nodeId: "entranceInterior",
      facing: Math.PI,
    },
    reception: {
      position: new THREE.Vector3(-8.15, 0, 6.2),
      nodeId: "receptionFront",
      facing: Math.PI / 2,
    },
    kitchen: {
      position: new THREE.Vector3(-10.25, 0, -5.35),
      nodeId: "kitchenHub",
      facing: Math.PI / 2,
    },
    cioOffice: {
      position: navigation.cioHub!.position.clone(),
      nodeId: "cioHub",
      facing: Math.PI / 2,
    },
    bullpen: [],
    deskSlots: [],
    meetingSeats: [],
    navigation,
  };

  const layout = new OfficeLayoutManager(office, waypoints, updaters);
  return { office, waypoints, updaters, layout };
}
