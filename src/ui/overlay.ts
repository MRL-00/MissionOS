import * as THREE from "three";
import type { AgentRuntimeState, LabelState, RealtimeAgentStatus } from "../types";

interface HudOptions {
  onToggleDemo(): void;
  onResetCamera(): void;
}

interface HudApi {
  setDemoRunning(running: boolean): void;
  setRealtimeConnected(connected: boolean): void;
  syncAgentStates(states: AgentRuntimeState[]): void;
  labelLayer: HTMLDivElement;
  speechLayer: HTMLDivElement;
}

interface LabelRefs {
  node: HTMLDivElement;
  name: HTMLSpanElement;
  role: HTMLSpanElement;
  status: HTMLSpanElement;
  task: HTMLSpanElement;
}

interface AgentListRefs {
  node: HTMLLIElement;
  name: HTMLSpanElement;
  meta: HTMLSpanElement;
  task: HTMLSpanElement;
}

function formatRealtimeStatus(status: RealtimeAgentStatus): string {
  if (status === "meeting") {
    return "meeting";
  }
  return status;
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
    <div class="connection-status" data-connection="offline">Realtime: offline</div>
    <div class="agent-sidebar">
      <h2>Live Agents</h2>
      <ul class="agent-list"></ul>
    </div>
  `;
  hud.append(panel);

  const labelLayer = document.createElement("div");
  labelLayer.className = "label-layer";
  hud.append(labelLayer);

  const speechLayer = document.createElement("div");
  speechLayer.className = "speech-layer";
  hud.append(speechLayer);

  const demoButton = panel.querySelector<HTMLButtonElement>('[data-action="demo"]');
  const resetButton = panel.querySelector<HTMLButtonElement>('[data-action="reset"]');
  const connectionStatus = panel.querySelector<HTMLDivElement>(".connection-status");
  const agentList = panel.querySelector<HTMLUListElement>(".agent-list");
  const agentNodes = new Map<string, AgentListRefs>();

  demoButton?.addEventListener("click", () => onToggleDemo());
  resetButton?.addEventListener("click", () => onResetCamera());

  document.body.append(hud);

  return {
    setDemoRunning(running) {
      if (demoButton) {
        demoButton.textContent = running ? "Stop Demo Mode" : "Start Demo Mode";
      }
    },
    setRealtimeConnected(connected) {
      if (!connectionStatus) {
        return;
      }
      connectionStatus.dataset.connection = connected ? "online" : "offline";
      connectionStatus.textContent = `Realtime: ${connected ? "online" : "offline"}`;
    },
    syncAgentStates(states) {
      if (!agentList) {
        return;
      }

      const seen = new Set<string>();
      states.forEach((state) => {
        seen.add(state.id);
        let refs = agentNodes.get(state.id);
        if (!refs) {
          const node = document.createElement("li");
          node.className = "agent-list-item";
          node.innerHTML = `
            <span class="agent-list-name"></span>
            <span class="agent-list-meta"></span>
            <span class="agent-list-task"></span>
          `;
          const name = node.querySelector<HTMLSpanElement>(".agent-list-name");
          const meta = node.querySelector<HTMLSpanElement>(".agent-list-meta");
          const task = node.querySelector<HTMLSpanElement>(".agent-list-task");
          if (!name || !meta || !task) {
            return;
          }
          refs = { node, name, meta, task };
          agentNodes.set(state.id, refs);
          agentList.append(node);
        }

        refs.node.dataset.status = state.status;
        refs.name.textContent = `${state.name} · ${state.role}`;
        refs.meta.textContent = `${formatRealtimeStatus(state.status)}${state.connected ? "" : " · offline"}`;
        refs.task.textContent = state.task ?? "No active task";
      });

      agentNodes.forEach((refs, id) => {
        if (!seen.has(id)) {
          refs.node.remove();
          agentNodes.delete(id);
        }
      });
    },
    labelLayer,
    speechLayer,
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
          <span class="agent-task"></span>
        `;
        this.container.append(node);
        const name = node.querySelector<HTMLSpanElement>(".agent-name");
        const role = node.querySelector<HTMLSpanElement>(".agent-role");
        const status = node.querySelector<HTMLSpanElement>(".agent-status");
        const task = node.querySelector<HTMLSpanElement>(".agent-task");
        if (!name || !role || !status || !task) {
          node.remove();
          return;
        }
        refs = { node, name, role, status, task };
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
      refs.task.textContent = label.task ?? "";
      refs.task.style.display = label.task ? "block" : "none";
    });

    this.nodes.forEach(({ node }, id) => {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    });
  }
}
