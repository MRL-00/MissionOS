import * as THREE from "three";
import { createChair, createDesk, createGlassWall, createKitchenCounter, createMeetingTable, createPlant } from "./furniture.js";
import { makeGlass, makeMaterial } from "./materials.js";

function addBox(parent, size, position, color, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), makeMaterial(color, options));
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, radiusTop, radiusBottom, height, position, color, radialSegments = 8, options = {}) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
    makeMaterial(color, options),
  );
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function rotateYOffset(vector, rotation) {
  return vector.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
}

function createDeskWaypoint({ x, z, rotation = 0 }) {
  const origin = new THREE.Vector3(x, 0, z);
  const sitOffset = rotateYOffset(new THREE.Vector3(0, 0.06, 1.02), rotation);
  const approachOffset = rotateYOffset(new THREE.Vector3(0, 0, 1.85), rotation);

  return {
    nodeId: `desk-${x}-${z}`,
    approach: origin.clone().add(approachOffset),
    sit: origin.clone().add(sitOffset),
    facing: rotation + Math.PI,
  };
}

function connect(graph, left, right) {
  graph[left].links.push(right);
  graph[right].links.push(left);
}

function createWhiteboard() {
  const group = new THREE.Group();
  addBox(group, [2.8, 1.4, 0.08], [0, 1.9, 0], "#f7f7f2");
  addBox(group, [2.98, 1.58, 0.06], [0, 1.9, -0.03], "#9f8f7e");
  addBox(group, [0.55, 0.05, 0.05], [-0.65, 1.95, 0.05], "#4e9ac9");
  addBox(group, [0.42, 0.05, 0.05], [-0.25, 1.68, 0.05], "#d95b5b");
  addBox(group, [0.78, 0.05, 0.05], [0.4, 2.2, 0.05], "#5d8c62");
  return group;
}

function createWaterCooler() {
  const group = new THREE.Group();
  addBox(group, [0.72, 1.12, 0.72], [0, 0.56, 0], "#dfe8ec");
  addBox(group, [0.44, 0.72, 0.44], [0, 1.52, 0], "#8cc2dc", { transparent: true, opacity: 0.82 });
  addBox(group, [0.12, 0.06, 0.12], [-0.12, 0.96, 0.34], "#4774b0");
  addBox(group, [0.12, 0.06, 0.12], [0.12, 0.96, 0.34], "#d87b5f");
  return group;
}

function createPoster(label, accent = "#d7b469") {
  const poster = new THREE.Group();
  addBox(poster, [1.9, 1.25, 0.06], [0, 0, 0], accent);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 320;
  const context = canvas.getContext("2d");
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

function createBungyDeck() {
  const group = new THREE.Group();
  addBox(group, [2.8, 0.2, 2.3], [0, 0, 0], "#7f6857");
  [-1.1, 1.1].forEach((x) => {
    [-0.85, 0.85].forEach((z) => {
      addBox(group, [0.14, 1.25, 0.14], [x, -0.72, z], "#4b3b2f");
    });
  });

  addBox(group, [0.12, 1.1, 2.3], [-1.34, 0.46, 0], "#524439");
  addBox(group, [0.12, 1.1, 2.3], [1.34, 0.46, 0], "#524439");
  addBox(group, [2.8, 0.12, 0.12], [0, 0.98, 1.09], "#524439");
  addBox(group, [2.8, 0.12, 0.12], [0, 0.98, -1.09], "#524439");

  addBox(group, [0.18, 3.2, 0.18], [0.9, 1.5, 0], "#3f352d");
  addBox(group, [1.2, 0.14, 0.14], [0.3, 3, 0], "#3f352d");

  const cord = addCylinder(group, 0.03, 0.05, 4.6, [0.88, 0.7, 0], "#f1be47", 10);
  cord.rotation.z = Math.PI / 18;

  const jumper = new THREE.Group();
  addBox(jumper, [0.22, 0.5, 0.18], [0, 0, 0], "#2a2f39");
  addBox(jumper, [0.14, 0.34, 0.14], [-0.08, -0.36, 0], "#2a2f39");
  addBox(jumper, [0.14, 0.34, 0.14], [0.08, -0.36, 0], "#2a2f39");
  addBox(jumper, [0.12, 0.32, 0.12], [-0.17, 0.06, 0], "#da8b60");
  addBox(jumper, [0.12, 0.32, 0.12], [0.17, 0.06, 0], "#da8b60");
  addCylinder(jumper, 0.12, 0.12, 0.22, [0, 0.4, 0], "#f1c39b", 10);
  jumper.position.set(0.5, -1.35, -0.28);
  jumper.rotation.z = -Math.PI / 3;
  group.add(jumper);

  const sign = createPoster("EpicShot x AJ Hackett", "#d15e43");
  sign.position.set(-0.1, 1.1, -0.92);
  sign.rotation.y = Math.PI;
  sign.scale.setScalar(0.72);
  group.add(sign);

  return group;
}

export function createOfficeScene() {
  const office = new THREE.Group();
  office.name = "office";

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

  addBox(office, [10, 0.05, 7], [0, 0.13, 1], palette.carpet);
  addBox(office, [7, 0.05, 5.5], [8.7, 0.13, -4.4], palette.meeting);
  addBox(office, [4.7, 0.05, 4.6], [-9.4, 0.13, -4.2], palette.kitchen);

  const walls = new THREE.Group();
  office.add(walls);
  addBox(walls, [26, 3.2, 0.35], [0, 1.6, -9], palette.wall);
  addBox(walls, [0.35, 3.2, 18], [-13, 1.6, 0], palette.wall);
  addBox(walls, [14.8, 3.2, 0.35], [5.6, 1.6, 9], palette.wall);
  addBox(walls, [0.35, 3.2, 9.5], [13, 1.6, -4.25], palette.wall);
  addBox(walls, [0.35, 3.2, 6.7], [13, 1.6, 5.65], palette.wall);
  addBox(walls, [5.2, 3.2, 0.35], [-10.4, 1.6, 9], palette.wall);

  addBox(walls, [4.8, 3.2, 0.35], [-8.8, 1.6, -1.7], palette.wall);
  addBox(walls, [0.35, 3.2, 5], [-6.4, 1.6, -4.1], palette.wall);

  addBox(walls, [2.2, 3.2, 0.35], [-11.9, 1.6, 9], palette.wall);
  addBox(walls, [2.2, 3.2, 0.35], [-7.2, 1.6, 9], palette.wall);

  const door = addBox(office, [2.2, 2.8, 0.12], [-9.55, 1.4, 8.84], "#7d5b41");
  door.rotation.y = Math.PI * 0.02;

  const managerGlass1 = createGlassWall(6.3, 2.4);
  managerGlass1.position.set(6.45, 1.48, -0.8);
  managerGlass1.rotation.y = Math.PI / 2;
  office.add(managerGlass1);

  const managerGlass2 = createGlassWall(8.5, 2.4);
  managerGlass2.position.set(8.9, 1.48, 3.45);
  office.add(managerGlass2);

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
    { x: -3.8, z: 3.1, chairSide: 1, accent: "#855f46" },
    { x: 0, z: 3.1, chairSide: 1, accent: "#91694e" },
    { x: 3.8, z: 3.1, chairSide: 1, accent: "#855f46" },
    { x: -3.8, z: -0.7, chairSide: 1, accent: "#91694e" },
    { x: 0, z: -0.7, chairSide: 1, accent: "#855f46" },
    { x: 3.8, z: -0.7, chairSide: 1, accent: "#91694e" },
  ];
  desks.forEach((desk) => office.add(createDesk(desk)));

  const managerDesk = createDesk({ x: 8.2, z: 4.2, chairSide: 1, accent: "#70533d" });
  managerDesk.rotation.y = -Math.PI / 2;
  office.add(managerDesk);

  const table = createMeetingTable();
  table.position.set(8.6, 0, -4.3);
  office.add(table);

  [-1.6, 0, 1.6].forEach((x) => {
    const chairTop = createChair("#556476");
    chairTop.position.set(8.6 + x, 0, -2.55);
    office.add(chairTop);

    const chairBottom = createChair("#556476");
    chairBottom.position.set(8.6 + x, 0, -6.05);
    chairBottom.rotation.y = Math.PI;
    office.add(chairBottom);
  });

  [-0.65, 0.65].forEach((z) => {
    const chairLeft = createChair("#556476");
    chairLeft.position.set(5.75, 0, -4.3 + z);
    chairLeft.rotation.y = -Math.PI / 2;
    office.add(chairLeft);

    const chairRight = createChair("#556476");
    chairRight.position.set(11.45, 0, -4.3 + z);
    chairRight.rotation.y = Math.PI / 2;
    office.add(chairRight);
  });

  const receptionDesk = createDesk({ x: -9.25, z: 5.25, chairSide: -1, accent: "#7b5a44" });
  receptionDesk.rotation.y = Math.PI / 2;
  office.add(receptionDesk);

  const kitchen = createKitchenCounter();
  kitchen.position.set(-10.1, 0, -4.3);
  office.add(kitchen);

  const whiteboard = createWhiteboard();
  whiteboard.position.set(11.78, 0, -4.4);
  whiteboard.rotation.y = -Math.PI / 2;
  office.add(whiteboard);

  const receptionArt = createPoster("EpicShot Reception", "#cf8d5d");
  receptionArt.position.set(-2.8, 2.2, 8.78);
  office.add(receptionArt);

  const meetingPoster = createPoster("AJ Hackett Bungy", "#d15e43");
  meetingPoster.position.set(4.25, 2.1, -0.45);
  meetingPoster.rotation.y = Math.PI / 2;
  office.add(meetingPoster);

  const noticeBoard = addBox(office, [1.7, 1.1, 0.08], [-8.6, 1.75, -1.95], "#d7b469");
  noticeBoard.rotation.y = 0.02;

  const waterCooler = createWaterCooler();
  waterCooler.position.set(-6.8, 0, 7.1);
  office.add(waterCooler);

  const plants = [
    { x: -11.4, z: 7.4, scale: 1.25 },
    { x: 11.4, z: 7.3, scale: 1.38 },
    { x: 11.7, z: -7.6, scale: 1.42 },
    { x: -11.4, z: -7.4, scale: 1.24 },
    { x: -1.4, z: 7.25, scale: 1.02 },
    { x: 4.9, z: 7.1, scale: 0.92 },
    { x: -3.8, z: 2.25, scale: 0.7 },
    { x: 3.8, z: -1.55, scale: 0.7 },
  ];
  plants.forEach(({ x, z, scale }) => {
    const plant = createPlant(scale);
    plant.position.set(x, 0, z);
    office.add(plant);
  });

  const deck = createBungyDeck();
  deck.position.set(14.7, 2.4, 1.6);
  office.add(deck);

  const trims = new THREE.Group();
  office.add(trims);
  addBox(trims, [26.1, 0.22, 0.26], [0, 0.14, -8.9], palette.trim);
  addBox(trims, [26.1, 0.22, 0.26], [0, 0.14, 8.9], palette.trim);
  addBox(trims, [0.26, 0.22, 18.1], [-12.9, 0.14, 0], palette.trim);
  addBox(trims, [0.26, 0.22, 18.1], [12.9, 0.14, 0], palette.trim);

  const deckWindow = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 0.12), makeGlass("#d2e6eb"));
  deckWindow.position.set(13.05, 2.1, 1.6);
  deckWindow.rotation.y = Math.PI / 2;
  office.add(deckWindow);

  const deskSlots = [
    createDeskWaypoint({ x: -3.8, z: 3.1 }),
    createDeskWaypoint({ x: 0, z: 3.1 }),
    createDeskWaypoint({ x: 3.8, z: 3.1 }),
    createDeskWaypoint({ x: 8.2, z: 4.2, rotation: -Math.PI / 2 }),
    createDeskWaypoint({ x: -3.8, z: -0.7 }),
    createDeskWaypoint({ x: 0, z: -0.7 }),
    createDeskWaypoint({ x: 3.8, z: -0.7 }),
  ];

  const navigation = {
    entrance: { position: new THREE.Vector3(-9.55, 0, 7.4), links: [] },
    reception: { position: new THREE.Vector3(-8.2, 0, 5.2), links: [] },
    northHall: { position: new THREE.Vector3(0, 0, 4.95), links: [] },
    centerHall: { position: new THREE.Vector3(0, 0, 1.4), links: [] },
    southHall: { position: new THREE.Vector3(0, 0, -2.55), links: [] },
    kitchenHall: { position: new THREE.Vector3(-7.7, 0, -2.55), links: [] },
    meetingDoor: { position: new THREE.Vector3(4.65, 0, -2.55), links: [] },
    meetingHubNorth: { position: new THREE.Vector3(8.6, 0, -1.45), links: [] },
    meetingHubSouth: { position: new THREE.Vector3(8.6, 0, -7.0), links: [] },
    meetingHubWest: { position: new THREE.Vector3(5.3, 0, -4.3), links: [] },
    meetingHubEast: { position: new THREE.Vector3(11.9, 0, -4.3), links: [] },
    eastNorth: { position: new THREE.Vector3(6.9, 0, 4.95), links: [] },
    managerDoor: { position: new THREE.Vector3(6.9, 0, 3), links: [] },
  };

  deskSlots.forEach((desk) => {
    navigation[desk.nodeId] = {
      position: desk.approach.clone(),
      links: [],
    };
  });

  connect(navigation, "entrance", "reception");
  connect(navigation, "reception", "northHall");
  connect(navigation, "northHall", "centerHall");
  connect(navigation, "centerHall", "southHall");
  connect(navigation, "southHall", "kitchenHall");
  connect(navigation, "southHall", "meetingDoor");
  connect(navigation, "meetingDoor", "meetingHubNorth");
  connect(navigation, "meetingDoor", "meetingHubWest");
  connect(navigation, "meetingHubNorth", "meetingHubSouth");
  connect(navigation, "meetingHubNorth", "meetingHubEast");
  connect(navigation, "meetingHubSouth", "meetingHubWest");
  connect(navigation, "northHall", "eastNorth");
  connect(navigation, "eastNorth", "managerDoor");

  connect(navigation, deskSlots[0].nodeId, "northHall");
  connect(navigation, deskSlots[1].nodeId, "northHall");
  connect(navigation, deskSlots[2].nodeId, "northHall");
  connect(navigation, deskSlots[3].nodeId, "managerDoor");
  connect(navigation, deskSlots[4].nodeId, "centerHall");
  connect(navigation, deskSlots[5].nodeId, "centerHall");
  connect(navigation, deskSlots[6].nodeId, "centerHall");

  const waypoints = {
    entrance: { position: navigation.entrance.position.clone(), nodeId: "entrance", facing: Math.PI },
    bullpen: deskSlots.slice(0, 6).map((desk) => desk.sit.clone()),
    deskSlots,
    meetingSeats: [
      {
        nodeId: "meetingHubNorth",
        position: new THREE.Vector3(7, 0.03, -2.75),
        facing: Math.PI,
      },
      {
        nodeId: "meetingHubNorth",
        position: new THREE.Vector3(8.6, 0.03, -2.75),
        facing: Math.PI,
      },
      {
        nodeId: "meetingHubNorth",
        position: new THREE.Vector3(10.2, 0.03, -2.75),
        facing: Math.PI,
      },
      {
        nodeId: "meetingHubSouth",
        position: new THREE.Vector3(7.8, 0.03, -5.85),
        facing: 0,
      },
    ],
    kitchen: { position: new THREE.Vector3(-10.4, 0, -5.5), nodeId: "kitchenHall", facing: Math.PI / 2 },
    navigation,
  };

  return { office, waypoints };
}
