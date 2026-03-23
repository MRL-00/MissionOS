import * as THREE from "three";
import { makeGlass, makeMaterial } from "./materials.js";
import { enableShadows } from "../utils.js";

export function createDesk({ x, z, chairSide = 1, accent = "#7e5b43" }) {
  const group = new THREE.Group();
  const wood = makeMaterial(accent);
  const dark = makeMaterial("#504030");
  const monitorMaterial = makeMaterial("#2d3542");
  const screenMaterial = makeMaterial("#7fcee8", { emissive: "#498eb6", emissiveIntensity: 0.3 });

  const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 1.4), wood);
  top.position.y = 1.16;
  group.add(top);

  [-1, 1].forEach((dx) => {
    [-1, 1].forEach((dz) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.08, 0.14), dark);
      leg.position.set(dx * 1.1, 0.54, dz * 0.55);
      group.add(leg);
    });
  });

  const drawers = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.8, 0.92), dark);
  drawers.position.set(-0.82, 0.72, 0.14);
  group.add(drawers);

  const monitorStem = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.14), monitorMaterial);
  monitorStem.position.set(0.42, 1.32, -0.1);
  group.add(monitorStem);

  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.48, 0.1), monitorMaterial);
  monitor.position.set(0.42, 1.6, -0.08);
  group.add(monitor);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.02), screenMaterial);
  screen.position.set(0.42, 1.6, -0.02);
  group.add(screen);

  const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.22), makeMaterial("#dad0c6"));
  keyboard.position.set(0.42, 1.22, 0.2);
  group.add(keyboard);

  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 10), makeMaterial("#f7efe4"));
  mug.position.set(-0.2, 1.28, -0.2);
  group.add(mug);

  const chair = createChair();
  chair.position.set(0, 0, chairSide * 1.1);
  chair.rotation.y = chairSide > 0 ? Math.PI : 0;
  group.add(chair);

  group.position.set(x, 0, z);
  return enableShadows(group);
}

export function createChair(color = "#57677b") {
  const group = new THREE.Group();
  const material = makeMaterial(color);
  const dark = makeMaterial("#3d4856");

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.14, 0.76), material);
  seat.position.y = 0.66;
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

  return enableShadows(group);
}

export function createMeetingTable() {
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

export function createPlant(height = 1.5) {
  const group = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 6), makeMaterial("#a55f38"));
  pot.position.y = 0.25;
  group.add(pot);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, height * 0.55, 6), makeMaterial("#67834d"));
  stem.position.y = 0.55 + height * 0.27;
  group.add(stem);

  const leaves = new THREE.Mesh(new THREE.BoxGeometry(0.9, height * 0.5, 0.9), makeMaterial("#6a9456"));
  leaves.position.y = height * 0.75;
  group.add(leaves);

  return enableShadows(group);
}

export function createKitchenCounter() {
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

export function createGlassWall(width, height, depth = 0.08) {
  const glass = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), makeGlass());
  glass.castShadow = true;
  glass.receiveShadow = true;
  return glass;
}
