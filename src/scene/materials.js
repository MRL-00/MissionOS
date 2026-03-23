import * as THREE from "three";

const materialCache = new Map();

function buildCacheKey(color, extra) {
  const normalizedExtra = Object.entries(extra)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value && typeof value === "object" && "getHexString" in value ? value.getHexString() : value]);

  return JSON.stringify([color, normalizedExtra]);
}

export function makeMaterial(color, extra = {}) {
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
