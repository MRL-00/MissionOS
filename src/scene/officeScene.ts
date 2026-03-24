import * as THREE from "three";
import {
  CHAIR_OFFSET,
  CHAIR_SIT_INSET,
  createDesk,
  createGlassWall,
  createMeetingTable,
  createPlant,
} from "./furniture";
import { makeGlass, makeMaterial } from "./materials";
import type { DeskSlot, NavigationGraph, OfficeSceneResult, SceneUpdater } from "../types";

type VectorTuple = [number, number, number];

interface BoxOptions extends THREE.MeshStandardMaterialParameters {
  rotationY?: number;
}

interface DeskWaypointOptions {
  x: number;
  z: number;
  rotation?: number;
  chairSide?: -1 | 1;
  assignedTo?: string;
}

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

function createDeskWaypoint({
  x,
  z,
  rotation = 0,
  chairSide = 1,
  assignedTo,
}: DeskWaypointOptions): DeskSlot {
  const origin = new THREE.Vector3(x, 0, z);
  const sitDistance = CHAIR_OFFSET - CHAIR_SIT_INSET;
  const chairOffset = rotateYOffset(new THREE.Vector3(0, 0, chairSide * sitDistance), rotation);
  const approachOffset = rotateYOffset(new THREE.Vector3(0, 0, chairSide * (CHAIR_OFFSET + 1.02)), rotation);
  const waypoint: DeskSlot = {
    nodeId: `desk-${x}-${z}`,
    approach: origin.clone().add(approachOffset),
    sit: origin.clone().add(chairOffset),
    facing: rotation + (chairSide > 0 ? Math.PI : 0),
  };

  if (assignedTo) {
    waypoint.assignedTo = assignedTo;
  }

  return waypoint;
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

export function createOfficeScene(): OfficeSceneResult {
  const office = new THREE.Group();
  office.name = "office";
  const updaters: SceneUpdater[] = [];

  const palette = {
    floor: "#d8c4a7",
    trim: "#7e6550",
    wall: "#f3eadf",
    carpet: "#95acb0",
    meeting: "#b89b72",
    kitchen: "#d8d0c5",
  };

  const base = addBox(office, [28, 1, 20], [0, -0.5, 0], "#baa27f");
  base.receiveShadow = true;

  const floor = addBox(office, [26, 0.18, 18], [0, 0.09, 0], palette.floor);
  floor.receiveShadow = true;

  addBox(office, [10.2, 0.05, 6.8], [0, 0.13, 1.15], palette.carpet);
  addBox(office, [7.1, 0.05, 5.5], [8.7, 0.13, -4.4], palette.meeting);
  addBox(office, [4.8, 0.05, 5.3], [9.55, 0.13, 5.9], "#d4c7b4");

  const walls = new THREE.Group();
  office.add(walls);
  addBox(walls, [26, 3.2, 0.35], [0, 1.6, -9], palette.wall);
  addBox(walls, [0.35, 3.2, 18], [-13, 1.6, 0], palette.wall);
  addBox(walls, [14.8, 3.2, 0.35], [5.6, 1.6, 9], palette.wall);
  addBox(walls, [0.35, 3.2, 9.5], [13, 1.6, -4.25], palette.wall);
  addBox(walls, [0.35, 3.2, 6.7], [13, 1.6, 5.65], palette.wall);

  const cioGlassWestNorth = createGlassWall(2.4, 2.38);
  cioGlassWestNorth.position.set(6.45, 1.48, 4.05);
  cioGlassWestNorth.rotation.y = Math.PI / 2;
  office.add(cioGlassWestNorth);

  const cioGlassWestSouth = createGlassWall(2.05, 2.38);
  cioGlassWestSouth.position.set(6.45, 1.48, 7.45);
  cioGlassWestSouth.rotation.y = Math.PI / 2;
  office.add(cioGlassWestSouth);

  const cioGlassNorth = createGlassWall(5.35, 2.38);
  cioGlassNorth.position.set(9.1, 1.48, 8.08);
  office.add(cioGlassNorth);

  const cioGlassWestDoor = createGlassWall(1.05, 2.38);
  cioGlassWestDoor.position.set(6.45, 1.48, 5.9);
  cioGlassWestDoor.rotation.y = Math.PI / 2;
  office.add(cioGlassWestDoor);

  const meetingWallWestNorth = createGlassWall(2.1, 2.35);
  meetingWallWestNorth.position.set(5.2, 1.48, -2.55);
  meetingWallWestNorth.rotation.y = Math.PI / 2;
  office.add(meetingWallWestNorth);

  const meetingWallWestSouth = createGlassWall(2.1, 2.35);
  meetingWallWestSouth.position.set(5.2, 1.48, -6.15);
  meetingWallWestSouth.rotation.y = Math.PI / 2;
  office.add(meetingWallWestSouth);

  const meetingDoorGlass = createGlassWall(1.05, 2.35);
  meetingDoorGlass.position.set(5.2, 1.48, -4.35);
  meetingDoorGlass.rotation.y = Math.PI / 2;
  office.add(meetingDoorGlass);

  const meetingWallNorth = createGlassWall(7, 2.35);
  meetingWallNorth.position.set(8.7, 1.48, -1.68);
  office.add(meetingWallNorth);

  const meetingWallSouth = createGlassWall(7, 2.35);
  meetingWallSouth.position.set(8.7, 1.48, -7.12);
  office.add(meetingWallSouth);

  const meetingWallEast = createGlassWall(5.5, 2.35);
  meetingWallEast.position.set(12.18, 1.48, -4.4);
  meetingWallEast.rotation.y = Math.PI / 2;
  office.add(meetingWallEast);

  const desks = [
    createDesk({ x: -3.9, z: 3.15, chairSide: 1, accent: "#855f46" }),
    createDesk({ x: 0, z: 3.15, chairSide: 1, accent: "#91694e" }),
    createDesk({ x: 3.9, z: 3.15, chairSide: 1, accent: "#855f46" }),
    createDesk({ x: -3.9, z: -0.85, chairSide: 1, accent: "#91694e" }),
    createDesk({ x: 0, z: -0.85, chairSide: 1, accent: "#855f46" }),
    createDesk({ x: 3.9, z: -0.85, chairSide: 1, accent: "#91694e" }),
    createDesk({ x: -3.9, z: -4.85, chairSide: 1, accent: "#855f46" }),
    createDesk({ x: -1.1, z: -4.85, chairSide: 1, accent: "#91694e" }),
    createDesk({ x: 4.45, z: -2.45, chairSide: 1, accent: "#7e8f69", rotation: -Math.PI / 2 }),
    createDesk({ x: 9.55, z: 5.95, chairSide: -1, accent: "#6d4d38", rotation: Math.PI / 2, executive: true }),
  ];
  desks[8]!.scale.y = 1.08;
  desks.forEach((desk) => office.add(desk));

  const table = createMeetingTable();
  table.position.set(8.6, 0, -4.3);
  table.scale.x = 1.25;
  office.add(table);

  const whiteboard = createWhiteboard();
  whiteboard.position.set(11.78, 0, -4.4);
  whiteboard.rotation.y = -Math.PI / 2;
  office.add(whiteboard);

  const kanbanBoard = createKanbanBoard();
  kanbanBoard.position.set(4.95, 0, -8.78);
  kanbanBoard.rotation.y = Math.PI;
  office.add(kanbanBoard);

  const cioArt = createAbstractArt("#bccb96", "#d37b53");
  cioArt.position.set(12.15, 2.15, 5.85);
  cioArt.rotation.y = -Math.PI / 2;
  office.add(cioArt);

  const waterCooler = createWaterCooler();
  waterCooler.position.set(-6.9, 0, 7.15);
  office.add(waterCooler);

  [
    { x: -11.4, z: 7.4, scale: 1.25 },
    { x: 11.35, z: 7.3, scale: 1.38 },
    { x: 11.7, z: -7.6, scale: 1.42 },
    { x: -11.4, z: -7.4, scale: 1.24 },
    { x: -1.4, z: 7.2, scale: 1.02 },
    { x: 4.8, z: 7.15, scale: 0.92 },
    { x: -5.2, z: 4.95, scale: 0.8 },
    { x: 4.15, z: 5.25, scale: 0.82 },
    { x: 6.95, z: 6.95, scale: 0.9 },
    { x: 10.95, z: 4.15, scale: 0.95 },
  ].forEach(({ x, z, scale }) => {
    const plant = createPlant(scale);
    plant.position.set(x, 0, z);
    office.add(plant);
  });

  const cioPlant = createPlant(1.15);
  cioPlant.position.set(11.4, 0, 7.2);
  office.add(cioPlant);

  const { group: deck, updaters: deckUpdaters } = createBungyDeck();
  deck.position.set(14.45, 0.1, 1.05);
  office.add(deck);
  updaters.push(...deckUpdaters);

  const trims = new THREE.Group();
  office.add(trims);
  addBox(trims, [26.1, 0.22, 0.26], [0, 0.14, -8.9], palette.trim);
  addBox(trims, [26.1, 0.22, 0.26], [0, 0.14, 8.9], palette.trim);
  addBox(trims, [0.26, 0.22, 18.1], [-12.9, 0.14, 0], palette.trim);
  addBox(trims, [0.26, 0.22, 18.1], [12.9, 0.14, 0], palette.trim);

  const deckWindow = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 0.12), makeGlass("#d2e6eb"));
  deckWindow.position.set(13.05, 2.1, 1.05);
  deckWindow.rotation.y = Math.PI / 2;
  office.add(deckWindow);

  const deskSlots: DeskSlot[] = [
    createDeskWaypoint({ x: -3.9, z: 3.15, assignedTo: "pickle" }),
    createDeskWaypoint({ x: 0, z: 3.15, assignedTo: "zoe" }),
    createDeskWaypoint({ x: 3.9, z: 3.15, assignedTo: "ink" }),
    createDeskWaypoint({ x: -3.9, z: -0.85, assignedTo: "harry" }),
    createDeskWaypoint({ x: 0, z: -0.85, assignedTo: "kevin" }),
    createDeskWaypoint({ x: 3.9, z: -0.85, assignedTo: "danny" }),
    createDeskWaypoint({ x: -3.9, z: -4.85, assignedTo: "johnny" }),
    createDeskWaypoint({ x: -1.1, z: -4.85, assignedTo: "tommy" }),
    createDeskWaypoint({ x: 4.45, z: -2.45, rotation: -Math.PI / 2, assignedTo: "randall" }),
    createDeskWaypoint({ x: 9.55, z: 5.95, rotation: Math.PI / 2, chairSide: -1, assignedTo: "cio" }),
  ];

  const navigation: NavigationGraph = {
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
    scrumDeskHub: { position: new THREE.Vector3(2.35, 0, -2.45), links: [] },
    kitchenDoor: { position: new THREE.Vector3(-7.55, 0, -2.55), links: [] },
    kitchenHub: { position: new THREE.Vector3(-9.25, 0, -4.95), links: [] },
    meetingDoorOuter: { position: new THREE.Vector3(4.8, 0, -4.35), links: [] },
    meetingDoorInner: { position: new THREE.Vector3(5.95, 0, -4.35), links: [] },
    meetingNorthAisle: { position: new THREE.Vector3(8.6, 0, -2.2), links: [] },
    meetingSouthAisle: { position: new THREE.Vector3(8.6, 0, -6.4), links: [] },
    meetingWestAisle: { position: new THREE.Vector3(6.25, 0, -4.35), links: [] },
    meetingEastAisle: { position: new THREE.Vector3(10.95, 0, -4.35), links: [] },
    cioDoorOuter: { position: new THREE.Vector3(6.05, 0, 5.9), links: [] },
    cioDoorInner: { position: new THREE.Vector3(7.2, 0, 5.9), links: [] },
    cioHub: { position: new THREE.Vector3(9.45, 0, 5.9), links: [] },
  };

  deskSlots.forEach((desk) => {
    navigation[desk.nodeId] = {
      position: desk.approach.clone(),
      links: [],
    };
  });

  connect(navigation, "entranceExterior", "entranceInterior");
  connect(navigation, "entranceInterior", "receptionFront");
  connect(navigation, "receptionFront", "northHallWest");
  connect(navigation, "northHallWest", "northHallCenter");
  connect(navigation, "northHallCenter", "northHallEast");
  connect(navigation, "northHallWest", "centerHallWest");
  connect(navigation, "northHallCenter", "centerHallCenter");
  connect(navigation, "northHallEast", "centerHallEast");
  connect(navigation, "centerHallWest", "centerHallCenter");
  connect(navigation, "centerHallCenter", "centerHallEast");
  connect(navigation, "centerHallWest", "southHallWest");
  connect(navigation, "centerHallCenter", "southHallCenter");
  connect(navigation, "centerHallEast", "southHallEast");
  connect(navigation, "southHallWest", "southHallCenter");
  connect(navigation, "southHallCenter", "southHallEast");
  connect(navigation, "southHallWest", "deskAisleFarSouthWest");
  connect(navigation, "southHallCenter", "deskAisleFarSouthCenter");
  connect(navigation, "deskAisleFarSouthWest", "deskAisleFarSouthCenter");
  connect(navigation, "southHallCenter", "scrumDeskHub");
  connect(navigation, "scrumDeskHub", "southHallEast");
  connect(navigation, "southHallWest", "kitchenDoor");
  connect(navigation, "kitchenDoor", "kitchenHub");
  connect(navigation, "southHallEast", "meetingDoorOuter");
  connect(navigation, "meetingDoorOuter", "meetingDoorInner");
  connect(navigation, "meetingDoorInner", "meetingWestAisle");
  connect(navigation, "meetingWestAisle", "meetingNorthAisle");
  connect(navigation, "meetingWestAisle", "meetingSouthAisle");
  connect(navigation, "meetingNorthAisle", "meetingEastAisle");
  connect(navigation, "meetingSouthAisle", "meetingEastAisle");
  connect(navigation, "northHallEast", "cioDoorOuter");
  connect(navigation, "cioDoorOuter", "cioDoorInner");
  connect(navigation, "cioDoorInner", "cioHub");

  const [
    deskPickle,
    deskZoe,
    deskInk,
    deskHarry,
    deskKevin,
    deskDanny,
    deskJohnny,
    deskTommy,
    deskRandall,
    deskCio,
  ] = deskSlots;

  connect(navigation, deskPickle!.nodeId, "deskAisleNorthWest");
  connect(navigation, deskZoe!.nodeId, "deskAisleNorthCenter");
  connect(navigation, deskInk!.nodeId, "deskAisleNorthEast");
  connect(navigation, deskHarry!.nodeId, "deskAisleSouthWest");
  connect(navigation, deskKevin!.nodeId, "deskAisleSouthCenter");
  connect(navigation, deskDanny!.nodeId, "deskAisleSouthEast");
  connect(navigation, deskJohnny!.nodeId, "deskAisleFarSouthWest");
  connect(navigation, deskTommy!.nodeId, "deskAisleFarSouthCenter");
  connect(navigation, deskRandall!.nodeId, "scrumDeskHub");
  connect(navigation, deskCio!.nodeId, "cioHub");
  connect(navigation, "deskAisleNorthWest", "northHallWest");
  connect(navigation, "deskAisleNorthCenter", "northHallCenter");
  connect(navigation, "deskAisleNorthEast", "northHallEast");
  connect(navigation, "deskAisleSouthWest", "centerHallWest");
  connect(navigation, "deskAisleSouthCenter", "centerHallCenter");
  connect(navigation, "deskAisleSouthEast", "centerHallEast");

  const entranceInterior = navigation.entranceInterior!;
  const cioHub = navigation.cioHub!;

  const waypoints = {
    entrance: {
      position: entranceInterior.position.clone(),
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
      position: cioHub.position.clone(),
      nodeId: "cioHub",
      facing: Math.PI / 2,
    },
    bullpen: deskSlots.filter((desk) => desk.assignedTo && !["pickle", "randall", "cio"].includes(desk.assignedTo)).map((desk) => desk.sit.clone()),
    deskSlots,
    meetingSeats: [
      { nodeId: "meetingNorthAisle", position: new THREE.Vector3(5.8, 0, -2.55), facing: Math.PI, seated: false },
      { nodeId: "meetingNorthAisle", position: new THREE.Vector3(7.2, 0, -2.55), facing: Math.PI, seated: false },
      { nodeId: "meetingNorthAisle", position: new THREE.Vector3(8.6, 0, -2.55), facing: Math.PI, seated: false },
      { nodeId: "meetingNorthAisle", position: new THREE.Vector3(10, 0, -2.55), facing: Math.PI, seated: false },
      { nodeId: "meetingNorthAisle", position: new THREE.Vector3(11.4, 0, -2.55), facing: Math.PI, seated: false },
      { nodeId: "meetingSouthAisle", position: new THREE.Vector3(5.8, 0, -6.05), facing: 0, seated: false },
      { nodeId: "meetingSouthAisle", position: new THREE.Vector3(7.2, 0, -6.05), facing: 0, seated: false },
      { nodeId: "meetingSouthAisle", position: new THREE.Vector3(8.6, 0, -6.05), facing: 0, seated: false },
      { nodeId: "meetingSouthAisle", position: new THREE.Vector3(10, 0, -6.05), facing: 0, seated: false },
      { nodeId: "meetingSouthAisle", position: new THREE.Vector3(11.4, 0, -6.05), facing: 0, seated: false },
    ],
    navigation,
  };

  return { office, waypoints, updaters };
}
