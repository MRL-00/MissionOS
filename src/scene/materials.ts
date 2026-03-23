import * as THREE from "three";

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function buildCacheKey(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters): string {
  const normalizedExtra = Object.entries(extra)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const typedValue = value as unknown;
      return [key, typedValue instanceof THREE.Color ? typedValue.getHexString() : typedValue];
    });

  return JSON.stringify([color, normalizedExtra]);
}

export function makeMaterial(
  color: THREE.ColorRepresentation,
  extra: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  const key = buildCacheKey(color, extra);
  const cached = materialCache.get(key);
  if (cached) {
    return cached;
  }

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0.05,
    ...extra,
  });
  materialCache.set(key, material);
  return material;
}

export function makeGlass(color: THREE.ColorRepresentation = "#cfe4ea"): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity: 0.28,
    roughness: 0.12,
    metalness: 0,
    transmission: 0.38,
    thickness: 0.2,
  });
}
