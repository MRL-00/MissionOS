import * as THREE from "three";
import type { LabelState } from "../types";

interface HudOptions {
  onToggleDemo(): void;
  onResetCamera(): void;
}

interface HudApi {
  setDemoRunning(running: boolean): void;
  labelLayer: HTMLDivElement;
}

interface LabelRefs {
  node: HTMLDivElement;
  name: HTMLSpanElement;
  role: HTMLSpanElement;
  status: HTMLSpanElement;
}

export function createHud({ onToggleDemo, onResetCamera }: HudOptions): HudApi {
  const hud = document.createElement("div");
  hud.className = "hud";

  const panel = document.createElement("div");
  panel.className = "hud-panel";
  panel.innerHTML = `
    <h1>EpicShot Office</h1>
    <p>Low-poly office diorama with configurable agents, glass offices, and a lightweight demo choreography.</p>
    <div class="controls">
      <button class="button" type="button" data-action="demo">Start Demo Mode</button>
      <button class="button secondary" type="button" data-action="reset">Reset View</button>
    </div>
    <div class="legend">
      <span><i class="dot" style="background: var(--status-idle)"></i>idle</span>
      <span><i class="dot" style="background: var(--status-working)"></i>working</span>
      <span><i class="dot" style="background: var(--status-meeting)"></i>meeting</span>
    </div>
  `;
  hud.append(panel);

  const labelLayer = document.createElement("div");
  labelLayer.className = "label-layer";
  hud.append(labelLayer);

  const demoButton = panel.querySelector<HTMLButtonElement>('[data-action="demo"]');
  const resetButton = panel.querySelector<HTMLButtonElement>('[data-action="reset"]');

  demoButton?.addEventListener("click", () => onToggleDemo());
  resetButton?.addEventListener("click", () => onResetCamera());

  document.body.append(hud);

  return {
    setDemoRunning(running) {
      if (demoButton) {
        demoButton.textContent = running ? "Stop Demo Mode" : "Start Demo Mode";
      }
    },
    labelLayer,
  };
}

export class LabelRenderer {
  container: HTMLDivElement;
  nodes: Map<string, LabelRefs>;
  screenPosition: THREE.Vector3;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.nodes = new Map();
    this.screenPosition = new THREE.Vector3();
  }

  sync(labels: LabelState[], camera: THREE.Camera, viewport: { width: number; height: number }): void {
    const seen = new Set<string>();

    labels.forEach((label) => {
      seen.add(label.id);
      let refs = this.nodes.get(label.id);
      if (!refs) {
        const node = document.createElement("div");
        node.className = "agent-label";
        node.innerHTML = `
          <span class="agent-name"></span>
          <span class="agent-role"></span>
          <span class="agent-status"></span>
        `;
        this.container.append(node);
        const name = node.querySelector<HTMLSpanElement>(".agent-name");
        const role = node.querySelector<HTMLSpanElement>(".agent-role");
        const status = node.querySelector<HTMLSpanElement>(".agent-status");
        if (!name || !role || !status) {
          node.remove();
          return;
        }
        refs = { node, name, role, status };
        this.nodes.set(label.id, refs);
      }

      this.screenPosition.copy(label.worldPosition).project(camera);
      const visible = this.screenPosition.z > -1 && this.screenPosition.z < 1;
      refs.node.style.display = visible ? "block" : "none";

      if (visible) {
        const x = (this.screenPosition.x * 0.5 + 0.5) * viewport.width;
        const y = (-this.screenPosition.y * 0.5 + 0.5) * viewport.height;
        refs.node.style.left = `${x}px`;
        refs.node.style.top = `${y}px`;
      }

      refs.name.textContent = label.name;
      refs.role.textContent = label.role;
      refs.status.dataset.status = label.status;
      refs.status.textContent = label.status;
    });

    this.nodes.forEach(({ node }, id) => {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    });
  }
}
