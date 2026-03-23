import * as THREE from "three";

export function enableShadows<T extends THREE.Object3D>(object: T): T {
  object.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return object;
}
