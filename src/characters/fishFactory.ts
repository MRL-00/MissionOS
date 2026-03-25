import * as THREE from "three";
import type { AgentConfig, BuiltAgent } from "../types";
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

export function createFishAgent(agentConfig: AgentConfig): BuiltAgent {
  const { id, name, role, emoji, appearance } = agentConfig;
  const height = appearance.height ?? 1;

  const root = new THREE.Group();
  root.name = id;

  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const orange = makeMaterial("#FF6B35");
  const white = makeMaterial("#FFFFFF");
  const dark = makeMaterial("#1F2530");

  const bodyGeometry = new THREE.SphereGeometry(0.42, 24, 18);
  bodyGeometry.applyMatrix4(new THREE.Matrix4().makeScale(0.78, 0.6, 1.3));
  const body = addMesh(bodyPivot, bodyGeometry, orange, new THREE.Vector3(0, 0.9, 0));

  // White stripes: thin ellipsoid bands that follow the body contour
  const makeStripe = (zPos: number): void => {
    const bandGeo = new THREE.SphereGeometry(0.42, 20, 12);
    bandGeo.applyMatrix4(new THREE.Matrix4().makeScale(0.82, 0.64, 0.22));
    const band = new THREE.Mesh(bandGeo, white);
    band.position.set(0, 0.9, zPos);
    bodyPivot.add(band);
  };
  makeStripe(0.17);
  makeStripe(-0.1);

  const tailGeometry = new THREE.BoxGeometry(0.48, 0.42, 0.05);
  const tailFin = addMesh(bodyPivot, tailGeometry, orange, new THREE.Vector3(0, 0.9, -0.62));
  tailFin.rotation.y = Math.PI / 2;

  const finGeometry = new THREE.BoxGeometry(0.26, 0.14, 0.04);
  const leftFin = addMesh(bodyPivot, finGeometry, orange, new THREE.Vector3(-0.36, 0.83, -0.02));
  leftFin.rotation.z = 0.35;
  const rightFin = addMesh(bodyPivot, finGeometry, orange, new THREE.Vector3(0.36, 0.83, -0.02));
  rightFin.rotation.z = -0.35;

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.92, 0.38);
  bodyPivot.add(headPivot);

  // Right eye + pupil
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), white);
  eyeR.position.set(0.28, 0.06, 0.05);
  headPivot.add(eyeR);
  const pupilR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), dark);
  pupilR.position.set(0.33, 0.06, 0.08);
  headPivot.add(pupilR);

  // Left eye + pupil
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), white);
  eyeL.position.set(-0.28, 0.06, 0.05);
  headPivot.add(eyeL);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), dark);
  pupilL.position.set(-0.33, 0.06, 0.08);
  headPivot.add(pupilL);

  root.scale.setScalar(height);
  root.userData.labelOffset = 2.05 * height;

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
      legs: {
        leftLeg: leftFin,
        rightLeg: rightFin,
      },
      arms: {
        leftArm: tailFin,
        rightArm: tailFin,
      },
      body,
    },
  };
}
