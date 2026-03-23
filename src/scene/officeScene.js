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

function createDeskWaypoint({ x, z, rotation = 0, chairSide = 1, id }) {
  const origin = new THREE.Vector3(x, 0, z);
  const sitOffset = rotateYOffset(new THREE.Vector3(0, 0.06, chairSide * 1.02), rotation);
  const approachOffset = rotateYOffset(new THREE.Vector3(0, 0, chairSide * 1.88), rotation);

  return {
    nodeId: id ?? `desk-${x}-${z}`,
    approach: origin.clone().add(approachOffset),
    sit: origin.clone().add(sitOffset),
    facing: rotation + (chairSide > 0 ? Math.PI : 0),
  };
}

function connect(graph, left, right) {
  graph[left].links.push(right);
  graph[right].links.push(left);
}

function addCollider(colliders, x, z, width, depth, padding = 0.12) {
  colliders.push({
    minX: x - width / 2 - padding,
    maxX: x + width / 2 + padding,
    minZ: z - depth / 2 - padding,
    maxZ: z + depth / 2 + padding,
  });
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

function createExecutiveDesk() {
  const desk = new THREE.Group();
  addBox(desk, [3.1, 0.18, 1.7], [0, 1.18, 0], "#6c4f38");
  addBox(desk, [1.2, 0.9, 0.8], [-1.05, 0.72, 0.2], "#4d3728");
  addBox(desk, [1.2, 0.9, 0.8], [1.05, 0.72, 0.2], "#4d3728");
  addBox(desk, [1.4, 0.1, 0.56], [0, 0.72, -0.46], "#543c2b");
  addBox(desk, [0.9, 0.56, 0.1], [0.62, 1.68, -0.45], "#27303b");
  addBox(desk, [0.8, 0.44, 0.02], [0.62, 1.68, -0.38], "#7fcbe6", { emissive: "#4d8ca7", emissiveIntensity: 0.35 });
  addBox(desk, [0.44, 0.05, 0.24], [0.62, 1.24, 0.05], "#d9d0c4");

  const chair = createChair("#4c5668");
  chair.position.set(0, 0, 1.16);
  chair.rotation.y = Math.PI;
  chair.scale.set(1.14, 1.08, 1.14);
  desk.add(chair);

  return desk;
}

function createBungyDeck() {
  const group = new THREE.Group();

  addBox(group, [1.95, 0.14, 1.45], [0, 0, 0], "#8b715c");
  addBox(group, [1.95, 0.05, 1.45], [0, 0.095, 0], "#c3a282");

  [-0.78, 0.78].forEach((x) => {
    [-0.46, 0.46].forEach((z) => {
      addBox(group, [0.12, 1.05, 0.12], [x, -0.6, z], "#4d3a2e");
    });
  });

  const railMaterial = "#55453a";
  const railPosts = [
    [-0.9, 0.46],
    [-0.9, -0.46],
    [0.9, 0.46],
    [0.9, -0.46],
    [-0.15, 0.46],
    [0.15, 0.46],
    [0.9, 0],
  ];
  railPosts.forEach(([x, z]) => addBox(group, [0.07, 0.68, 0.07], [x, 0.42, z], railMaterial));
  addBox(group, [1.78, 0.07, 0.07], [0, 0.72, 0.46], railMaterial);
  addBox(group, [1.78, 0.07, 0.07], [0, 0.72, -0.46], railMaterial);
  addBox(group, [0.07, 0.07, 0.92], [0.9, 0.72, 0], railMaterial);

  addBox(group, [0.14, 2.35, 0.14], [0.52, 1.16, 0], "#40332b");
  addBox(group, [0.92, 0.1, 0.1], [0.12, 2.28, 0], "#40332b");

  const cordGroup = new THREE.Group();
  cordGroup.position.set(-0.26, 2.04, 0);
  group.add(cordGroup);

  const cord = addCylinder(cordGroup, 0.022, 0.03, 1.9, [0, -0.95, 0], "#f2bf4a", 12);
  const jumper = new THREE.Group();
  addBox(jumper, [0.12, 0.26, 0.1], [0, 0, 0], "#2f3640");
  addBox(jumper, [0.08, 0.18, 0.08], [-0.05, -0.2, 0], "#2f3640");
  addBox(jumper, [0.08, 0.18, 0.08], [0.05, -0.2, 0], "#2f3640");
  addBox(jumper, [0.06, 0.16, 0.06], [-0.1, 0.02, 0], "#d2a07f");
  addBox(jumper, [0.06, 0.16, 0.06], [0.1, 0.02, 0], "#d2a07f");
  addCylinder(jumper, 0.07, 0.07, 0.12, [0, 0.18, 0], "#f0c29e", 10);
  jumper.position.set(0, -1.92, 0);
  jumper.rotation.z = -Math.PI / 3.2;
  cordGroup.add(jumper);

  return {
    group,
    jumper,
    cord,
    cordGroup,
  };
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
    lobby: "#d4c3ae",
  };

  const colliders = [];

  const base = addBox(office, [28, 1, 20], [0, -0.5, 0], "#baa27f");
  base.receiveShadow = true;

  const floor = addBox(office, [26, 0.18, 18], [0, 0.09, 0], palette.floor);
  floor.receiveShadow = true;

  addBox(office, [12.4, 0.05, 7.6], [-1.2, 0.13, 1.6], palette.carpet);
  addBox(office, [7, 0.05, 5.5], [8.7, 0.13, -4.4], palette.meeting);
  addBox(office, [4.7, 0.05, 4.6], [-9.4, 0.13, -4.2], palette.kitchen);
  addBox(office, [4.8, 0.05, 2.9], [-9.3, 0.13, 6.4], palette.lobby);
  addBox(office, [6.1, 0.05, 6.1], [9.45, 0.13, 5.5], "#c7d9de");

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

  const frontDoor = addBox(office, [2.2, 2.8, 0.12], [-9.55, 1.4, 8.84], "#7d5b41");
  frontDoor.rotation.y = Math.PI * 0.02;

  const cioGlassWestNorth = createGlassWall(2.7, 2.4);
  cioGlassWestNorth.position.set(6.2, 1.48, 7.0);
  cioGlassWestNorth.rotation.y = Math.PI / 2;
  office.add(cioGlassWestNorth);

  const cioGlassWestSouth = createGlassWall(2.2, 2.4);
  cioGlassWestSouth.position.set(6.2, 1.48, 3.5);
  cioGlassWestSouth.rotation.y = Math.PI / 2;
  office.add(cioGlassWestSouth);

  const cioGlassSouth = createGlassWall(6.8, 2.4);
  cioGlassSouth.position.set(9.6, 1.48, 2.45);
  office.add(cioGlassSouth);

  const meetingWallWestNorth = createGlassWall(2.1, 2.35);
  meetingWallWestNorth.position.set(5.2, 1.48, -2.55);
  meetingWallWestNorth.rotation.y = Math.PI / 2;
  office.add(meetingWallWestNorth);

  const meetingWallWestSouth = createGlassWall(2.1, 2.35);
  meetingWallWestSouth.position.set(5.2, 1.48, -6.15);
  meetingWallWestSouth.rotation.y = Math.PI / 2;
  office.add(meetingWallWestSouth);

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

  const bullpenDesks = [
    { x: -4.8, z: 3.0, chairSide: 1, accent: "#855f46" },
    { x: -1.0, z: 3.0, chairSide: 1, accent: "#91694e" },
    { x: 2.8, z: 3.0, chairSide: 1, accent: "#855f46" },
  ];
  bullpenDesks.forEach((desk) => office.add(createDesk(desk)));
  bullpenDesks.forEach(({ x, z }) => addCollider(colliders, x, z, 2.9, 1.6));

  const receptionDesk = createDesk({ x: -9.05, z: 6.25, chairSide: -1, accent: "#7b5a44" });
  receptionDesk.rotation.y = Math.PI;
  office.add(receptionDesk);
  addCollider(colliders, -9.05, 6.25, 2.9, 1.6);

  const executiveDesk = createExecutiveDesk();
  executiveDesk.position.set(10.05, 0, 5.2);
  executiveDesk.rotation.y = -Math.PI / 2;
  office.add(executiveDesk);
  addCollider(colliders, 10.05, 5.2, 1.8, 3.3, 0.16);

  const kitchen = createKitchenCounter();
  kitchen.position.set(-10.1, 0, -4.3);
  office.add(kitchen);
  addCollider(colliders, -10.1, -4.3, 3.2, 1.7);

  const table = createMeetingTable();
  table.position.set(8.7, 0, -4.4);
  office.add(table);
  addCollider(colliders, 8.7, -4.4, 5.3, 2.7, 0.16);

  [-1.6, 0, 1.6].forEach((x) => {
    const chairNorth = createChair("#556476");
    chairNorth.position.set(8.7 + x, 0, -2.55);
    office.add(chairNorth);

    const chairSouth = createChair("#556476");
    chairSouth.position.set(8.7 + x, 0, -6.25);
    chairSouth.rotation.y = Math.PI;
    office.add(chairSouth);
  });

  [-0.72, 0.72].forEach((z) => {
    const chairWest = createChair("#556476");
    chairWest.position.set(5.95, 0, -4.4 + z);
    chairWest.rotation.y = -Math.PI / 2;
    office.add(chairWest);

    const chairEast = createChair("#556476");
    chairEast.position.set(11.45, 0, -4.4 + z);
    chairEast.rotation.y = Math.PI / 2;
    office.add(chairEast);
  });

  const cioPlant = createPlant(1.18);
  cioPlant.position.set(12.1, 0, 7.35);
  office.add(cioPlant);

  const whiteboard = createWhiteboard();
  whiteboard.position.set(11.78, 0, -4.4);
  whiteboard.rotation.y = -Math.PI / 2;
  office.add(whiteboard);

  const receptionSign = createPoster("EpicShot Reception", "#cf8d5d");
  receptionSign.position.set(-9.15, 2.25, 8.78);
  office.add(receptionSign);

  const bungyPoster = createPoster("AJ Hackett Bungy", "#d15e43");
  bungyPoster.position.set(4.25, 2.1, -0.45);
  bungyPoster.rotation.y = Math.PI / 2;
  office.add(bungyPoster);

  const focusPoster = createPoster("Stay Curious", "#88a96f");
  focusPoster.position.set(-4.7, 2.1, 8.78);
  office.add(focusPoster);

  const velocityPoster = createPoster("Ship Clean x Fast", "#6d92b0");
  velocityPoster.position.set(-12.78, 2.15, 1.4);
  velocityPoster.rotation.y = Math.PI / 2;
  office.add(velocityPoster);

  const noticeBoard = addBox(office, [1.7, 1.1, 0.08], [-8.6, 1.75, -1.95], "#d7b469");
  noticeBoard.rotation.y = 0.02;

  const waterCooler = createWaterCooler();
  waterCooler.position.set(-6.9, 0, 6.35);
  office.add(waterCooler);

  const plants = [
    { x: -11.4, z: 7.4, scale: 1.25 },
    { x: 11.4, z: 7.3, scale: 1.38 },
    { x: 11.7, z: -7.6, scale: 1.42 },
    { x: -11.4, z: -7.4, scale: 1.24 },
    { x: -1.8, z: 7.2, scale: 1.02 },
    { x: 4.7, z: 7.15, scale: 0.96 },
    { x: -5.9, z: 1.1, scale: 0.86 },
    { x: 4.25, z: 0.65, scale: 0.82 },
    { x: -5.6, z: -0.6, scale: 0.92 },
    { x: 0.9, z: -0.95, scale: 0.82 },
    { x: 6.2, z: -7.4, scale: 0.98 },
  ];
  plants.forEach(({ x, z, scale }) => {
    const plant = createPlant(scale);
    plant.position.set(x, 0, z);
    office.add(plant);
  });

  const { group: deck, jumper, cord, cordGroup } = createBungyDeck();
  deck.position.set(14.25, 2.45, 1.4);
  office.add(deck);

  const trims = new THREE.Group();
  office.add(trims);
  addBox(trims, [26.1, 0.22, 0.26], [0, 0.14, -8.9], palette.trim);
  addBox(trims, [26.1, 0.22, 0.26], [0, 0.14, 8.9], palette.trim);
  addBox(trims, [0.26, 0.22, 18.1], [-12.9, 0.14, 0], palette.trim);
  addBox(trims, [0.26, 0.22, 18.1], [12.9, 0.14, 0], palette.trim);

  const deckWindow = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.45, 0.12), makeGlass("#d2e6eb"));
  deckWindow.position.set(13.02, 2.15, 1.4);
  deckWindow.rotation.y = Math.PI / 2;
  office.add(deckWindow);

  const deskSlots = [
    createDeskWaypoint({ x: -4.8, z: 3.0, chairSide: 1, id: "desk-pickle" }),
    createDeskWaypoint({ x: -1.0, z: 3.0, chairSide: 1, id: "desk-zoe" }),
    createDeskWaypoint({ x: 2.8, z: 3.0, chairSide: 1, id: "desk-ink" }),
    createDeskWaypoint({ x: 10.05, z: 5.2, rotation: -Math.PI / 2, chairSide: 1, id: "desk-cio" }),
  ];

  const navigation = {
    entranceDoor: { position: new THREE.Vector3(-9.55, 0, 7.35), links: [] },
    lobbyFront: { position: new THREE.Vector3(-9.2, 0, 6.5), links: [] },
    lobbyDesk: { position: new THREE.Vector3(-7.9, 0, 6.15), links: [] },
    northWest: { position: new THREE.Vector3(-5.2, 0, 5.6), links: [] },
    northMid: { position: new THREE.Vector3(-1.2, 0, 5.6), links: [] },
    northEast: { position: new THREE.Vector3(2.8, 0, 5.6), links: [] },
    eastHall: { position: new THREE.Vector3(4.95, 0, 5.6), links: [] },
    cioDoor: { position: new THREE.Vector3(6.05, 0, 5.2), links: [] },
    cioHall: { position: new THREE.Vector3(7.7, 0, 5.2), links: [] },
    cioNorth: { position: new THREE.Vector3(9.4, 0, 6.9), links: [] },
    bullpenWest: { position: new THREE.Vector3(-5.2, 0, 4.45), links: [] },
    bullpenMid: { position: new THREE.Vector3(-1.2, 0, 4.45), links: [] },
    bullpenEast: { position: new THREE.Vector3(2.8, 0, 4.45), links: [] },
    centerWest: { position: new THREE.Vector3(-5.2, 0, 1.55), links: [] },
    centerMid: { position: new THREE.Vector3(-1.2, 0, 1.55), links: [] },
    centerEast: { position: new THREE.Vector3(2.8, 0, 1.55), links: [] },
    kitchenDoor: { position: new THREE.Vector3(-6.15, 0, -2.55), links: [] },
    kitchenHall: { position: new THREE.Vector3(-8.3, 0, -2.55), links: [] },
    kitchenInside: { position: new THREE.Vector3(-8.9, 0, -4.85), links: [] },
    southMid: { position: new THREE.Vector3(-1.2, 0, -2.55), links: [] },
    southEast: { position: new THREE.Vector3(2.8, 0, -2.55), links: [] },
    meetingDoor: { position: new THREE.Vector3(5.05, 0, -4.4), links: [] },
    meetingNorth: { position: new THREE.Vector3(8.7, 0, -2.7), links: [] },
    meetingCenter: { position: new THREE.Vector3(8.7, 0, -4.4), links: [] },
    meetingSouth: { position: new THREE.Vector3(8.7, 0, -6.05), links: [] },
  };

  deskSlots.forEach((desk) => {
    navigation[desk.nodeId] = {
      position: desk.approach.clone(),
      links: [],
    };
  });

  connect(navigation, "entranceDoor", "lobbyFront");
  connect(navigation, "lobbyFront", "lobbyDesk");
  connect(navigation, "lobbyDesk", "northWest");
  connect(navigation, "northWest", "northMid");
  connect(navigation, "northMid", "northEast");
  connect(navigation, "northEast", "eastHall");
  connect(navigation, "eastHall", "cioDoor");
  connect(navigation, "cioDoor", "cioHall");
  connect(navigation, "cioHall", "cioNorth");

  connect(navigation, "northWest", "bullpenWest");
  connect(navigation, "northMid", "bullpenMid");
  connect(navigation, "northEast", "bullpenEast");
  connect(navigation, "bullpenWest", "bullpenMid");
  connect(navigation, "bullpenMid", "bullpenEast");

  connect(navigation, "bullpenWest", "centerWest");
  connect(navigation, "bullpenMid", "centerMid");
  connect(navigation, "bullpenEast", "centerEast");
  connect(navigation, "centerWest", "centerMid");
  connect(navigation, "centerMid", "centerEast");

  connect(navigation, "centerWest", "kitchenDoor");
  connect(navigation, "kitchenDoor", "kitchenHall");
  connect(navigation, "kitchenHall", "kitchenInside");

  connect(navigation, "centerMid", "southMid");
  connect(navigation, "centerEast", "southEast");
  connect(navigation, "southMid", "southEast");
  connect(navigation, "southEast", "meetingDoor");
  connect(navigation, "meetingDoor", "meetingNorth");
  connect(navigation, "meetingDoor", "meetingCenter");
  connect(navigation, "meetingCenter", "meetingSouth");
  connect(navigation, "meetingNorth", "meetingCenter");

  connect(navigation, deskSlots[0].nodeId, "bullpenWest");
  connect(navigation, deskSlots[1].nodeId, "bullpenMid");
  connect(navigation, deskSlots[2].nodeId, "bullpenEast");
  connect(navigation, deskSlots[3].nodeId, "cioHall");

  const waypoints = {
    entrance: { position: navigation.entranceDoor.position.clone(), nodeId: "entranceDoor", facing: Math.PI },
    bullpen: deskSlots.slice(0, 3).map((desk) => desk.sit.clone()),
    deskSlots,
    meetingSeats: [
      {
        nodeId: "meetingNorth",
        position: new THREE.Vector3(7.1, 0.03, -2.78),
        facing: Math.PI,
      },
      {
        nodeId: "meetingNorth",
        position: new THREE.Vector3(8.7, 0.03, -2.78),
        facing: Math.PI,
      },
      {
        nodeId: "meetingNorth",
        position: new THREE.Vector3(10.3, 0.03, -2.78),
        facing: Math.PI,
      },
      {
        nodeId: "meetingSouth",
        position: new THREE.Vector3(8.7, 0.03, -6.02),
        facing: 0,
      },
    ],
    kitchen: { position: new THREE.Vector3(-9.7, 0, -5.35), nodeId: "kitchenInside", facing: Math.PI / 2 },
    reception: { position: new THREE.Vector3(-8.35, 0, 6.2), nodeId: "lobbyDesk", facing: Math.PI / 2 },
    navigation,
    colliders,
  };

  return {
    office,
    waypoints,
    bungyJumper: {
      group: jumper,
      cord,
      cordGroup,
      baseY: jumper.position.y,
      baseCordLength: cord.scale.y,
    },
  };
}
