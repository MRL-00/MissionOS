import * as THREE from "three";
import type { Accessory, AgentAppearance, AgentConfig, BuiltAgent } from "../types";
import { makeMaterial } from "../scene/materials";
import { enableShadows } from "../utils";

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

function createAccessories(accessories: Accessory[], appearance: AgentAppearance): THREE.Group {
  const group = new THREE.Group();
  const dark = makeMaterial("#20242c");
  const accent = makeMaterial(appearance.bodyColor);

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

  if (accessories.includes("tie")) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.3, 0.05), accent);
    tie.position.set(0, -0.12, 0.33);
    group.add(tie);
  }

  return group;
}

export function createAgent(agentConfig: AgentConfig): BuiltAgent {
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

  const headPivot = new THREE.Group();
  headPivot.position.y = 0.78;
  torso.add(headPivot);

  const head = createHead(appearance.headShape, appearance.skinColor);
  headPivot.add(head);
  headPivot.add(createHair(appearance.hairStyle, appearance.hairColor));
  headPivot.add(createAccessories(appearance.accessories ?? [], appearance));

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
