import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  OFFICE_OPS_VIEW_CONFIG,
  clampOpsViewTarget,
  computeOpsViewCameraPosition,
  type OpsViewConfig,
  type OpsViewPreset,
} from "./opsViewConfig";

export interface OpsViewHandle {
  focusPreset(id: OpsViewPreset["id"]): void;
  reset(): void;
  clampTarget(): void;
  dispose(): void;
}

interface SavedOrbitControlsState {
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  minAzimuthAngle: number;
  maxAzimuthAngle: number;
  enableRotate: boolean;
  enablePan: boolean;
  screenSpacePanning: boolean;
}

interface OpsViewTransition {
  startedAt: number;
  durationMs: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromDistance: number;
  toDistance: number;
}

function buildTargetVector(target: THREE.Vector3 | { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(target.x, target.y, target.z);
}

function getCameraDistance(camera: THREE.PerspectiveCamera, controls: OrbitControls): number {
  return camera.position.distanceTo(controls.target);
}

function applyCameraPose(
  controls: OrbitControls,
  camera: THREE.PerspectiveCamera,
  config: OpsViewConfig,
  target: THREE.Vector3,
  distance: number,
): void {
  const nextDistance = THREE.MathUtils.clamp(distance, config.minDistance, config.maxDistance);
  const nextPosition = computeOpsViewCameraPosition(
    { x: target.x, y: target.y, z: target.z },
    nextDistance,
    config.polarAngle,
    config.azimuthAngle,
  );

  controls.target.copy(target);
  camera.position.set(nextPosition.x, nextPosition.y, nextPosition.z);
}

export function applyOpsView(
  controls: OrbitControls,
  camera: THREE.PerspectiveCamera,
  config: OpsViewConfig = OFFICE_OPS_VIEW_CONFIG,
): OpsViewHandle {
  const savedState: SavedOrbitControlsState = {
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
    minPolarAngle: controls.minPolarAngle,
    maxPolarAngle: controls.maxPolarAngle,
    minAzimuthAngle: controls.minAzimuthAngle,
    maxAzimuthAngle: controls.maxAzimuthAngle,
    enableRotate: controls.enableRotate,
    enablePan: controls.enablePan,
    screenSpacePanning: controls.screenSpacePanning,
  };

  let disposed = false;
  let transition: OpsViewTransition | null = null;

  controls.minDistance = config.minDistance;
  controls.maxDistance = config.maxDistance;
  controls.minPolarAngle = config.minPolarAngle;
  controls.maxPolarAngle = config.maxPolarAngle;
  controls.minAzimuthAngle = config.minAzimuthAngle;
  controls.maxAzimuthAngle = config.maxAzimuthAngle;
  controls.enableRotate = false;
  controls.enablePan = true;
  controls.screenSpacePanning = false;

  const overviewPreset = config.presets.find((preset) => preset.id === "overview");
  const initialTarget = buildTargetVector(
    overviewPreset?.target ?? config.defaultTarget,
  );
  applyCameraPose(
    controls,
    camera,
    config,
    initialTarget,
    overviewPreset?.distance ?? config.overviewDistance,
  );
  controls.update();

  const clampTarget = (): void => {
    if (disposed) {
      return;
    }

    if (transition) {
      const progress = THREE.MathUtils.clamp((performance.now() - transition.startedAt) / transition.durationMs, 0, 1);
      const eased = THREE.MathUtils.smootherstep(progress, 0, 1);
      const interpolatedTarget = transition.fromTarget.clone().lerp(transition.toTarget, eased);
      const interpolatedDistance = THREE.MathUtils.lerp(transition.fromDistance, transition.toDistance, eased);

      applyCameraPose(controls, camera, config, interpolatedTarget, interpolatedDistance);
      if (progress >= 1) {
        transition = null;
      }
    }

    const clampedTarget = clampOpsViewTarget(
      {
        x: controls.target.x,
        y: controls.target.y,
        z: controls.target.z,
      },
      config.targetBounds,
    );

    if (
      clampedTarget.x === controls.target.x
      && clampedTarget.y === controls.target.y
      && clampedTarget.z === controls.target.z
    ) {
      return;
    }

    const currentTarget = controls.target.clone();
    const nextTarget = buildTargetVector(clampedTarget);
    const offset = nextTarget.sub(currentTarget);
    controls.target.add(offset);
    camera.position.add(offset);
  };

  const focusPreset = (id: OpsViewPreset["id"]): void => {
    if (disposed) {
      return;
    }

    const preset = config.presets.find((entry) => entry.id === id);
    if (!preset) {
      return;
    }

    transition = {
      startedAt: performance.now(),
      durationMs: 400,
      fromTarget: controls.target.clone(),
      toTarget: buildTargetVector(clampOpsViewTarget(preset.target, config.targetBounds)),
      fromDistance: getCameraDistance(camera, controls),
      toDistance: preset.distance,
    };
  };

  const reset = (): void => {
    focusPreset("overview");
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    transition = null;
    controls.minDistance = savedState.minDistance;
    controls.maxDistance = savedState.maxDistance;
    controls.minPolarAngle = savedState.minPolarAngle;
    controls.maxPolarAngle = savedState.maxPolarAngle;
    controls.minAzimuthAngle = savedState.minAzimuthAngle;
    controls.maxAzimuthAngle = savedState.maxAzimuthAngle;
    controls.enableRotate = savedState.enableRotate;
    controls.enablePan = savedState.enablePan;
    controls.screenSpacePanning = savedState.screenSpacePanning;
    controls.update();
  };

  return {
    focusPreset,
    reset,
    clampTarget,
    dispose,
  };
}
