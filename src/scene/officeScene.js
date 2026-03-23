import * as THREE from "three";
import { createChair, createDesk, createGlassWall, createKitchenCounter, createMeetingTable, createPlant } from "./furniture.js";
import { makeMaterial } from "./materials.js";

function addBox(parent, size, position, color, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), makeMaterial(color, options));
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
  const sitOffset = rotateYOffset(new THREE.Vector3(0, 0, 1.1), rotation);
  const standOffset = rotateYOffset(new THREE.Vector3(0, 0, 0.95), rotation);

  return {
    stand: origin.clone().add(standOffset),
    sit: origin.clone().add(sitOffset),
    facing: rotation + Math.PI,
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
  addBox(walls, [0.35, 3.2, 9], [13, 1.6, -4.5], palette.wall);
  addBox(walls, [5.2, 3.2, 0.35], [-10.4, 1.6, 9], palette.wall);
  addBox(walls, [0.35, 3.2, 5.5], [3.9, 1.6, -6.2], palette.wall);
  addBox(walls, [7.8, 3.2, 0.35], [7.3, 1.6, -3.45], palette.wall);
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

  const conferenceGlass = createGlassWall(5.5, 2.2);
  conferenceGlass.position.set(3.9, 1.4, -4.75);
  conferenceGlass.rotation.y = Math.PI / 2;
  office.add(conferenceGlass);

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

  const noticeBoard = addBox(office, [1.7, 1.1, 0.08], [-8.6, 1.75, -1.95], "#d7b469");
  noticeBoard.rotation.y = 0.02;

  const waterCooler = new THREE.Group();
  addBox(waterCooler, [0.7, 1.1, 0.7], [0, 0.55, 0], "#dfe8ec");
  addBox(waterCooler, [0.42, 0.7, 0.42], [0, 1.5, 0], "#8cc2dc", { transparent: true, opacity: 0.8 });
  waterCooler.position.set(-6.8, 0, 7.1);
  office.add(waterCooler);

  const plants = [
    [-11.4, 0, 7.4],
    [11.4, 0, 7.3],
    [11.7, 0, -7.6],
    [6.2, 0, -0.7],
  ];
  plants.forEach(([x, y, z], index) => {
    const plant = createPlant(1.3 + index * 0.08);
    plant.position.set(x, y, z);
    office.add(plant);
  });

  const trims = new THREE.Group();
  office.add(trims);
  addBox(trims, [26.1, 0.22, 0.26], [0, 0.14, -8.9], palette.trim);
  addBox(trims, [26.1, 0.22, 0.26], [0, 0.14, 8.9], palette.trim);
  addBox(trims, [0.26, 0.22, 18.1], [-12.9, 0.14, 0], palette.trim);
  addBox(trims, [0.26, 0.22, 18.1], [12.9, 0.14, 0], palette.trim);

  const deskSlots = [
    createDeskWaypoint({ x: -3.8, z: 3.1 }),
    createDeskWaypoint({ x: 0, z: 3.1 }),
    createDeskWaypoint({ x: 3.8, z: 3.1 }),
    createDeskWaypoint({ x: 8.2, z: 4.2, rotation: -Math.PI / 2 }),
    createDeskWaypoint({ x: -3.8, z: -0.7 }),
    createDeskWaypoint({ x: 0, z: -0.7 }),
    createDeskWaypoint({ x: 3.8, z: -0.7 }),
  ];

  const waypoints = {
    entrance: new THREE.Vector3(-9.55, 0, 7.4),
    bullpen: deskSlots.slice(0, 6).map((desk) => desk.sit.clone()),
    deskSlots,
    meetingSeats: [
      { position: new THREE.Vector3(7, 0, -2.7), facing: Math.PI },
      { position: new THREE.Vector3(8.6, 0, -2.7), facing: Math.PI },
      { position: new THREE.Vector3(10.2, 0, -2.7), facing: Math.PI },
      { position: new THREE.Vector3(7.8, 0, -5.9), facing: 0 },
    ],
    kitchen: new THREE.Vector3(-10.4, 0, -5.5),
  };

  return { office, waypoints };
}
