import * as THREE from "three";
import { getApiBase } from "../config/api";
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
  message: HTMLSpanElement;
  hoverTimer: number | null;
  expanded: boolean;
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

type ActivityViewFilter = "all" | "messages" | "status" | "meetings";

function formatRealtimeStatus(status: RealtimeAgentStatus): string {
  switch (status) {
    case "working":
      return "Working \u{1F7E2}";
    case "meeting":
      return "Meeting";
    case "entering":
      return "Arriving";
    case "leaving":
      return "Leaving";
    case "idle":
    default:
      return "Idle";
  }
}

function activityKindLabel(kind: ActivityLogEntry["kind"]): string {
  switch (kind) {
    case "agent-message":
      return "Message";
    case "agent-status":
      return "Status";
    case "agent-spawn":
      return "Spawn";
    case "agent-complete":
      return "Complete";
    case "meeting-start":
      return "Meeting Start";
    case "meeting-turn":
      return "Meeting Turn";
    case "meeting-end":
      return "Meeting End";
    case "meeting-stop":
      return "Meeting Stop";
    case "registration":
    default:
      return "Roster";
  }
}

function matchesActivityViewFilter(kind: ActivityLogEntry["kind"], filter: ActivityViewFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "messages") {
    return kind === "agent-message" || kind === "meeting-turn";
  }

  if (filter === "meetings") {
    return kind === "meeting-start" || kind === "meeting-turn" || kind === "meeting-end" || kind === "meeting-stop";
  }

  return kind === "agent-status" || kind === "agent-spawn" || kind === "agent-complete" || kind === "registration";
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function createHud({ onResetCamera, apiBase = getApiBase() }: HudOptions): HudApi {
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
  activityPanel.id = "activity-panel";
  activityPanel.hidden = true;
  activityPanel.style.display = "none";
  activityPanel.setAttribute("aria-hidden", "true");
  activityPanel.innerHTML = `
    <div class="activity-header">
      <div>
        <span class="eyebrow">Ops Feed</span>
        <strong>Activity Log</strong>
      </div>
      <div class="activity-header-actions">
        <button class="button secondary top-bar-button" type="button" data-action="reset-activity-filters">All Activity</button>
        <button class="icon-button" type="button" data-action="close-activity" aria-label="Close activity log">×</button>
      </div>
    </div>
    <div class="activity-toolbar">
      <label class="activity-filter-field">
        <span>Agent</span>
        <select class="admin-select activity-agent-filter"></select>
      </label>
      <label class="activity-filter-field">
        <span>View</span>
        <select class="admin-select activity-kind-filter">
          <option value="all">All activity</option>
          <option value="messages">Conversation</option>
          <option value="status">Status updates</option>
          <option value="meetings">Meetings</option>
        </select>
      </label>
      <label class="activity-filter-field activity-search-field">
        <span>Search</span>
        <input class="admin-input activity-search" type="search" placeholder="Search messages, tasks, or names" />
      </label>
    </div>
    <div class="activity-summary"></div>
    <div class="activity-log"></div>
    <div class="activity-empty" hidden>No activity matches the current filter.</div>
  `;
  hud.append(activityPanel);

  const activityBackdrop = document.createElement("button");
  activityBackdrop.className = "activity-panel-backdrop";
  activityBackdrop.type = "button";
  activityBackdrop.hidden = true;
  activityBackdrop.setAttribute("aria-label", "Dismiss activity log");
  hud.append(activityBackdrop);

  const sidebarBackdrop = document.createElement("button");
  sidebarBackdrop.className = "sidebar-backdrop";
  sidebarBackdrop.type = "button";
  sidebarBackdrop.hidden = true;
  sidebarBackdrop.setAttribute("aria-label", "Dismiss agent sidebar");
  hud.append(sidebarBackdrop);

  const mobileActivityToggle = document.createElement("button");
  mobileActivityToggle.className = "mobile-activity-toggle";
  mobileActivityToggle.type = "button";
  mobileActivityToggle.hidden = true;
  mobileActivityToggle.setAttribute("aria-controls", "activity-panel");
  mobileActivityToggle.setAttribute("aria-expanded", "false");
  mobileActivityToggle.setAttribute("aria-label", "Open activity log");
  mobileActivityToggle.innerHTML = `<span aria-hidden="true">Activity</span>`;
  hud.append(mobileActivityToggle);

  const transcriptPanel = document.createElement("section");
  transcriptPanel.className = "transcript-panel";
  transcriptPanel.hidden = true;
  transcriptPanel.innerHTML = `
    <div class="transcript-header">
      <div>
        <span class="eyebrow">Live Meeting</span>
        <strong>Transcript</strong>
      </div>
      <button class="icon-button" type="button" data-action="close-transcript" aria-label="Close transcript">×</button>
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
  const activitySummary = activityPanel.querySelector<HTMLDivElement>(".activity-summary");
  const activityEmpty = activityPanel.querySelector<HTMLDivElement>(".activity-empty");
  const activityAgentFilter = activityPanel.querySelector<HTMLSelectElement>(".activity-agent-filter");
  const activityKindFilter = activityPanel.querySelector<HTMLSelectElement>(".activity-kind-filter");
  const activitySearch = activityPanel.querySelector<HTMLInputElement>(".activity-search");
  const transcriptLog = transcriptPanel.querySelector<HTMLDivElement>(".transcript-log");
  const transcriptSummary = transcriptPanel.querySelector<HTMLDivElement>(".transcript-summary");
  const agentNodes = new Map<string, AgentListRefs>();
  let latestStates: AgentRuntimeState[] = [];
  let latestActivityEntries: ActivityLogEntry[] = [];
  let meetingActive = false;
  let transcriptDismissedForMeeting = false;
  let activityVisible = false;
  let activityAgentId = "";
  let activityView: ActivityViewFilter = "all";
  let activitySearchTerm = "";
  let activityMessageSequence = 0;
  let activityMeasurementFrame = 0;
  const characterCreator = createCharacterCreator({
    apiBase,
    getExistingAgents: () => latestStates,
  });
  const mobileMediaQuery = window.matchMedia("(max-width: 767px)");
  let isMobileLayout = mobileMediaQuery.matches;
  let desktopSidebarCollapsed = sidebarCollapsed;

  function updateTranscriptVisibility(turnCount = transcriptLog?.children.length ?? 0, summaryText = transcriptSummary?.textContent ?? ""): void {
    const hasTranscriptContent = turnCount > 0 || summaryText.length > 0;
    transcriptPanel.hidden = transcriptDismissedForMeeting || (!meetingActive && !hasTranscriptContent);
  }

  function measureActivityMessages(): void {
    activityMeasurementFrame = 0;
    if (!activityLog) {
      return;
    }

    const rows = activityLog.querySelectorAll<HTMLElement>(".activity-row");
    rows.forEach((row) => {
      const message = row.querySelector<HTMLParagraphElement>(".activity-message");
      const toggle = row.querySelector<HTMLButtonElement>(".activity-message-toggle");
      if (!message || !toggle) {
        return;
      }

      const expanded = !message.classList.contains("activity-message-clamped");
      message.classList.remove("activity-message-clamped");
      const naturalHeight = message.scrollHeight;
      const computedStyle = window.getComputedStyle(message);
      const lineHeight = Number.parseFloat(computedStyle.lineHeight) || Number.parseFloat(computedStyle.fontSize) * 1.5 || 0;
      const clampedHeight = lineHeight * 3;
      const overflowing = naturalHeight > clampedHeight + 1;
      if (!overflowing) {
        toggle.hidden = true;
        toggle.textContent = "Show more";
        toggle.setAttribute("aria-expanded", "false");
        return;
      }

      toggle.hidden = false;
      if (!expanded) {
        message.classList.add("activity-message-clamped");
      }
      toggle.textContent = expanded ? "Show less" : "Show more";
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  }

  function scheduleActivityMessageMeasurement(): void {
    if (activityMeasurementFrame !== 0) {
      return;
    }
    activityMeasurementFrame = window.requestAnimationFrame(() => {
      measureActivityMessages();
    });
  }

  const activityLogResizeObserver = activityLog
    ? new ResizeObserver(() => {
        measureActivityMessages();
      })
    : undefined;
  if (activityLog) {
    activityLogResizeObserver?.observe(activityLog);
  }

  function getAgentName(agentId?: string): string | undefined {
    if (!agentId) {
      return undefined;
    }
    return latestStates.find((state) => state.id === agentId)?.name;
  }

  function setSidebarCollapsed(next: boolean, persist = true): void {
    sidebarCollapsed = next;
    sidebar.dataset.collapsed = String(next);
    sidebarBackdrop.hidden = !(isMobileLayout && !next);
    sidebarToggleButton?.setAttribute("aria-label", next ? "Expand agent sidebar" : "Collapse agent sidebar");
    if (sidebarToggleIcon) {
      sidebarToggleIcon.textContent = next ? "☰" : "‹";
    }
    if (persist) {
      window.localStorage.setItem(sidebarCollapsedKey, String(next));
    }
  }

  function syncActivityToggleState(): void {
    const label = activityVisible ? "Hide activity" : "Activity";
    mobileActivityToggle.hidden = !isMobileLayout;
    mobileActivityToggle.classList.toggle("active", activityVisible);
    mobileActivityToggle.innerHTML = `<span aria-hidden="true">${label}</span>`;
    mobileActivityToggle.setAttribute("aria-expanded", activityVisible ? "true" : "false");
    mobileActivityToggle.setAttribute("aria-label", activityVisible ? "Hide activity log" : "Show activity log");
  }

  function toggleActivity(force?: boolean): void {
    activityVisible = force ?? !activityVisible;
    activityPanel.hidden = !activityVisible;
    activityPanel.style.display = activityVisible ? "grid" : "none";
    activityPanel.setAttribute("aria-hidden", activityVisible ? "false" : "true");
    activityBackdrop.hidden = !(isMobileLayout && activityVisible);
    topBarActivityButton?.classList.toggle("active", activityVisible);
    syncActivityToggleState();
    if (activityVisible) {
      scheduleActivityMessageMeasurement();
    }
  }

  function applyMobileLayout(next: boolean): void {
    isMobileLayout = next;
    hud.dataset.mobile = next ? "true" : "false";
    activityPanel.dataset.mobile = next ? "true" : "false";
    sidebar.dataset.mobile = next ? "true" : "false";
    topBarActivityButton?.toggleAttribute("hidden", next);
    if (next) {
      desktopSidebarCollapsed = sidebarCollapsed;
      setSidebarCollapsed(true, false);
      toggleActivity(false);
    } else {
      setSidebarCollapsed(desktopSidebarCollapsed, false);
      activityBackdrop.hidden = true;
      mobileActivityToggle.hidden = true;
    }
    syncActivityToggleState();
  }

  function syncActivityAgentOptions(): void {
    if (!activityAgentFilter) {
      return;
    }

    activityAgentFilter.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All agents";
    activityAgentFilter.append(all);

    latestStates.forEach((state) => {
      const option = document.createElement("option");
      option.value = state.id;
      option.textContent = state.name;
      activityAgentFilter.append(option);
    });

    if (activityAgentId && !latestStates.some((state) => state.id === activityAgentId)) {
      activityAgentId = "";
    }
    activityAgentFilter.value = activityAgentId;
  }

  function renderActivityLog(): void {
    if (!activityLog || !activitySummary || !activityEmpty) {
      return;
    }

    const filteredEntries = latestActivityEntries.filter((entry) => {
      if (activityAgentId && entry.agentId !== activityAgentId) {
        return false;
      }
      if (!matchesActivityViewFilter(entry.kind, activityView)) {
        return false;
      }
      if (!activitySearchTerm) {
        return true;
      }

      const agentName = getAgentName(entry.agentId)?.toLowerCase() ?? "";
      const haystack = `${entry.message} ${agentName} ${entry.agentId ?? ""}`.toLowerCase();
      return haystack.includes(activitySearchTerm);
    });

    const subject = activityAgentId ? getAgentName(activityAgentId) ?? activityAgentId : "everyone";
    const viewLabel =
      activityView === "all"
        ? "all activity"
        : activityView === "messages"
          ? "conversation"
          : activityView === "meetings"
            ? "meeting updates"
            : "status changes";
    activitySummary.textContent = `Showing ${viewLabel} for ${subject} · ${filteredEntries.length} item${filteredEntries.length === 1 ? "" : "s"}`;

    activityEmpty.hidden = filteredEntries.length > 0;
    activityLog.hidden = filteredEntries.length === 0;
    activityLog.replaceChildren(
      ...filteredEntries.map((entry) => {
        const row = document.createElement("article");
        row.className = "activity-row";
        row.dataset.kind = entry.kind;

        const header = document.createElement("div");
        header.className = "activity-row-header";

        const meta = document.createElement("div");
        meta.className = "activity-row-meta";

        const time = document.createElement("span");
        time.className = "activity-time";
        time.textContent = timeLabel(entry.timestamp);
        meta.append(time);

        if (entry.agentId) {
          const agent = document.createElement("button");
          agent.type = "button";
          agent.className = "activity-agent-chip";
          agent.textContent = getAgentName(entry.agentId) ?? entry.agentId;
          agent.addEventListener("click", () => {
            focusActivity(entry.agentId);
          });
          meta.append(agent);
        }

        const kind = document.createElement("span");
        kind.className = "activity-kind";
        kind.textContent = activityKindLabel(entry.kind);
        header.append(meta, kind);

        const message = document.createElement("p");
        const messageId = `activity-message-${activityMessageSequence += 1}`;
        const agentLabel = entry.agentId ? getAgentName(entry.agentId) ?? entry.agentId : "system";
        message.className = "activity-message activity-message-clamped";
        message.id = messageId;
        message.textContent = entry.message;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "activity-message-toggle";
        toggle.hidden = true;
        toggle.textContent = "Show more";
        toggle.setAttribute("aria-controls", messageId);
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", `Show more for message from ${agentLabel}`);
        toggle.addEventListener("click", () => {
          const expanded = !message.classList.toggle("activity-message-clamped");
          toggle.textContent = expanded ? "Show less" : "Show more";
          toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
          toggle.setAttribute(
            "aria-label",
            `${expanded ? "Show less" : "Show more"} for message from ${agentLabel}`,
          );
        });

        row.append(header, message, toggle);
        return row;
      }),
    );
    scheduleActivityMessageMeasurement();
  }

  function focusActivity(agentId = ""): void {
    activityAgentId = agentId;
    if (activityAgentFilter) {
      activityAgentFilter.value = activityAgentId;
    }
    renderActivityLog();
    toggleActivity(true);
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

  sidebarToggleButton?.addEventListener("click", () => {
    setSidebarCollapsed(!sidebarCollapsed, !isMobileLayout);
  });
  sidebarBackdrop.addEventListener("click", () => setSidebarCollapsed(true, false));
  topBarActivityButton?.addEventListener("click", () => toggleActivity());
  mobileActivityToggle.addEventListener("click", () => toggleActivity());
  activityBackdrop.addEventListener("click", () => toggleActivity(false));
  activityPanel.querySelector<HTMLButtonElement>('[data-action="close-activity"]')?.addEventListener("click", () => toggleActivity(false));
  transcriptPanel.querySelector<HTMLButtonElement>('[data-action="close-transcript"]')?.addEventListener("click", () => {
    transcriptDismissedForMeeting = true;
    updateTranscriptVisibility();
  });
  activityPanel.querySelector<HTMLButtonElement>('[data-action="reset-activity-filters"]')?.addEventListener("click", () => {
    activityAgentId = "";
    activityView = "all";
    activitySearchTerm = "";
    if (activityAgentFilter) {
      activityAgentFilter.value = "";
    }
    if (activityKindFilter) {
      activityKindFilter.value = "all";
    }
    if (activitySearch) {
      activitySearch.value = "";
    }
    renderActivityLog();
  });
  activityAgentFilter?.addEventListener("change", () => {
    activityAgentId = activityAgentFilter.value;
    renderActivityLog();
  });
  activityKindFilter?.addEventListener("change", () => {
    activityView = (activityKindFilter.value as ActivityViewFilter) || "all";
    renderActivityLog();
  });
  activitySearch?.addEventListener("input", () => {
    activitySearchTerm = activitySearch.value.trim().toLowerCase();
    renderActivityLog();
  });
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
    if (event.key === "Escape" && activityVisible) {
      toggleActivity(false);
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

  const handleMobileMediaChange = (event: MediaQueryListEvent): void => {
    applyMobileLayout(event.matches);
  };

  if (typeof mobileMediaQuery.addEventListener === "function") {
    mobileMediaQuery.addEventListener("change", handleMobileMediaChange);
  } else {
    mobileMediaQuery.addListener(handleMobileMediaChange);
  }

  applyMobileLayout(isMobileLayout);

  return {
    setRealtimeConnected(connected) {
      if (!connectionStatus) {
        return;
      }
      connectionStatus.dataset.connection = connected ? "online" : "offline";
      connectionStatus.setAttribute("aria-label", connected ? "Realtime connected" : "Realtime disconnected");
    },
    setMeetingActive(active) {
      if (active && !meetingActive) {
        transcriptDismissedForMeeting = false;
      }
      meetingActive = active;
      updateTranscriptVisibility();
      transcriptPanel.dataset.active = active ? "true" : "false";
    },
    syncAgentStates(states) {
      latestStates = [...states];
      renderAdminAgents();
      syncActivityAgentOptions();
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
            focusActivity(state.id);
          });
          trigger.addEventListener("dblclick", () => {
            const latest = latestStates.find((item) => item.id === state.id);
            if (latest) {
              characterCreator.openEdit(latest);
            }
          });
        }

        refs.node.dataset.status = state.status;
        refs.node.dataset.selected = state.id === activityAgentId ? "true" : "false";
        refs.trigger.title = `${state.name} · ${state.role} · click to filter activity`;
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
      renderActivityLog();
    },
    syncActivityLog(entries) {
      latestActivityEntries = [...entries];
      renderActivityLog();
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
      updateTranscriptVisibility(turns.length, transcriptSummary.textContent);
    },
    labelLayer,
    speechLayer,
  };
}

export class LabelRenderer {
  container: HTMLDivElement;
  nodes: Map<string, LabelRefs>;
  screenPosition: THREE.Vector3;
  hoverExpandDelay: number;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.nodes = new Map();
    this.screenPosition = new THREE.Vector3();
    this.hoverExpandDelay = 1000;
  }

  private clearHoverTimer(refs: LabelRefs): void {
    if (refs.hoverTimer !== null) {
      window.clearTimeout(refs.hoverTimer);
      refs.hoverTimer = null;
    }
  }

  private setExpanded(refs: LabelRefs, expanded: boolean): void {
    refs.expanded = expanded;
    refs.node.dataset.expanded = expanded ? "true" : "false";
    refs.node.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  sync(labels: LabelState[], camera: THREE.Camera, viewport: { width: number; height: number }): void {
    const seen = new Set<string>();

    labels.forEach((label) => {
      seen.add(label.id);
      let refs = this.nodes.get(label.id);
      if (!refs) {
        const node = document.createElement("div");
        node.className = "agent-label";
        node.tabIndex = 0;
        node.setAttribute("role", "button");
        node.dataset.expanded = "false";
        node.setAttribute("aria-expanded", "false");
        node.innerHTML = `
          <span class="agent-name"></span>
          <span class="agent-role"></span>
          <span class="agent-status"></span>
          <span class="agent-message"></span>
        `;
        this.container.append(node);
        const name = node.querySelector<HTMLSpanElement>(".agent-name");
        const role = node.querySelector<HTMLSpanElement>(".agent-role");
        const status = node.querySelector<HTMLSpanElement>(".agent-status");
        const message = node.querySelector<HTMLSpanElement>(".agent-message");
        if (!name || !role || !status || !message) {
          node.remove();
          return;
        }
        const nextRefs: LabelRefs = {
          node,
          name,
          role,
          status,
          message,
          hoverTimer: null,
          expanded: false,
        };
        node.addEventListener("pointerenter", () => {
          this.clearHoverTimer(nextRefs);
          nextRefs.hoverTimer = window.setTimeout(() => {
            this.setExpanded(nextRefs, true);
            nextRefs.hoverTimer = null;
          }, this.hoverExpandDelay);
        });
        node.addEventListener("pointerleave", () => {
          this.clearHoverTimer(nextRefs);
          this.setExpanded(nextRefs, false);
        });
        node.addEventListener("click", () => {
          this.clearHoverTimer(nextRefs);
          this.setExpanded(nextRefs, true);
        });
        node.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          this.clearHoverTimer(nextRefs);
          this.setExpanded(nextRefs, true);
        });
        refs = nextRefs;
        this.nodes.set(label.id, refs);
      }

      this.screenPosition.copy(label.worldPosition).project(camera);
      const visible = this.screenPosition.z > -1 && this.screenPosition.z < 1;
      refs.node.style.display = visible ? "block" : "none";
      if (!visible) {
        this.clearHoverTimer(refs);
        this.setExpanded(refs, false);
      }

      if (visible) {
        const x = (this.screenPosition.x * 0.5 + 0.5) * viewport.width;
        const y = (-this.screenPosition.y * 0.5 + 0.5) * viewport.height;
        refs.node.style.left = `${x}px`;
        refs.node.style.top = `${y}px`;
      }

      refs.name.textContent = label.name;
      refs.role.textContent = label.role;
      refs.status.dataset.status = label.status;
      refs.status.textContent = formatRealtimeStatus(label.status === "in-meeting" ? "meeting" : label.status);
      refs.status.setAttribute("aria-label", refs.status.textContent);
      refs.message.textContent = label.message ?? "";
      refs.message.hidden = !label.message;
      refs.node.dataset.hasMessage = label.message ? "true" : "false";
      refs.node.setAttribute(
        "aria-label",
        label.message
          ? `${label.name}, ${label.role}, ${refs.status.textContent}. Last message: ${label.message}`
          : `${label.name}, ${label.role}, ${refs.status.textContent}`,
      );
    });

    this.nodes.forEach((refs, id) => {
      if (!seen.has(id)) {
        this.clearHoverTimer(refs);
        refs.node.remove();
        this.nodes.delete(id);
      }
    });
  }
}
