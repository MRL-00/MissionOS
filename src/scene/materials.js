import * as THREE from "three";

export function makeMaterial(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.05,
    ...extra,
  });
}

export function makeGlass(color = "#cfe4ea") {
  return new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity: 0.32,
    roughness: 0.14,
    metalness: 0,
    transmission: 0.25,
    thickness: 0.2,
  });
}
