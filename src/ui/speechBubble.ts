import * as THREE from "three";
import type { LabelState } from "../types";

interface SpeechBubble {
  agentId: string;
  message: string;
  expiresAt: number;
  color?: string | undefined;
  persistent: boolean;
  variant: "default" | "meeting";
  typing: boolean;
}

interface SpeechBubbleOptions {
  color?: string | undefined;
  persistent?: boolean | undefined;
  variant?: "default" | "meeting" | undefined;
  typing?: boolean | undefined;
}

interface SpeechBubbleRefs {
  node: HTMLDivElement;
  body: HTMLSpanElement;
  typing: HTMLDivElement;
}

export class SpeechBubbleRenderer {
  static readonly BUBBLE_OFFSET = new THREE.Vector3(0, 0.95, 0);
  container: HTMLDivElement;
  bubbles: Map<string, SpeechBubble>;
  refs: Map<string, SpeechBubbleRefs>;
  screenPosition: THREE.Vector3;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.bubbles = new Map();
    this.refs = new Map();
    this.screenPosition = new THREE.Vector3();
  }

  show(agentId: string, message: string, options: SpeechBubbleOptions = {}): void {
    this.bubbles.set(agentId, {
      agentId,
      message,
      color: options.color,
      expiresAt: options.persistent ? Number.POSITIVE_INFINITY : performance.now() + 5000,
      persistent: options.persistent ?? false,
      variant: options.variant ?? "default",
      typing: options.typing ?? false,
    });
  }

  hide(agentId: string): void {
    this.removeBubble(agentId);
  }

  clear(): void {
    Array.from(this.bubbles.keys()).forEach((agentId) => this.removeBubble(agentId));
  }

  sync(labels: LabelState[], camera: THREE.Camera, viewport: { width: number; height: number }): void {
    const now = performance.now();
    const labelsById = new Map(labels.map((label) => [label.id, label] as const));

    this.bubbles.forEach((bubble, agentId) => {
      if (!bubble.persistent && bubble.expiresAt <= now) {
        this.removeBubble(agentId);
        return;
      }

      const label = labelsById.get(agentId);
      if (!label) {
        this.removeBubble(agentId);
        return;
      }

      let refs = this.refs.get(agentId);
      if (!refs) {
        const node = document.createElement("div");
        node.className = "speech-bubble";
        const body = document.createElement("span");
        body.className = "speech-bubble-body";
        const typing = document.createElement("div");
        typing.className = "speech-bubble-typing";
        typing.innerHTML = "<span></span><span></span><span></span>";
        node.append(body, typing);
        this.container.append(node);
        refs = { node, body, typing };
        this.refs.set(agentId, refs);
      }

      refs.node.dataset.variant = bubble.variant;
      refs.node.dataset.typing = bubble.typing ? "true" : "false";
      if (bubble.color) {
        refs.node.style.setProperty("--bubble-accent", bubble.color);
      } else {
        refs.node.style.removeProperty("--bubble-accent");
      }
      refs.body.textContent = bubble.message;
      refs.body.style.display = bubble.typing ? "none" : "block";
      refs.typing.style.display = bubble.typing ? "inline-flex" : "none";

      this.screenPosition.copy(label.worldPosition).add(SpeechBubbleRenderer.BUBBLE_OFFSET).project(camera);
      const visible = this.screenPosition.z > -1 && this.screenPosition.z < 1;
      refs.node.style.display = visible ? "block" : "none";

      if (visible) {
        const x = (this.screenPosition.x * 0.5 + 0.5) * viewport.width;
        const y = (-this.screenPosition.y * 0.5 + 0.5) * viewport.height;
        refs.node.style.left = `${x}px`;
        refs.node.style.top = `${y}px`;
        refs.node.style.opacity = bubble.persistent ? "1" : `${Math.min(1, Math.max(0, (bubble.expiresAt - now) / 1000))}`;
      }
    });
  }

  private removeBubble(agentId: string): void {
    this.bubbles.delete(agentId);
    const refs = this.refs.get(agentId);
    refs?.node.remove();
    this.refs.delete(agentId);
  }
}
