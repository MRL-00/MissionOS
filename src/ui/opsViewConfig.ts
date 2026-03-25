export interface OpsViewBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface OpsViewTarget {
  x: number;
  y: number;
  z: number;
}

export interface OpsViewPreset {
  id: "overview" | "bullpen" | "meeting-room" | "cio-office";
  label: string;
  target: OpsViewTarget;
  distance: number;
}

export interface OpsViewConfig {
  delegation: string;
  roomBounds: OpsViewBounds;
  targetBounds: OpsViewBounds;
  defaultTarget: OpsViewTarget;
  overviewDistance: number;
  minDistance: number;
  maxDistance: number;
  polarAngle: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  azimuthAngle: number;
  minAzimuthAngle: number;
  maxAzimuthAngle: number;
  presets: OpsViewPreset[];
}

const DEG_TO_RAD = Math.PI / 180;

export const OFFICE_OPS_VIEW_CONFIG: OpsViewConfig = {
  delegation: "Owned by Harry, delegated by Zoe for Matt/Pickle's office UI redesign workstream.",
  roomBounds: {
    minX: -16,
    maxX: 16,
    minZ: -10,
    maxZ: 10,
  },
  targetBounds: {
    minX: -4.5,
    maxX: 7.5,
    minZ: -6.5,
    maxZ: 6.5,
  },
  defaultTarget: {
    x: 1.5,
    y: 0.8,
    z: 0.4,
  },
  overviewDistance: 24,
  minDistance: 16,
  maxDistance: 31,
  polarAngle: 56 * DEG_TO_RAD,
  minPolarAngle: 50 * DEG_TO_RAD,
  maxPolarAngle: 58 * DEG_TO_RAD,
  azimuthAngle: -45 * DEG_TO_RAD,
  minAzimuthAngle: -45 * DEG_TO_RAD,
  maxAzimuthAngle: -45 * DEG_TO_RAD,
  presets: [
    {
      id: "overview",
      label: "Whole Office",
      target: { x: 1.5, y: 0.8, z: 0.4 },
      distance: 24,
    },
    {
      id: "bullpen",
      label: "Bullpen",
      target: { x: -0.5, y: 0.8, z: 0.8 },
      distance: 18,
    },
    {
      id: "meeting-room",
      label: "Meeting Room",
      target: { x: 8.6, y: 0.8, z: -4.3 },
      distance: 17,
    },
    {
      id: "cio-office",
      label: "CIO Office",
      target: { x: 9.6, y: 0.8, z: 5.9 },
      distance: 16,
    },
  ],
};

export function clampOpsViewTarget(target: OpsViewTarget, bounds = OFFICE_OPS_VIEW_CONFIG.targetBounds): OpsViewTarget {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, target.x)),
    y: target.y,
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, target.z)),
  };
}

/**
 * Compute camera position from a target, distance, and spherical angles.
 * Used by the ops-view controller to position the camera for a given preset.
 */
export function computeOpsViewCameraPosition(
  target: OpsViewTarget,
  distance: number,
  polarAngle: number,
  azimuthAngle: number,
): OpsViewTarget {
  const sinPolar = Math.sin(polarAngle);
  const cosPolar = Math.cos(polarAngle);
  const sinAzimuth = Math.sin(azimuthAngle);
  const cosAzimuth = Math.cos(azimuthAngle);
  return {
    x: target.x + distance * sinPolar * sinAzimuth,
    y: target.y + distance * cosPolar,
    z: target.z + distance * sinPolar * cosAzimuth,
  };
}
