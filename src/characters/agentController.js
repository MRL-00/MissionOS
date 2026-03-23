import * as THREE from "three";
import { createAgent } from "./agentFactory.js";

const STATUS = {
  idle: "idle",
  working: "working",
  meeting: "in-meeting",
};

function interpolateAngle(current, target, alpha) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

export class AgentController {
  constructor(agentConfig, initialPosition, initialFacing = 0) {
    const built = createAgent(agentConfig);
    this.id = built.id;
    this.name = built.name;
    this.role = built.role;
    this.emoji = built.emoji;
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
    this.phase = Math.random() * Math.PI * 2;
    this.seated = false;
    this.walking = false;
    this.seatAmount = 0;
    this.labelWorldPosition = new THREE.Vector3();
  }

  setTarget(position, options = {}) {
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

  update(delta, elapsed) {
    const toTarget = this.targetPosition.clone().sub(this.mesh.position);
    toTarget.y = 0;
    let distance = toTarget.length();
    let reachedCurrentTarget = distance <= 0.04;

    if (reachedCurrentTarget && this.path.length) {
      this.targetPosition.copy(this.path.shift());
      toTarget.copy(this.targetPosition).sub(this.mesh.position);
      toTarget.y = 0;
      distance = toTarget.length();
      reachedCurrentTarget = distance <= 0.04;
    }

    this.walking = !reachedCurrentTarget || this.path.length > 0;

    if (this.walking) {
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

    this.parts.bodyPivot.position.y = 0.08 + bob - this.seatAmount * 0.24;
    this.parts.bodyPivot.rotation.x = -this.seatAmount * 0.4;
    this.parts.headPivot.rotation.x = Math.sin(elapsed * 1.5 + this.phase) * 0.03;
    this.parts.arms.leftArm.rotation.x = sway;
    this.parts.arms.rightArm.rotation.x = -sway;
    this.parts.legs.leftLeg.rotation.x = -sway;
    this.parts.legs.rightLeg.rotation.x = sway;

    if (visuallySeated) {
      this.parts.arms.leftArm.rotation.x = -0.7;
      this.parts.arms.rightArm.rotation.x = -0.9;
      this.parts.legs.leftLeg.rotation.x = 1.3;
      this.parts.legs.rightLeg.rotation.x = 1.3;
    }

    this.labelWorldPosition.copy(this.mesh.position);
    this.labelWorldPosition.y += this.mesh.userData.labelOffset ?? 2.5;
  }

  getLabelState() {
    return {
      id: this.id,
      name: `${this.emoji} ${this.name}`,
      role: this.role,
      status: this.status,
      worldPosition: this.labelWorldPosition,
    };
  }
}

export { STATUS };
