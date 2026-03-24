import * as THREE from "three";
import { FACILITATOR_ROTATION } from "../config/meeting-rules";
import { createCharacterCreator } from "./characterCreator";
import type { ActivityLogEntry, AgentRuntimeState, LabelState, MeetingTurn, RealtimeAgentStatus } from "../types";

interface HudOptions {
  onResetCamera(): void;
  apiBase?: string | undefined;
}

interface HudApi {
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
  trigger: HTMLButtonElement;
  dot: HTMLSpanElement;
  name: HTMLSpanElement;
  role: HTMLSpanElement;
  status: HTMLSpanElement;
  task: HTMLSpanElement;
}

function formatRealtimeStatus(status: RealtimeAgentStatus): string {
  return status === "meeting" ? "meeting" : status;
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function createHud({ onResetCamera, apiBase = "http://localhost:3001" }: HudOptions): HudApi {
  const hud = document.createElement("div");
  hud.className = "hud";

  const topBar = document.createElement("header");
  topBar.className = "top-bar";
  topBar.innerHTML = `
    <div class="top-bar-section top-bar-brand">
      <span class="top-bar-label">EpicShot Office</span>
      <span class="agent-count">0 agents online</span>
      <span class="connection-pill" data-connection="offline" aria-label="Realtime disconnected">
        <i class="dot"></i>
      </span>
    </div>
    <div class="top-bar-section top-bar-actions">
      <button class="button secondary top-bar-button" type="button" data-action="toggle-activity">Activity</button>
      <button class="button top-bar-button" type="button" data-action="add-agent">Add Agent</button>
    </div>
  `;
  hud.append(topBar);

  const sidebar = document.createElement("aside");
  sidebar.className = "agent-sidebar";
  hud.append(sidebar);

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
          <button class="button secondary" type="button" data-action="reset">Reset View</button>
          <button class="button secondary" type="button" data-action="stop-meeting">Stop Meeting</button>
        </div>
      </div>
    </div>
    <div class="admin-section">
      <h3>Agent Controls</h3>
      <div class="admin-agent-list"></div>
    </div>
    <div class="admin-section">
      <h3>Roster</h3>
      <button class="button secondary" type="button" data-action="add-agent">Open Character Creator</button>
    </div>
  `;
  hud.append(adminPanel);

  const activityPanel = document.createElement("section");
  activityPanel.className = "activity-panel";
  activityPanel.hidden = true;
  activityPanel.innerHTML = `
    <div class="activity-header">
      <span class="eyebrow">Ops Feed</span>
      <strong>Activity Log</strong>
    </div>
    <div class="activity-log"></div>
  `;
  hud.append(activityPanel);

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

  const sidebarCollapsedKey = "sidebar-collapsed";
  const storedCollapsed = window.localStorage.getItem(sidebarCollapsedKey);
  let sidebarCollapsed = storedCollapsed === null ? true : storedCollapsed === "true";
  sidebar.dataset.collapsed = String(sidebarCollapsed);
  sidebar.innerHTML = `
    <div class="agent-sidebar-header">
      <button class="icon-button sidebar-toggle" type="button" data-action="toggle-sidebar" aria-label="${sidebarCollapsed ? "Expand agent sidebar" : "Collapse agent sidebar"}">
        <span class="sidebar-toggle-icon" aria-hidden="true">${sidebarCollapsed ? "☰" : "‹"}</span>
      </button>
      <div class="agent-sidebar-heading">
        <span class="eyebrow">Live Agents</span>
        <strong>Roster</strong>
      </div>
    </div>
    <ul class="agent-list"></ul>
    <div class="agent-sidebar-footer">
      <button class="button secondary" type="button" data-action="reset">Reset View</button>
      <button class="button secondary" type="button" data-action="admin-toggle">Control Room</button>
    </div>
  `;

  const connectionStatus = topBar.querySelector<HTMLSpanElement>(".connection-pill");
  const agentCount = topBar.querySelector<HTMLSpanElement>(".agent-count");
  const agentList = sidebar.querySelector<HTMLUListElement>(".agent-list");
  const sidebarToggleButton = sidebar.querySelector<HTMLButtonElement>('[data-action="toggle-sidebar"]');
  const sidebarToggleIcon = sidebar.querySelector<HTMLSpanElement>(".sidebar-toggle-icon");
  const topBarActivityButton = topBar.querySelector<HTMLButtonElement>('[data-action="toggle-activity"]');
  const addAgentButton = topBar.querySelector<HTMLButtonElement>('[data-action="add-agent"]');
  const resetButtons = hud.querySelectorAll<HTMLButtonElement>('[data-action="reset"]');
  const adminToggleButton = sidebar.querySelector<HTMLButtonElement>('[data-action="admin-toggle"]');
  const adminClose = adminPanel.querySelector<HTMLButtonElement>(".admin-close");
  const strategyTopic = adminPanel.querySelector<HTMLInputElement>('input[name="strategy-topic"]');
  const reviewPresenter = adminPanel.querySelector<HTMLSelectElement>('select[name="review-presenter"]');
  const meetingSpeed = adminPanel.querySelector<HTMLSelectElement>('select[name="meeting-speed"]');
  const adminAgentList = adminPanel.querySelector<HTMLDivElement>(".admin-agent-list");
  const activityLog = activityPanel.querySelector<HTMLDivElement>(".activity-log");
  const transcriptLog = transcriptPanel.querySelector<HTMLDivElement>(".transcript-log");
  const transcriptSummary = transcriptPanel.querySelector<HTMLDivElement>(".transcript-summary");
  const agentNodes = new Map<string, AgentListRefs>();
  let latestStates: AgentRuntimeState[] = [];
  let meetingActive = false;
  let activityVisible = false;
  const characterCreator = createCharacterCreator({
    apiBase,
    getExistingAgents: () => latestStates,
  });

  function setSidebarCollapsed(next: boolean): void {
    sidebarCollapsed = next;
    sidebar.dataset.collapsed = String(next);
    sidebarToggleButton?.setAttribute("aria-label", next ? "Expand agent sidebar" : "Collapse agent sidebar");
    if (sidebarToggleIcon) {
      sidebarToggleIcon.textContent = next ? "☰" : "‹";
    }
    window.localStorage.setItem(sidebarCollapsedKey, String(next));
  }

  function toggleActivity(force?: boolean): void {
    activityVisible = force ?? !activityVisible;
    activityPanel.hidden = !activityVisible;
    topBarActivityButton?.classList.toggle("active", activityVisible);
  }

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
      card.addEventListener("click", () => {
        characterCreator.openEdit(state);
      });
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

  sidebarToggleButton?.addEventListener("click", () => setSidebarCollapsed(!sidebarCollapsed));
  topBarActivityButton?.addEventListener("click", () => toggleActivity());
  addAgentButton?.addEventListener("click", () => {
    characterCreator.openCreate();
  });
  resetButtons.forEach((button) => {
    button.addEventListener("click", () => onResetCamera());
  });
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
  adminPanel.querySelector<HTMLButtonElement>('[data-action="add-agent"]')?.addEventListener("click", () => {
    characterCreator.openCreate();
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
    setRealtimeConnected(connected) {
      if (!connectionStatus) {
        return;
      }
      connectionStatus.dataset.connection = connected ? "online" : "offline";
      connectionStatus.setAttribute("aria-label", connected ? "Realtime connected" : "Realtime disconnected");
    },
    setMeetingActive(active) {
      meetingActive = active;
      transcriptPanel.hidden = !active && !(transcriptLog?.children.length);
      transcriptPanel.dataset.active = active ? "true" : "false";
    },
    syncAgentStates(states) {
      latestStates = [...states];
      renderAdminAgents();
      if (agentCount) {
        const connectedCount = states.filter((state) => state.connected).length;
        agentCount.textContent = `${connectedCount} agent${connectedCount === 1 ? "" : "s"} online`;
      }

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
            <button class="agent-list-button" type="button">
              <span class="agent-list-dot"></span>
              <span class="agent-list-body">
                <span class="agent-list-name"></span>
                <span class="agent-list-role"></span>
                <span class="agent-list-status"></span>
                <span class="agent-list-task"></span>
              </span>
            </button>
          `;
          const trigger = node.querySelector<HTMLButtonElement>(".agent-list-button");
          const dot = node.querySelector<HTMLSpanElement>(".agent-list-dot");
          const name = node.querySelector<HTMLSpanElement>(".agent-list-name");
          const role = node.querySelector<HTMLSpanElement>(".agent-list-role");
          const status = node.querySelector<HTMLSpanElement>(".agent-list-status");
          const task = node.querySelector<HTMLSpanElement>(".agent-list-task");
          if (!trigger || !dot || !name || !role || !status || !task) {
            return;
          }
          refs = { node, trigger, dot, name, role, status, task };
          agentNodes.set(state.id, refs);
          agentList.append(node);
          trigger.addEventListener("click", () => {
            const latest = latestStates.find((item) => item.id === state.id);
            if (latest) {
              characterCreator.openEdit(latest);
            }
          });
        }

        refs.node.dataset.status = state.status;
        refs.trigger.title = `${state.name} · ${state.role}`;
        refs.dot.dataset.status = state.status;
        refs.name.textContent = state.name;
        refs.role.textContent = state.role;
        const deskLabel = typeof state.deskIndex === "number" ? `Desk ${state.deskIndex + 1}` : "Desk unassigned";
        refs.status.textContent = `${formatRealtimeStatus(state.status)} · ${deskLabel}${state.connected ? "" : " · offline"}`;
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
