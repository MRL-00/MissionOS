import * as THREE from "three";
import { FACILITATOR_ROTATION } from "../config/meeting-rules";
import type { ActivityLogEntry, AgentRuntimeState, LabelState, MeetingTurn, RealtimeAgentStatus } from "../types";

interface HudOptions {
  onToggleDemo(): void;
  onResetCamera(): void;
  apiBase?: string | undefined;
}

interface HudApi {
  setDemoRunning(running: boolean): void;
  setRealtimeConnected(connected: boolean): void;
  setMeetingActive(active: boolean): void;
  syncAgentStates(states: AgentRuntimeState[]): void;
  syncActivityLog(entries: ActivityLogEntry[]): void;
  syncMeetingTranscript(turns: MeetingTurn[], summary?: string): void;
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
  return status === "meeting" ? "meeting" : status;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function createHud({ onToggleDemo, onResetCamera, apiBase = "http://localhost:3001" }: HudOptions): HudApi {
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
      <button class="button secondary" type="button" data-action="admin-toggle">Admin Panel</button>
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

  const adminPanel = document.createElement("aside");
  adminPanel.className = "admin-panel";
  adminPanel.hidden = true;
  adminPanel.innerHTML = `
    <div class="admin-header">
      <div>
        <span class="eyebrow">Control Room</span>
        <h2>Admin Panel</h2>
      </div>
      <button class="button secondary admin-close" type="button">Close</button>
    </div>
    <div class="admin-section">
      <h3>Quick Actions</h3>
      <div class="admin-grid">
        <button class="button" type="button" data-action="standup">Start Standup</button>
        <div class="meeting-action">
          <input class="admin-input" name="strategy-topic" placeholder="Strategy topic" />
          <button class="button" type="button" data-action="strategy">Start Strategy Meeting</button>
        </div>
        <div class="meeting-action">
          <select class="admin-select" name="review-presenter"></select>
          <button class="button" type="button" data-action="review">Start Review</button>
        </div>
        <div class="meeting-action inline">
          <select class="admin-select" name="meeting-speed">
            <option value="1">1x speed</option>
            <option value="2" selected>2x speed</option>
            <option value="3">3x speed</option>
          </select>
          <button class="button secondary" type="button" data-action="stop-meeting">Stop Meeting</button>
        </div>
      </div>
    </div>
    <div class="admin-section">
      <h3>Agent Controls</h3>
      <div class="admin-agent-list"></div>
    </div>
    <div class="admin-section">
      <h3>Register External Agent</h3>
      <div class="admin-grid">
        <input class="admin-input" name="register-name" placeholder="Name" />
        <input class="admin-input" name="register-role" placeholder="Role" />
        <button class="button secondary" type="button" data-action="register">Register External Agent</button>
      </div>
    </div>
    <div class="admin-section">
      <h3>Activity Log</h3>
      <div class="activity-log"></div>
    </div>
  `;
  hud.append(adminPanel);

  const transcriptPanel = document.createElement("section");
  transcriptPanel.className = "transcript-panel";
  transcriptPanel.hidden = true;
  transcriptPanel.innerHTML = `
    <div class="transcript-header">
      <span class="eyebrow">Live Meeting</span>
      <strong>Transcript</strong>
    </div>
    <div class="transcript-log"></div>
    <div class="transcript-summary"></div>
  `;
  hud.append(transcriptPanel);

  const labelLayer = document.createElement("div");
  labelLayer.className = "label-layer";
  hud.append(labelLayer);

  const speechLayer = document.createElement("div");
  speechLayer.className = "speech-layer";
  hud.append(speechLayer);

  document.body.append(hud);

  const demoButton = panel.querySelector<HTMLButtonElement>('[data-action="demo"]');
  const resetButton = panel.querySelector<HTMLButtonElement>('[data-action="reset"]');
  const adminToggleButton = panel.querySelector<HTMLButtonElement>('[data-action="admin-toggle"]');
  const connectionStatus = panel.querySelector<HTMLDivElement>(".connection-status");
  const agentList = panel.querySelector<HTMLUListElement>(".agent-list");
  const adminClose = adminPanel.querySelector<HTMLButtonElement>(".admin-close");
  const strategyTopic = adminPanel.querySelector<HTMLInputElement>('input[name="strategy-topic"]');
  const reviewPresenter = adminPanel.querySelector<HTMLSelectElement>('select[name="review-presenter"]');
  const meetingSpeed = adminPanel.querySelector<HTMLSelectElement>('select[name="meeting-speed"]');
  const registerName = adminPanel.querySelector<HTMLInputElement>('input[name="register-name"]');
  const registerRole = adminPanel.querySelector<HTMLInputElement>('input[name="register-role"]');
  const adminAgentList = adminPanel.querySelector<HTMLDivElement>(".admin-agent-list");
  const activityLog = adminPanel.querySelector<HTMLDivElement>(".activity-log");
  const transcriptLog = transcriptPanel.querySelector<HTMLDivElement>(".transcript-log");
  const transcriptSummary = transcriptPanel.querySelector<HTMLDivElement>(".transcript-summary");
  const agentNodes = new Map<string, AgentListRefs>();
  let latestStates: AgentRuntimeState[] = [];
  let meetingActive = false;

  async function post(path: string, body: unknown): Promise<void> {
    const response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
  }

  function facilitatorFor(agentIds: string[]): string {
    return FACILITATOR_ROTATION.find((agentId) => agentIds.includes(agentId)) ?? agentIds[0] ?? "pickle";
  }

  function buildTurns(agentIds: string[], type: "standup" | "strategy" | "review", presenter?: string, topic?: string): MeetingTurn[] {
    if (type === "standup") {
      return agentIds.map((agentId, index) => ({
        agentId,
        message: index === 0 ? "Yesterday closed cleanly. Today I’m unblocking the next slice." : "On track. No blockers from my side.",
        timestamp: Date.now() + index,
      }));
    }

    if (type === "review") {
      return agentIds.map((agentId, index) => ({
        agentId,
        message:
          agentId === presenter
            ? `Presenting the review for ${topic ?? "current deliverables"}.`
            : index % 2 === 0
              ? "The flow reads clearly from a user perspective."
              : "I’d tighten the edge cases before sign-off.",
        timestamp: Date.now() + index,
      }));
    }

    return agentIds.map((agentId, index) => ({
      agentId,
      message:
        index === 0
          ? `Framing the strategy discussion on ${topic ?? "the next milestone"}.`
          : "I support the direction, but we should watch sequencing and risk.",
      timestamp: Date.now() + index,
    }));
  }

  function selectedAgents(): AgentRuntimeState[] {
    return latestStates.filter((state) => state.connected);
  }

  async function runMeeting(type: "standup" | "strategy" | "review"): Promise<void> {
    const participants = selectedAgents().map((state) => state.id);
    const facilitatorId = facilitatorFor(participants);
    const presenter = type === "review" ? reviewPresenter?.value || participants[0] : undefined;
    const topic = type === "strategy" ? strategyTopic?.value.trim() || "Quarter planning" : type === "review" ? "Sprint review" : undefined;
    await post("/api/meeting/run", {
      speed: Number(meetingSpeed?.value ?? 2),
      script: {
        config: {
          type,
          participants,
          facilitatorId,
          presenter,
          topic,
        },
        turns: buildTurns(participants, type, presenter, topic),
        summary:
          type === "standup"
            ? "Standup finished. Actions are assigned and execution resumes."
            : type === "strategy"
              ? `Strategy alignment complete on ${topic}.`
              : `Review complete. ${presenter ?? facilitatorId} will fold feedback into the next revision.`,
      },
    });
  }

  function toggleAdmin(force?: boolean): void {
    const next = force ?? adminPanel.hidden;
    adminPanel.hidden = !next;
  }

  function renderAdminAgents(): void {
    if (!adminAgentList) {
      return;
    }

    adminAgentList.replaceChildren();

    latestStates.forEach((state) => {
      const card = document.createElement("div");
      card.className = "admin-agent-card";
      const head = document.createElement("div");
      head.className = "admin-agent-head";
      const name = document.createElement("strong");
      name.textContent = state.name;
      const role = document.createElement("span");
      role.textContent = state.role;
      head.append(name, role);

      const statuses: RealtimeAgentStatus[] = ["idle", "working", "meeting"];
      const statusRow = document.createElement("div");
      statusRow.className = "admin-status-row";
      statuses.forEach((status) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `mini-button${state.status === status ? " active" : ""}`;
        button.textContent = status;
        button.addEventListener("click", () => {
          void post("/api/agent/status", {
            agentId: state.id,
            status,
            location: status === "meeting" ? "meeting-room" : "desk",
            timestamp: Date.now(),
          });
        });
        statusRow.append(button);
      });

      const speechInput = document.createElement("input");
      speechInput.className = "admin-input";
      speechInput.placeholder = "Custom speech bubble";
      speechInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        void post("/api/agent/status", {
          agentId: state.id,
          status: state.status,
          location: state.status === "meeting" ? "meeting-room" : "desk",
          message: speechInput.value.trim(),
          task: state.task,
          timestamp: Date.now(),
        });
        speechInput.value = "";
      });

      card.append(head, statusRow, speechInput);
      adminAgentList.append(card);
    });

    if (reviewPresenter) {
      reviewPresenter.replaceChildren();
      latestStates.forEach((state) => {
        const option = document.createElement("option");
        option.value = state.id;
        option.textContent = state.name;
        reviewPresenter.append(option);
      });
    }
  }

  demoButton?.addEventListener("click", () => onToggleDemo());
  resetButton?.addEventListener("click", () => onResetCamera());
  adminToggleButton?.addEventListener("click", () => toggleAdmin());
  adminClose?.addEventListener("click", () => toggleAdmin(false));

  adminPanel.querySelector<HTMLButtonElement>('[data-action="standup"]')?.addEventListener("click", () => {
    void runMeeting("standup");
  });
  adminPanel.querySelector<HTMLButtonElement>('[data-action="strategy"]')?.addEventListener("click", () => {
    void runMeeting("strategy");
  });
  adminPanel.querySelector<HTMLButtonElement>('[data-action="review"]')?.addEventListener("click", () => {
    void runMeeting("review");
  });
  adminPanel.querySelector<HTMLButtonElement>('[data-action="stop-meeting"]')?.addEventListener("click", () => {
    void post("/api/meeting/stop", {});
  });
  adminPanel.querySelector<HTMLButtonElement>('[data-action="register"]')?.addEventListener("click", () => {
    const name = registerName?.value.trim() ?? "";
    const role = registerRole?.value.trim() ?? "";
    if (!name || !role) {
      return;
    }
    void post("/api/agent/register", {
      id: slugify(name),
      name,
      role,
    });
    if (registerName) {
      registerName.value = "";
    }
    if (registerRole) {
      registerRole.value = "";
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }
    if (event.key === "`") {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      toggleAdmin();
    }
  });

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
    setMeetingActive(active) {
      meetingActive = active;
      transcriptPanel.hidden = !active && !(transcriptLog?.children.length);
      transcriptPanel.dataset.active = active ? "true" : "false";
    },
    syncAgentStates(states) {
      latestStates = [...states];
      renderAdminAgents();

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
    syncActivityLog(entries) {
      if (!activityLog) {
        return;
      }

      activityLog.replaceChildren(
        ...entries.map((entry) => {
          const row = document.createElement("div");
          row.className = "activity-row";
          const time = document.createElement("span");
          time.className = "activity-time";
          time.textContent = timeLabel(entry.timestamp);
          const message = document.createElement("span");
          message.className = "activity-message";
          message.textContent = entry.message;
          row.append(time, message);
          return row;
        }),
      );
    },
    syncMeetingTranscript(turns, summary) {
      if (!transcriptLog || !transcriptSummary) {
        return;
      }

      transcriptLog.replaceChildren(
        ...turns.map((turn) => {
          const state = latestStates.find((item) => item.id === turn.agentId);
          const row = document.createElement("div");
          row.className = "transcript-row";
          const speaker = document.createElement("strong");
          speaker.textContent = state?.name ?? turn.agentId;
          const message = document.createElement("span");
          message.textContent = turn.message;
          row.append(speaker, message);
          return row;
        }),
      );
      transcriptLog.scrollTop = transcriptLog.scrollHeight;
      transcriptSummary.textContent = summary ? `Summary: ${summary}` : "";
      transcriptPanel.hidden = !meetingActive && turns.length === 0 && !summary;
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
