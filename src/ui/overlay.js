import * as THREE from "three";

export function createHud({ onToggleDemo, onResetCamera }) {
  const hud = document.createElement("div");
  hud.className = "hud";

  const panel = document.createElement("div");
  panel.className = "hud-panel";
  panel.innerHTML = `
    <h1>Dunder Mifflin AI Annex</h1>
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

  const demoButton = panel.querySelector('[data-action="demo"]');
  demoButton.addEventListener("click", () => onToggleDemo());

  panel.querySelector('[data-action="reset"]').addEventListener("click", () => onResetCamera());

  document.body.append(hud);

  return {
    setDemoRunning(running) {
      demoButton.textContent = running ? "Stop Demo Mode" : "Start Demo Mode";
    },
    labelLayer,
  };
}

export class LabelRenderer {
  constructor(container) {
    this.container = container;
    this.nodes = new Map();
    this.screenPosition = new THREE.Vector3();
  }

  sync(labels, camera, viewport) {
    const seen = new Set();

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
        refs = {
          node,
          name: node.querySelector(".agent-name"),
          role: node.querySelector(".agent-role"),
          status: node.querySelector(".agent-status"),
        };
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
