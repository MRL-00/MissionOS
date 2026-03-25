import * as THREE from "three";
import type { AgentConfig, AgentStatus, AgentTargetOptions, LabelState } from "../types";
import { createFishAgent } from "./fishFactory";
import { STATUS } from "./agentController";

function interpolateAngle(current: number, target: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

export class FishController {
  id: string;
  name: string;
  role: string;
  emoji: string;
  bodyColor: string;
  mesh: THREE.Group;
  parts: ReturnType<typeof createFishAgent>["parts"];
  velocity: THREE.Vector3;
  targetPosition: THREE.Vector3;
  path: THREE.Vector3[];
  targetFacing: number;
  moveSpeed: number;
  turnSpeed: number;
  status: AgentStatus;
  task?: string | undefined;
  message?: string | undefined;
  phase: number;
  seated: boolean;
  walking: boolean;
  seatAmount: number;
  navNodeId: string | null;
  labelWorldPosition: THREE.Vector3;
  highlightAmount: number;
  highlightTarget: number;

  constructor(agentConfig: AgentConfig, initialPosition: THREE.Vector3, initialFacing = 0) {
    const built = createFishAgent(agentConfig);
    this.id = built.id;
    this.name = built.name;
    this.role = built.role;
    this.emoji = built.emoji;
    this.bodyColor = agentConfig.appearance.bodyColor;
    this.mesh = built.mesh;
    this.parts = built.parts;

    this.mesh.position.copy(initialPosition);
    this.mesh.rotation.y = initialFacing;

    this.velocity = new THREE.Vector3();
    this.targetPosition = initialPosition.clone();
    this.path = [];
    this.targetFacing = initialFacing;
    this.moveSpeed = 1.6;
    this.turnSpeed = 5;
    this.status = STATUS.idle;
    this.task = undefined;
    this.message = undefined;
    this.phase = Math.random() * Math.PI * 2;
    this.seated = false;
    this.walking = false;
    this.seatAmount = 0;
    this.navNodeId = null;
    this.labelWorldPosition = new THREE.Vector3();
    this.highlightAmount = 0;
    this.highlightTarget = 0;
  }

  setTarget(position: THREE.Vector3, options: AgentTargetOptions = {}): void {
    const route = [...(options.path ?? []), position].map((point) => point.clone());
    this.path = route;
    this.targetPosition.copy(this.path.shift() ?? position);
    if (typeof options.facing === "number") {
      this.targetFacing = options.facing;
    }
    if (options.status) {
      this.status = options.status;
    }
    if (typeof options.seated === "boolean") {
      this.seated = options.seated;
    }
  }

  update(delta: number, elapsed: number): void {
    const toTarget = this.targetPosition.clone().sub(this.mesh.position);
    const horizontalTarget = toTarget.clone();
    horizontalTarget.y = 0;
    let distance = horizontalTarget.length();
    let reachedCurrentTarget = distance <= 0.04;

    if (reachedCurrentTarget && this.path.length) {
      const next = this.path.shift();
      if (next) {
        this.targetPosition.copy(next);
      }
      toTarget.copy(this.targetPosition).sub(this.mesh.position);
      horizontalTarget.copy(toTarget);
      horizontalTarget.y = 0;
      distance = horizontalTarget.length();
      reachedCurrentTarget = distance <= 0.04;
    }

    this.walking = !reachedCurrentTarget || this.path.length > 0;

    if (this.walking && distance > 0) {
      horizontalTarget.normalize();
      const step = Math.min(distance, this.moveSpeed * delta);
      this.mesh.position.addScaledVector(horizontalTarget, step);
      const desiredAngle = Math.atan2(horizontalTarget.x, horizontalTarget.z);
      this.mesh.rotation.y = interpolateAngle(this.mesh.rotation.y, desiredAngle, Math.min(1, delta * this.turnSpeed));
    } else {
      this.mesh.rotation.y = interpolateAngle(
        this.mesh.rotation.y,
        this.targetFacing,
        Math.min(1, delta * this.turnSpeed * 0.7),
      );
    }

    const cruiseBob = Math.sin(elapsed * (this.walking ? 3.6 : 2.1) + this.phase) * (this.walking ? 0.18 : 0.12);
    this.mesh.position.y = THREE.MathUtils.damp(this.mesh.position.y, this.targetPosition.y + cruiseBob, 4.5, delta);

    const swimWave = elapsed * (this.walking ? 10 : 6) + this.phase;
    const tailSwing = Math.sin(swimWave) * (this.walking ? 0.75 : 0.35);
    const finFlap = Math.sin(swimWave * 1.35) * (this.walking ? 0.28 : 0.16);
    const bodySway = Math.sin(swimWave * 0.5) * (this.walking ? 0.16 : 0.08);
    const bodyPitch = Math.sin(swimWave * 0.7) * 0.08 + THREE.MathUtils.clamp(toTarget.y * 0.18, -0.18, 0.18);

    this.parts.bodyPivot.position.set(0, bodySway, 0);
    this.parts.bodyPivot.rotation.y = tailSwing * 0.12;
    this.parts.bodyPivot.rotation.z = bodySway * 0.35;
    this.parts.headPivot.rotation.x = bodyPitch;
    this.parts.headPivot.rotation.y = bodySway * 0.18;
    this.parts.arms.leftArm.rotation.y = Math.PI / 2 + tailSwing;
    this.parts.arms.rightArm.rotation.y = Math.PI / 2 + tailSwing;
    this.parts.legs.leftLeg.rotation.z = 0.35 + finFlap;
    this.parts.legs.rightLeg.rotation.z = -0.35 - finFlap;

    this.highlightAmount = THREE.MathUtils.damp(this.highlightAmount, this.highlightTarget, 5, delta);
    this.mesh.scale.setScalar(1 + this.highlightAmount * 0.08);
    const bodyMaterial = this.parts.body.material;
    if (bodyMaterial instanceof THREE.MeshStandardMaterial) {
      bodyMaterial.emissive.set(this.bodyColor);
      bodyMaterial.emissiveIntensity = this.highlightAmount * 0.45;
    }

    this.labelWorldPosition.copy(this.mesh.position);
    this.labelWorldPosition.y += typeof this.mesh.userData.labelOffset === "number" ? this.mesh.userData.labelOffset : 2.05;
  }

  setMeetingHighlight(highlighted: boolean): void {
    this.highlightTarget = highlighted ? 1 : 0;
  }

  getLabelState(): LabelState {
    return {
      id: this.id,
      name: `${this.emoji} ${this.name}`,
      role: this.role,
      status: this.status,
      message: this.message,
      worldPosition: this.labelWorldPosition,
    };
  }
}
