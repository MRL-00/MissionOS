import * as THREE from "three";
import type { Accessory, AgentAppearance, AgentConfig, BuiltAgent } from "../types";
import { makeMaterial } from "../scene/materials";
import { enableShadows } from "../utils";
import { createFishAgent } from "./fishFactory";

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  parent.add(mesh);
  return mesh;
}

function createHead(shape: AgentAppearance["headShape"], color: string): THREE.Mesh {
  let geometry: THREE.BufferGeometry;

  if (shape === "round") {
    geometry = new THREE.SphereGeometry(0.33, 14, 12);
  } else if (shape === "oval") {
    geometry = new THREE.SphereGeometry(0.3, 14, 12);
    geometry.applyMatrix4(new THREE.Matrix4().makeScale(1, 1.2, 0.92));
  } else {
    geometry = new THREE.BoxGeometry(0.62, 0.62, 0.62);
  }

  return new THREE.Mesh(geometry, makeMaterial(color));
}

function createFace(shape: AgentAppearance["headShape"], accessories: Accessory[] = []): THREE.Group {
  const group = new THREE.Group();
  const dark = makeMaterial("#242730");
  const mouthMaterial = makeMaterial("#5a3a30");
  const hasBeard = accessories.includes("beard");
  const faceZ = shape === "square" ? 0.322 : 0.282;
  const eyeY = shape === "oval" ? 0.05 : 0.03;
  const mouthY = hasBeard ? -0.07 : shape === "oval" ? -0.14 : -0.12;
  const mouthZ = hasBeard ? faceZ + 0.03 : faceZ;

  [-0.12, 0.12].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.02), dark);
    eye.position.set(x, eyeY, faceZ);
    group.add(eye);
  });

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(hasBeard ? 0.1 : 0.11, 0.016, 0.02), mouthMaterial);
  mouth.position.set(0, mouthY, mouthZ);
  group.add(mouth);

  return group;
}

function createHair(style: AgentAppearance["hairStyle"], color: string): THREE.Group {
  const group = new THREE.Group();
  const material = makeMaterial(color);

  if (style === "none") {
    return group;
  }

  if (style === "mohawk") {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.5), material);
    strip.position.set(0, 0.32, 0);
    group.add(strip);
    return group;
  }

  if (style === "messy") {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.64), material);
    base.position.set(0, 0.22, 0);
    group.add(base);

    [
      { x: -0.2, y: 0.35, z: -0.08, rx: 0.18, rz: -0.22 },
      { x: -0.02, y: 0.38, z: 0.14, rx: -0.12, rz: 0.14 },
      { x: 0.18, y: 0.34, z: -0.16, rx: 0.1, rz: 0.28 },
      { x: 0.08, y: 0.4, z: 0.02, rx: -0.2, rz: -0.08 },
      { x: -0.22, y: 0.3, z: 0.18, rx: 0.06, rz: -0.3 },
    ].forEach(({ x, y, z, rx, rz }) => {
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), material);
      tuft.position.set(x, y, z);
      tuft.rotation.x = rx;
      tuft.rotation.z = rz;
      group.add(tuft);
    });

    return group;
  }

  if (style === "slicked") {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.14, 0.62), material);
    cap.position.set(0, 0.24, -0.02);
    cap.rotation.x = -0.16;
    group.add(cap);

    const sweep = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.42), material);
    sweep.position.set(0, 0.3, -0.12);
    sweep.rotation.x = -0.34;
    group.add(sweep);

    return group;
  }

  if (style === "buzz") {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.64), material);
    cap.position.set(0, 0.26, 0);
    group.add(cap);
    return group;
  }

  if (style === "curly") {
    const curls: Array<[number, number, number]> = [
      [0, 0.3, 0],
      [-0.18, 0.26, -0.12],
      [0.18, 0.27, -0.1],
      [-0.16, 0.24, 0.12],
      [0.16, 0.25, 0.12],
      [0, 0.36, -0.04],
    ];
    curls.forEach(([x, y, z]) => {
      const curl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), material);
      curl.position.set(x, y, z);
      group.add(curl);
    });
    return group;
  }

  const cap = new THREE.Mesh(
    style === "long" ? new THREE.BoxGeometry(0.68, 0.34, 0.68) : new THREE.BoxGeometry(0.66, 0.24, 0.66),
    material,
  );
  cap.position.set(0, 0.24, 0);
  group.add(cap);

  if (style === "long") {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.46, 0.18), material);
    back.position.set(0, -0.08, -0.2);
    group.add(back);
  }

  return group;
}

function createHeadAccessories(accessories: Accessory[], appearance: AgentAppearance): THREE.Group {
  const group = new THREE.Group();
  const dark = makeMaterial("#20242c");
  const hair = makeMaterial(appearance.hairColor);

  if (accessories.includes("glasses")) {
    [-0.14, 0.14].forEach((x) => {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.04), dark);
      lens.position.set(x, 0.03, 0.32);
      group.add(lens);
    });
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), dark);
    bridge.position.set(0, 0.03, 0.32);
    group.add(bridge);
  }

  if (accessories.includes("hat")) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 6), dark);
    hat.position.set(0, 0.42, 0);
    group.add(hat);
  }

  if (accessories.includes("beard")) {
    const beardBase = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.05), hair);
    beardBase.position.set(0, -0.16, 0.31);
    group.add(beardBase);

    const beardDrop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.05), hair);
    beardDrop.position.set(0, -0.28, 0.31);
    group.add(beardDrop);

    const sideLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.05), hair);
    sideLeft.position.set(-0.18, -0.08, 0.31);
    group.add(sideLeft);

    const sideRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.05), hair);
    sideRight.position.set(0.18, -0.08, 0.31);
    group.add(sideRight);
  }

  return group;
}

function createBodyAccessories(accessories: Accessory[], appearance: AgentAppearance): THREE.Group {
  const group = new THREE.Group();
  const accent = makeMaterial(appearance.bodyColor);

  if (accessories.includes("tie")) {
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), accent);
    knot.position.set(0, 0.25, 0.24);
    group.add(knot);

    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.04), accent);
    tie.position.set(0, 0.05, 0.24);
    group.add(tie);
  }

  return group;
}

export function createAgent(agentConfig: AgentConfig): BuiltAgent {
  if (agentConfig.id === "charlie") {
    return createFishAgent(agentConfig);
  }

  const { id, name, role, emoji, appearance } = agentConfig;
  const height = appearance.height ?? 1;

  const root = new THREE.Group();
  root.name = id;

  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const legs = new THREE.Group();
  const pants = makeMaterial(appearance.pantsColor);
  const leftLeg = addMesh(legs, new THREE.BoxGeometry(0.22, 0.7, 0.22), pants, new THREE.Vector3(-0.14, 0.36, 0));
  const rightLeg = addMesh(legs, new THREE.BoxGeometry(0.22, 0.7, 0.22), pants, new THREE.Vector3(0.14, 0.36, 0));
  bodyPivot.add(legs);

  const torso = new THREE.Group();
  torso.position.y = 0.9;
  bodyPivot.add(torso);

  const body = addMesh(
    torso,
    new THREE.BoxGeometry(0.74, 0.86, 0.42),
    makeMaterial(appearance.bodyColor),
    new THREE.Vector3(0, 0, 0),
  );
  const leftArm = addMesh(
    torso,
    new THREE.BoxGeometry(0.18, 0.68, 0.18),
    makeMaterial(appearance.bodyColor),
    new THREE.Vector3(-0.48, -0.05, 0),
  );
  const rightArm = addMesh(
    torso,
    new THREE.BoxGeometry(0.18, 0.68, 0.18),
    makeMaterial(appearance.bodyColor),
    new THREE.Vector3(0.48, -0.05, 0),
  );
  torso.add(createBodyAccessories(appearance.accessories ?? [], appearance));

  const headPivot = new THREE.Group();
  headPivot.position.y = 0.78;
  torso.add(headPivot);

  const head = createHead(appearance.headShape, appearance.skinColor);
  headPivot.add(head);
  headPivot.add(createFace(appearance.headShape, appearance.accessories ?? []));
  headPivot.add(createHair(appearance.hairStyle, appearance.hairColor));
  headPivot.add(createHeadAccessories(appearance.accessories ?? [], appearance));

  root.scale.setScalar(height);
  root.userData.labelOffset = 2.5 * height;

  enableShadows(root);

  return {
    id,
    name,
    role,
    emoji,
    mesh: root,
    parts: {
      bodyPivot,
      headPivot,
      legs: { leftLeg, rightLeg },
      arms: { leftArm, rightArm },
      body,
    },
  };
}
