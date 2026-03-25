import * as THREE from "three";
import { makeGlass, makeMaterial } from "./materials";
import { enableShadows } from "../utils";

export interface DeskOptions {
  x: number;
  z: number;
  chairSide?: -1 | 1;
  accent?: string;
  rotation?: number;
  executive?: boolean;
}

export interface ChairOptions {
  color?: string;
  rotation?: number;
}

export const CHAIR_SEAT_HEIGHT = 0.66;
export const CHAIR_OFFSET = 1.48;
export const CHAIR_SIT_INSET = 0;

export function createDesk({
  x,
  z,
  chairSide = 1,
  accent = "#7e5b43",
  rotation = 0,
  executive = false,
}: DeskOptions): THREE.Group {
  const group = new THREE.Group();
  const wood = makeMaterial(accent);
  const dark = makeMaterial("#504030");
  const monitorMaterial = makeMaterial("#2d3542");
  const screenMaterial = makeMaterial("#7fcee8", { emissive: "#498eb6", emissiveIntensity: 0.3 }).clone();

  const deskWidth = executive ? 3.1 : 2.6;
  const deskDepth = executive ? 1.6 : 1.4;
  const monitorX = executive ? 0.58 : 0.42;
  const monitorZ = executive ? -0.18 : -0.08;

  const top = new THREE.Mesh(new THREE.BoxGeometry(deskWidth, 0.18, deskDepth), wood);
  top.position.y = 1.16;
  group.add(top);

  [-1, 1].forEach((dx) => {
    [-1, 1].forEach((dz) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.08, 0.14), dark);
      leg.position.set(dx * (deskWidth * 0.42), 0.54, dz * (deskDepth * 0.39));
      group.add(leg);
    });
  });

  const drawers = new THREE.Mesh(
    new THREE.BoxGeometry(executive ? 0.66 : 0.56, 0.8, executive ? 1.02 : 0.92),
    dark,
  );
  drawers.position.set(-deskWidth * 0.31, 0.72, 0.14);
  group.add(drawers);

  const monitorStem = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.14), monitorMaterial);
  monitorStem.position.set(monitorX, 1.32, monitorZ - 0.02);
  group.add(monitorStem);

  const monitor = new THREE.Mesh(
    new THREE.BoxGeometry(executive ? 0.96 : 0.78, executive ? 0.56 : 0.48, 0.1),
    monitorMaterial,
  );
  monitor.position.set(monitorX, 1.6, monitorZ);
  group.add(monitor);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(executive ? 0.88 : 0.7, executive ? 0.48 : 0.4, 0.02),
    screenMaterial,
  );
  screen.name = "desk-screen";
  screen.userData.role = "desk-screen";
  screen.position.set(monitorX, 1.6, monitorZ + 0.06);
  group.add(screen);

  const keyboard = new THREE.Mesh(
    new THREE.BoxGeometry(executive ? 0.78 : 0.68, 0.05, 0.3),
    makeMaterial("#f3f6fa"),
  );
  keyboard.position.set(monitorX - (executive ? 0.18 : 0.2), 1.22, executive ? 0.64 : 0.54);
  group.add(keyboard);

  [-0.18, 0, 0.18].forEach((x) => {
    const keyStripe = new THREE.Mesh(
      new THREE.BoxGeometry(executive ? 0.18 : 0.15, 0.012, 0.22),
      makeMaterial("#aeb8c2"),
    );
    keyStripe.position.set(
      monitorX - (executive ? 0.18 : 0.2) + x,
      1.255,
      executive ? 0.64 : 0.54,
    );
    group.add(keyStripe);
  });

  const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.18), makeMaterial("#ffffff"));
  mouse.position.set(monitorX + (executive ? 0.24 : 0.18), 1.21, executive ? 0.62 : 0.52);
  group.add(mouse);

  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 10), makeMaterial("#f7efe4"));
  mug.position.set(-0.2, 1.28, -0.2);
  group.add(mug);

  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return enableShadows(group);
}

export function createChair({ color = "#57677b", rotation = 0 }: ChairOptions = {}): THREE.Group {
  const group = new THREE.Group();
  const material = makeMaterial(color);
  const dark = makeMaterial("#3d4856");

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.14, 0.76), material);
  seat.position.y = CHAIR_SEAT_HEIGHT;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.84, 0.14), material);
  back.position.set(0, 1.06, -0.31);
  group.add(back);

  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.52, 0.12), dark);
  stem.position.y = 0.3;
  group.add(stem);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 10), dark);
  base.position.y = 0.04;
  group.add(base);

  group.rotation.y = rotation;
  return enableShadows(group);
}

export function createMeetingTable(): THREE.Group {
  const group = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.2, 2.1), makeMaterial("#86634a"));
  top.position.y = 1.08;
  group.add(top);

  [-1.8, 1.8].forEach((x) => {
    [-0.65, 0.65].forEach((z) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1, 0.18), makeMaterial("#4d3827"));
      leg.position.set(x, 0.5, z);
      group.add(leg);
    });
  });

  return enableShadows(group);
}

export function createPlant(height = 1.5): THREE.Group {
  const group = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 6), makeMaterial("#a55f38"));
  pot.position.y = 0.25;
  group.add(pot);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, height * 0.55, 6), makeMaterial("#67834d"));
  stem.position.y = 0.55 + height * 0.27;
  group.add(stem);

  const leafMaterial = makeMaterial("#6a9456");
  [
    { x: -0.18, y: height * 0.68, z: 0.02, rotationZ: Math.PI / 5, scale: 0.9 },
    { x: 0.18, y: height * 0.74, z: -0.08, rotationZ: -Math.PI / 4.5, scale: 1 },
    { x: -0.04, y: height * 0.9, z: 0.16, rotationX: Math.PI / 8, scale: 0.82 },
    { x: 0.08, y: height * 0.84, z: -0.2, rotationX: -Math.PI / 7, scale: 0.78 },
  ].forEach(({ x, y, z, rotationX = 0, rotationZ = 0, scale }) => {
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(0.26 * scale, height * 0.5 * scale, 0.18 * scale),
      leafMaterial,
    );
    leaf.position.set(x, y, z);
    leaf.rotation.x = rotationX;
    leaf.rotation.z = rotationZ;
    group.add(leaf);
  });

  return enableShadows(group);
}

export function createKitchenCounter(): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 1.1), makeMaterial("#b8b3ac"));
  base.position.y = 0.55;
  group.add(base);

  const top = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 1.18), makeMaterial("#6f6456"));
  top.position.y = 1.16;
  group.add(top);

  const fridge = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.1, 0.95), makeMaterial("#eef3f6"));
  fridge.position.set(-1.45, 1.05, 0);
  group.add(fridge);

  const machine = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.42), makeMaterial("#3f4751"));
  machine.position.set(0.72, 1.5, 0);
  group.add(machine);

  return enableShadows(group);
}

export function createGlassWall(width: number, height: number, depth = 0.08): THREE.Mesh {
  const glass = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), makeGlass());
  glass.castShadow = true;
  glass.receiveShadow = true;
  return glass;
}
