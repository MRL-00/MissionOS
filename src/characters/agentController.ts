import * as THREE from "three";
import type { AgentConfig, AgentStatus, AgentTargetOptions, LabelState } from "../types";
import { createAgent } from "./agentFactory";

export const STATUS = {
  idle: "idle",
  working: "working",
  meeting: "in-meeting",
} as const satisfies Record<string, AgentStatus>;

function interpolateAngle(current: number, target: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

export class AgentController {
  id: string;
  name: string;
  role: string;
  emoji: string;
  bodyColor: string;
  mesh: THREE.Group;
  parts: ReturnType<typeof createAgent>["parts"];
  velocity: THREE.Vector3;
  targetPosition: THREE.Vector3;
  path: THREE.Vector3[];
  targetFacing: number;
  moveSpeed: number;
  turnSpeed: number;
  status: AgentStatus;
  task?: string | undefined;
  phase: number;
  seated: boolean;
  walking: boolean;
  seatAmount: number;
  navNodeId: string | null;
  labelWorldPosition: THREE.Vector3;
  highlightAmount: number;
  highlightTarget: number;

  constructor(agentConfig: AgentConfig, initialPosition: THREE.Vector3, initialFacing = 0) {
    const built = createAgent(agentConfig);
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
    this.moveSpeed = 2.2;
    this.turnSpeed = 6;
    this.status = STATUS.idle;
    this.task = undefined;
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
    toTarget.y = 0;
    let distance = toTarget.length();
    let reachedCurrentTarget = distance <= 0.04;

    if (reachedCurrentTarget && this.path.length) {
      const next = this.path.shift();
      if (next) {
        this.targetPosition.copy(next);
      }
      toTarget.copy(this.targetPosition).sub(this.mesh.position);
      toTarget.y = 0;
      distance = toTarget.length();
      reachedCurrentTarget = distance <= 0.04;
    }

    this.walking = !reachedCurrentTarget || this.path.length > 0;

    if (this.walking && distance > 0) {
      toTarget.normalize();
      const step = Math.min(distance, this.moveSpeed * delta);
      this.mesh.position.addScaledVector(toTarget, step);
      const desiredAngle = Math.atan2(toTarget.x, toTarget.z);
      this.mesh.rotation.y = interpolateAngle(this.mesh.rotation.y, desiredAngle, Math.min(1, delta * this.turnSpeed));
    } else {
      this.mesh.rotation.y = interpolateAngle(
        this.mesh.rotation.y,
        this.targetFacing,
        Math.min(1, delta * this.turnSpeed * 0.7),
      );
    }

    this.mesh.position.y = THREE.MathUtils.damp(this.mesh.position.y, this.targetPosition.y, 8, delta);

    const bob = this.walking ? Math.sin(elapsed * 8 + this.phase) * 0.05 : Math.sin(elapsed * 1.8 + this.phase) * 0.03;
    const sway = this.walking ? Math.sin(elapsed * 8 + this.phase) * 0.65 : 0;
    const visuallySeated = this.seated && !this.walking;
    this.seatAmount = THREE.MathUtils.damp(this.seatAmount, visuallySeated ? 1 : 0, 6, delta);

    this.parts.bodyPivot.position.set(0, 0.08 + bob - this.seatAmount * 0.4, this.seatAmount * 0.14);
    this.parts.bodyPivot.rotation.x = -this.seatAmount * 0.62;
    this.parts.headPivot.rotation.x = Math.sin(elapsed * 1.5 + this.phase) * 0.03;
    this.parts.arms.leftArm.rotation.x = sway;
    this.parts.arms.rightArm.rotation.x = -sway;
    this.parts.legs.leftLeg.rotation.x = -sway;
    this.parts.legs.rightLeg.rotation.x = sway;

    if (visuallySeated) {
      const seatedLeftArmX = -0.82;
      const seatedRightArmX = -1.02;

      this.parts.arms.leftArm.rotation.x = seatedLeftArmX;
      this.parts.arms.rightArm.rotation.x = seatedRightArmX;
      this.parts.legs.leftLeg.rotation.x = 1.5;
      this.parts.legs.rightLeg.rotation.x = 1.5;

      if (this.status === STATUS.working) {
        const typingWave = elapsed * 14 + this.phase;
        const typingAmount = 0.1;
        this.parts.arms.leftArm.rotation.x = seatedLeftArmX + Math.sin(typingWave) * typingAmount;
        this.parts.arms.rightArm.rotation.x = seatedRightArmX + Math.cos(typingWave) * typingAmount;
        this.parts.headPivot.rotation.x =
          Math.sin(elapsed * 1.5 + this.phase) * 0.03 + Math.sin(typingWave * 0.5) * 0.025;
      }
    }

    this.highlightAmount = THREE.MathUtils.damp(this.highlightAmount, this.highlightTarget, 5, delta);
    this.mesh.scale.setScalar(1 + this.highlightAmount * 0.08);
    const bodyMaterial = this.parts.body.material;
    if (bodyMaterial instanceof THREE.MeshStandardMaterial) {
      bodyMaterial.emissive.set(this.bodyColor);
      bodyMaterial.emissiveIntensity = this.highlightAmount * 0.45;
    }

    this.labelWorldPosition.copy(this.mesh.position);
    this.labelWorldPosition.y += typeof this.mesh.userData.labelOffset === "number" ? this.mesh.userData.labelOffset : 2.5;
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
      task: this.task,
      worldPosition: this.labelWorldPosition,
    };
  }
}
