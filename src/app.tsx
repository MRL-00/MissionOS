import { Suspense, lazy, startTransition, useDeferredValue, useEffect, useState } from "react";
import { DEPLOY_BADGE_LABEL } from "./config/buildInfo";
import { useMissionControl, type MissionView } from "./mission/hooks/useMissionControl";
import { compareMissionTasksForBoard, getMissionTaskBoardStage } from "./mission/taskBoard";
import type {
  MissionTask,
  ProviderAgentRecord,
  MissionTaskDetail,
  MissionTaskHandoff,
  MissionTaskUpdateRequest,
  ProviderConnector,
} from "./mission/types";

const MissionScene = lazy(async () => {
  const module = await import("./mission/scene/MissionScene");
  return { default: module.MissionScene };
});

const NAV_ITEMS: Array<{ id: MissionView; label: string; hint: string }> = [
  { id: "mission", label: "Mission Control", hint: "Live office and triage" },
  { id: "tasks", label: "Tasks", hint: "Linear-backed execution" },
  { id: "schedules", label: "Schedules", hint: "Provider cron and jobs" },
  { id: "settings", label: "Settings", hint: "Connectors and staging" },
];

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function formatClockTime(timestamp?: number): string {
  if (!timestamp) {
    return "n/a";
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(timestamp?: number): string {
  if (!timestamp) {
    return "n/a";
  }

  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeUpdate(timestamp?: number): string {
  if (!timestamp) {
    return "No sync yet";
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) {
    return "Updated just now";
  }
  if (diffMinutes === 1) {
    return "Updated 1 minute ago";
  }
  if (diffMinutes < 60) {
    return `Updated ${diffMinutes} minutes ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  return `Updated ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
}

function formatRelativeStamp(timestamp?: number): string {
  if (!timestamp) {
    return "n/a";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  if (diffMs < 60_000) {
    return "now";
  }

  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
}

function taskCycleLabel(task: MissionTask): string {
  if (!task.cycle) {
    return "No cycle";
  }
  if (task.cycle.name && task.cycle.name !== "Cycle") {
    return task.cycle.name;
  }
  if (typeof task.cycle.number === "number") {
    return `Cycle ${task.cycle.number}`;
  }
  return "Cycle";
}

function connectionTone(state: "connecting" | "connected" | "offline"): string {
  if (state === "connected") {
    return "bg-linear-teal/15 text-linear-teal border-linear-teal/25";
  }
  if (state === "connecting") {
    return "bg-linear-warm/15 text-linear-warm border-linear-warm/25";
  }
  return "bg-linear-red/15 text-linear-red border-linear-red/25";
}

function statusTone(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("block")) {
    return "bg-linear-red/15 text-linear-red border-linear-red/25";
  }
  if (normalized.includes("review") || normalized.includes("qa") || normalized.includes("merge")) {
    return "bg-linear-warm/15 text-linear-warm border-linear-warm/25";
  }
  if (normalized.includes("done") || normalized.includes("complete")) {
    return "bg-linear-teal/15 text-linear-teal border-linear-teal/25";
  }
  return "bg-linear-surfaceAlt text-linear-ink border-linear-lineStrong";
}

function taskWorkflowTone(task: MissionTask): string {
  switch (getMissionTaskBoardStage(task.state)) {
    case "todo":
      return "bg-sky-500/15 text-sky-200 border-sky-400/25";
    case "in_progress":
      return "bg-amber-500/15 text-amber-200 border-amber-400/25";
    case "qa_review":
      return "bg-orange-500/15 text-orange-200 border-orange-400/25";
    case "uat_review":
      return "bg-rose-500/15 text-rose-200 border-rose-400/25";
    case "ready_to_deploy":
      return "bg-cyan-500/15 text-cyan-200 border-cyan-400/25";
    case "deployed":
      return "bg-emerald-500/15 text-emerald-200 border-emerald-400/25";
    default:
      return statusTone(task.state.name);
  }
}

function connectorTone(status: ProviderConnector["health"]["status"]): string {
  if (status === "ok") {
    return "bg-linear-teal/15 text-linear-teal border-linear-teal/25";
  }
  if (status === "syncing") {
    return "bg-linear-warm/15 text-linear-warm border-linear-warm/25";
  }
  if (status === "error") {
    return "bg-linear-red/15 text-linear-red border-linear-red/25";
  }
  return "bg-linear-surfaceAlt text-linear-muted border-linear-lineStrong";
}

function SectionCard(props: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("mission-panel flex flex-col gap-3 p-4", props.className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-white">{props.title}</h2>
          {props.subtitle ? <p className="mission-muted mt-1">{props.subtitle}</p> : null}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function MetricCard(props: { label: string; value: string | number; hint?: string; tone?: "default" | "good" | "warn" | "danger" }) {
  const toneClass = props.tone === "good"
    ? "border-linear-teal/20 bg-linear-teal/10"
    : props.tone === "warn"
      ? "border-linear-warm/20 bg-linear-warm/10"
      : props.tone === "danger"
        ? "border-linear-red/25 bg-linear-red/10"
        : "border-linear-line bg-linear-surface";

  return (
    <article className={cx("rounded-xl border p-3.5", toneClass)}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-linear-muted">{props.label}</p>
      <div className="mt-2 text-xl font-semibold text-white">{props.value}</div>
      {props.hint ? <p className="mission-muted mt-2">{props.hint}</p> : null}
    </article>
  );
}

function TaskDetailPanel(props: {
  detail: MissionTaskDetail | null;
  agentNames: string[];
  busyKey: string | null;
  onUpdate(taskId: string, input: MissionTaskUpdateRequest): Promise<void>;
  onComment(taskId: string, body: string): Promise<void>;
  onHandoff(taskId: string, note: string, toAgentName: string): Promise<void>;
  onRespond(handoffId: string, taskId: string, status: "accepted" | "declined"): Promise<void>;
}) {
  const task = props.detail?.task ?? null;
  const [title, setTitle] = useState("");
  const [stateName, setStateName] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [handoffTarget, setHandoffTarget] = useState("");

  useEffect(() => {
    if (!task) {
      setTitle("");
      setStateName("");
      setAssigneeId("");
      setCommentBody("");
      setHandoffNote("");
      setHandoffTarget("");
      return;
    }

    setTitle(task.title);
    setStateName(task.state.name);
    setAssigneeId(task.assignee?.id ?? "");
    setCommentBody("");
    setHandoffNote("");
    setHandoffTarget("");
  }, [task?.id]);

  if (!task || !props.detail) {
    return (
      <SectionCard title="Task Detail" subtitle="Pick a task from the board to inspect its Linear data, comments, and handoffs.">
        <div className="rounded-xl border border-dashed border-linear-line bg-linear-surface px-5 py-16 text-center text-linear-muted">
          Select a task to open its mission-control detail panel.
        </div>
      </SectionCard>
    );
  }

  const busyPrefix = `task:${task.id}`;
  const isBusy = props.busyKey?.startsWith(busyPrefix) ?? false;
  const assigneeOptions = Array.from(
    new Map(
      props.detail.task.assignee ? [[props.detail.task.assignee.id, props.detail.task.assignee.name]] : [],
    ),
  );

  return (
    <SectionCard
      title={task.title}
      subtitle={`${task.identifier} · ${task.team.name}${task.cycle ? ` · ${taskCycleLabel(task)}` : ""}`}
      action={<span className={cx("mission-badge border", taskWorkflowTone(task))}>{task.state.name}</span>}
      className="h-full"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <label className="mission-section-label">Title</label>
            <input
              className="mission-input mt-3"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mission-section-label">State</span>
                <input
                  className="mission-input mt-2"
                  value={stateName}
                  onChange={(event) => setStateName(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mission-section-label">Assignee ID</span>
                <input
                  className="mission-input mt-2"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  placeholder="Leave blank to keep current assignee"
                />
              </label>
            </div>
            <button
              className="mission-button mt-4"
              disabled={isBusy}
              onClick={() => props.onUpdate(task.id, { title, stateName, assigneeId: assigneeId || null })}
            >
              {isBusy ? "Saving..." : "Save to Linear"}
            </button>
          </div>

          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-base font-semibold text-white">Comments</h3>
              <span className="mission-muted">{props.detail.comments.length} synced</span>
            </div>
            <div className="mt-4 space-y-3">
              {props.detail.comments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-linear-line px-4 py-6 text-center text-linear-muted">
                  No comments synced yet.
                </div>
              ) : (
                props.detail.comments.map((comment) => (
                  <article key={comment.id} className="mission-list-item">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm text-white">{comment.authorName}</strong>
                      <span className="mission-muted">{formatDateTime(comment.createdAt)}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-linear-ink">{comment.body}</p>
                  </article>
                ))
              )}
            </div>
            <textarea
              className="mission-input mt-4 min-h-[120px]"
              placeholder="Add a new Linear comment..."
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
            <button
              className="mission-button-muted mt-3"
              disabled={isBusy || !commentBody.trim()}
              onClick={async () => {
                await props.onComment(task.id, commentBody.trim());
                setCommentBody("");
              }}
            >
              Add comment
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <h3 className="font-display text-sm font-semibold text-white">Task metadata</h3>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="mission-section-label">Team</dt>
                <dd className="mt-1 text-sm text-white">{task.team.name}</dd>
              </div>
              <div>
                <dt className="mission-section-label">Assignee</dt>
                <dd className="mt-1 text-sm text-white">{task.assignee?.name ?? "Unassigned"}</dd>
              </div>
              <div>
                <dt className="mission-section-label">Cycle</dt>
                <dd className="mt-1 text-sm text-white">{taskCycleLabel(task)}</dd>
              </div>
              <div>
                <dt className="mission-section-label">Updated</dt>
                <dd className="mt-1 text-sm text-white">{formatDateTime(task.updatedAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-sm font-semibold text-white">Handoffs</h3>
              <span className="mission-muted">{props.detail.handoffs.length} total</span>
            </div>
            <div className="mt-4 space-y-3">
              {props.detail.handoffs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-linear-line px-4 py-6 text-center text-linear-muted">
                  No handoffs recorded for this task.
                </div>
              ) : (
                props.detail.handoffs.map((handoff) => (
                  <HandoffCard
                    key={handoff.id}
                    handoff={handoff}
                    onRespond={(status) => props.onRespond(handoff.id, task.id, status)}
                  />
                ))
              )}
            </div>
            <select
              className="mission-input mt-4"
              value={handoffTarget}
              onChange={(event) => setHandoffTarget(event.target.value)}
            >
              <option value="">Choose office agent</option>
              {props.agentNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <textarea
              className="mission-input mt-3 min-h-[110px]"
              placeholder="Explain the handoff and expected next step..."
              value={handoffNote}
              onChange={(event) => setHandoffNote(event.target.value)}
            />
            <button
              className="mission-button-muted mt-3"
              disabled={isBusy || !handoffNote.trim() || !handoffTarget}
              onClick={async () => {
                await props.onHandoff(task.id, handoffNote.trim(), handoffTarget);
                setHandoffNote("");
                setHandoffTarget("");
              }}
            >
              Create handoff
            </button>
          </div>

          {task.description ? (
            <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
              <h3 className="font-display text-sm font-semibold text-white">Description</h3>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-linear-ink">{task.description}</p>
            </div>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}

function HandoffCard(props: { handoff: MissionTaskHandoff; onRespond(status: "accepted" | "declined"): Promise<void> }) {
  return (
    <article className="mission-list-item">
      <div className="flex items-center justify-between gap-3">
        <div>
          <strong className="text-sm text-white">{props.handoff.fromAgentName} → {props.handoff.toAgentName}</strong>
          <p className="mission-muted mt-1">{formatDateTime(props.handoff.createdAt)}</p>
        </div>
        <span className={cx("mission-badge border", statusTone(props.handoff.status))}>{props.handoff.status}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-linear-ink">{props.handoff.note}</p>
      {props.handoff.status === "pending" ? (
        <div className="mt-4 flex gap-2">
          <button
            className="mission-button-muted"
            onClick={() => props.onRespond("accepted")}
          >
            Accept
          </button>
          <button
            className="rounded-xl border border-linear-red/25 bg-linear-red/10 px-3 py-2 text-sm font-semibold text-linear-red transition hover:bg-linear-red/15"
            onClick={() => props.onRespond("declined")}
          >
            Decline
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ConnectorSettingsCard(props: {
  connector: ProviderConnector;
  busyKey: string | null;
  onSave(
    provider: ProviderConnector["provider"],
    input: {
      enabled: boolean;
      baseUrl: string;
      websocketUrl: string;
      runtimeBaseUrl: string;
      syncIntervalMs: number;
      token?: string;
    },
  ): Promise<void>;
  onTest(provider: ProviderConnector["provider"]): Promise<void>;
  onSync(provider: ProviderConnector["provider"]): Promise<void>;
}) {
  const [enabled, setEnabled] = useState(props.connector.enabled);
  const [baseUrl, setBaseUrl] = useState(props.connector.baseUrl ?? "");
  const [websocketUrl, setWebsocketUrl] = useState(props.connector.websocketUrl ?? "");
  const [runtimeBaseUrl, setRuntimeBaseUrl] = useState(props.connector.runtimeBaseUrl ?? "");
  const [syncIntervalMs, setSyncIntervalMs] = useState(props.connector.syncIntervalMs);
  const [token, setToken] = useState("");

  useEffect(() => {
    setEnabled(props.connector.enabled);
    setBaseUrl(props.connector.baseUrl ?? "");
    setWebsocketUrl(props.connector.websocketUrl ?? "");
    setRuntimeBaseUrl(props.connector.runtimeBaseUrl ?? "");
    setSyncIntervalMs(props.connector.syncIntervalMs);
    setToken("");
  }, [
    props.connector.provider,
    props.connector.enabled,
    props.connector.baseUrl,
    props.connector.websocketUrl,
    props.connector.runtimeBaseUrl,
    props.connector.syncIntervalMs,
  ]);

  const isBusy = props.busyKey?.startsWith(`connector:${props.connector.provider}`) ?? false;

  async function handleSave(): Promise<void> {
    await props.onSave(props.connector.provider, {
      enabled,
      baseUrl,
      websocketUrl,
      runtimeBaseUrl,
      syncIntervalMs,
      ...(token.trim() ? { token: token.trim() } : {}),
    });
    setToken("");
  }

  return (
    <SectionCard
      title={props.connector.label}
      subtitle={props.connector.health.message ?? "No connector message."}
      action={<span className={cx("mission-badge border", connectorTone(props.connector.health.status))}>{props.connector.health.status}</span>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="mission-section-label">Base URL</span>
          <input className="mission-input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <label className="space-y-2">
          <span className="mission-section-label">WebSocket URL</span>
          <input className="mission-input" value={websocketUrl} onChange={(event) => setWebsocketUrl(event.target.value)} />
        </label>
        <label className="space-y-2">
          <span className="mission-section-label">Runtime bridge URL</span>
          <input className="mission-input" value={runtimeBaseUrl} onChange={(event) => setRuntimeBaseUrl(event.target.value)} />
        </label>
        <label className="space-y-2">
          <span className="mission-section-label">Sync interval (ms)</span>
          <input className="mission-input" type="number" min={1000} step={1000} value={syncIntervalMs} onChange={(event) => setSyncIntervalMs(Number(event.target.value) || props.connector.syncIntervalMs)} />
        </label>
        <label className="space-y-2 md:col-span-2">
          <span className="mission-section-label">Bearer token</span>
          <input
            className="mission-input"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={props.connector.tokenConfigured ? "Leave blank to keep the current token" : "Paste provider token"}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="inline-flex items-center gap-3 rounded-xl border border-linear-line bg-linear-surface px-4 py-3 text-sm text-white">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Connector enabled
        </label>
        <span className="mission-muted">Token {props.connector.tokenConfigured ? "configured" : "missing"} · Last sync {formatRelativeUpdate(props.connector.lastSyncAt)}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          className="mission-button"
          disabled={isBusy}
          onClick={() => {
            void handleSave();
          }}
        >
          {isBusy ? "Saving..." : "Save connector"}
        </button>
        <button
          className="mission-button-muted"
          disabled={isBusy}
          onClick={() => props.onTest(props.connector.provider)}
        >
          Test
        </button>
        <button
          className="mission-button-muted"
          disabled={isBusy}
          onClick={() => props.onSync(props.connector.provider)}
        >
          Sync now
        </button>
      </div>
    </SectionCard>
  );
}

function ProviderRosterPanel(props: {
  connectors: ProviderConnector[];
  agents: ProviderAgentRecord[];
  title: string;
  subtitle: string;
  compact?: boolean;
  className?: string;
}) {
  const limit = props.compact ? 4 : Number.POSITIVE_INFINITY;

  return (
    <SectionCard
      title={props.title}
      subtitle={props.subtitle}
      {...(props.className ? { className: props.className } : {})}
    >
      <div className="space-y-4">
        {props.connectors.map((connector) => {
          const roster = props.agents.filter((agent) => agent.provider === connector.provider);
          const linked = roster.filter((agent) => agent.officeAgentId).length;
          const staged = roster.length - linked;

          return (
            <article key={connector.provider} className="rounded-xl border border-linear-line bg-linear-surface p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="font-semibold text-white">{connector.label}</div>
                  <p className="mission-muted mt-1">{connector.health.message ?? "Waiting for sync."}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={cx("mission-badge border", connectorTone(connector.health.status))}>{connector.health.status}</span>
                  <span className="mission-badge">{roster.length} discovered</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-linear-line bg-mission-950 px-3 py-3">
                  <div className="mission-section-label">Discovered</div>
                  <div className="mt-2 text-lg font-semibold text-white">{roster.length}</div>
                </div>
                <div className="rounded-xl border border-linear-line bg-mission-950 px-3 py-3">
                  <div className="mission-section-label">Linked</div>
                  <div className="mt-2 text-lg font-semibold text-white">{linked}</div>
                </div>
                <div className="rounded-xl border border-linear-line bg-mission-950 px-3 py-3">
                  <div className="mission-section-label">Staged</div>
                  <div className="mt-2 text-lg font-semibold text-white">{staged}</div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {roster.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-linear-line px-4 py-4 text-sm text-linear-muted">
                    No agents discovered yet. If the connector is reachable but this stays empty, check provider auth and whether the runtime exposes a supported roster or session API.
                  </div>
                ) : (
                  roster.slice(0, limit).map((agent) => (
                    <div key={`${agent.provider}:${agent.externalId}`} className="mission-list-item">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">{agent.name}</div>
                          <div className="mission-muted mt-1">{agent.externalId}{agent.role ? ` · ${agent.role}` : ""}</div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <span className={cx("mission-badge border", statusTone(agent.status))}>{agent.status}</span>
                          <span className="mission-badge">{agent.officeAgentId ? "linked" : "staged"}</span>
                        </div>
                      </div>
                      <div className="mission-muted mt-3">
                        {agent.officeAgentId ? `Visible in office as ${agent.officeAgentId}.` : "Not rendered in the office map until it is linked to an office agent."}
                      </div>
                      <div className="mission-muted mt-1">
                        Last seen {formatDateTime(agent.lastSeenAt)}{agent.task ? ` · ${agent.task}` : ""}
                      </div>
                    </div>
                  ))
                )}

                {props.compact && roster.length > limit ? (
                  <div className="mission-muted px-1">Showing {limit} of {roster.length} discovered agents.</div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </SectionCard>
  );
}

export function App() {
  const mission = useMissionControl();
  const [taskSearch, setTaskSearch] = useState("");
  const deferredTaskSearch = useDeferredValue(taskSearch);
  const isTasksView = mission.activeView === "tasks";

  const selectedAgent = mission.agents.find((agent) => agent.id === mission.selectedAgentId) ?? null;
  const pendingHandoffs = mission.selectedTaskDetail?.handoffs.filter((handoff) => handoff.status === "pending") ?? [];
  const discoveredAgents = mission.missionSnapshot.providerAgents.length;
  const stagedAgents = mission.missionSnapshot.providerAgents.filter((agent) => !agent.officeAgentId).length;
  const visibleTasks = mission.missionSnapshot.tasks.filter((task) => {
    const needle = deferredTaskSearch.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return `${task.identifier} ${task.title} ${task.team.name} ${task.state.name}`.toLowerCase().includes(needle);
  }).sort(compareMissionTasksForBoard);
  const agentNames = mission.agents.map((agent) => agent.name);

  return (
    <div className="mission-shell">
      <div className="relative z-10 grid min-h-screen grid-cols-1 xl:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="border-b border-linear-line bg-black/20 p-3.5 backdrop-blur-md xl:border-b-0 xl:border-r xl:p-4">
          <div className="mission-panel p-4">
            <p className="mission-section-label">The Office</p>
            <h1 className="mt-2.5 font-display text-[1.6rem] font-semibold text-white">Mission Control</h1>
            <p className="mission-muted mt-3">A Linear-style local control room for tasks, schedules, and provider-connected agents.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={cx("mission-badge border", connectionTone(mission.connectionState))}>{mission.connectionState}</span>
              <span className="mission-badge">Build {DEPLOY_BADGE_LABEL}</span>
            </div>
          </div>

          <nav className="mt-4 grid gap-2">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={cx(
                  "mission-panel flex items-center justify-between px-3 py-2.5 text-left transition hover:border-linear-lineStrong hover:bg-linear-surfaceHover",
                  mission.activeView === item.id && "border-linear-teal/35 bg-linear-teal/10 shadow-[inset_0_0_0_1px_rgba(114,168,255,0.14)]",
                )}
                onClick={() => {
                  startTransition(() => {
                    mission.setActiveView(item.id);
                  });
                }}
                >
                  <div>
                    <div className="font-display text-sm font-semibold text-white">{item.label}</div>
                    <div className="mission-muted mt-1">{item.hint}</div>
                  </div>
                </button>
            ))}
          </nav>

          <SectionCard
            title="Office roster"
            subtitle={`${mission.agents.length} linked office agent${mission.agents.length === 1 ? "" : "s"}${stagedAgents ? ` · ${stagedAgents} staged provider agents` : ""}`}
            className="mt-5"
          >
            <div className="space-y-3">
              {mission.agents.map((agent) => (
                <button
                  key={agent.id}
                  className={cx(
                    "mission-list-item flex w-full items-start justify-between text-left",
                    mission.selectedAgentId === agent.id
                      ? "border-linear-teal/30 bg-linear-teal/10"
                      : "",
                  )}
                  onClick={() => {
                    startTransition(() => {
                      mission.setSelectedAgentId(agent.id);
                      mission.setActiveView("mission");
                    });
                  }}
                >
                  <div>
                    <div className="font-semibold text-white">{agent.name}</div>
                    <div className="mission-muted mt-1">{agent.role}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={cx("mission-badge border", statusTone(agent.status))}>{agent.status}</span>
                    <span className="max-w-[11rem] truncate text-xs text-linear-muted">{agent.task || "No active task"}</span>
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>
        </aside>

        <main className="flex min-h-screen flex-col gap-4 p-4 xl:p-5">
          {isTasksView ? (
            <header className="flex flex-col gap-2 border-b border-linear-line pb-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-linear-muted">Current cycle</span>
                  <span className="text-linear-muted">›</span>
                  <span className="truncate font-medium text-white">Task Board</span>
                </div>
                <p className="mission-muted mt-1">
                  {mission.missionSnapshot.taskSync.message || formatRelativeUpdate(mission.missionSnapshot.taskSync.updatedAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mission-badge">Sync {mission.missionSnapshot.taskSync.state}</span>
                <button
                  className="mission-button-muted"
                  onClick={() => void mission.refreshMission()}
                >
                  Refresh
                </button>
              </div>
            </header>
          ) : (
            <header className="mission-panel flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="mission-badge">Task sync {mission.missionSnapshot.taskSync.state}</div>
                <h2 className="mt-2 font-display text-xl font-semibold text-white">
                  {mission.activeView === "mission" ? "Hermes Mission Control" : mission.activeView === "schedules" ? "Schedules" : "Connector Settings"}
                </h2>
                <p className="mission-muted mt-2">
                  {mission.missionSnapshot.taskSync.message || formatRelativeUpdate(mission.missionSnapshot.taskSync.updatedAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  className="mission-button-muted"
                  onClick={() => void mission.refreshMission()}
                >
                  Refresh snapshot
                </button>
              </div>
            </header>
          )}

          {mission.error ? (
            <div className="mission-panel border-linear-red/25 bg-linear-red/10 px-5 py-4 text-sm text-linear-red">
              {mission.error}
            </div>
          ) : null}

          {mission.activeView === "mission" ? (
            <div className="grid flex-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex flex-col gap-5">
                <SectionCard
                  title="Command map"
                  subtitle="A Linear-style command center for your five specialist Hermes agents and the subagents they dispatch."
                  action={<span className="mission-badge">{mission.agents.filter((agent) => agent.status === "working").length} actively executing</span>}
                  className="flex-1"
                >
                  <div className="grid gap-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <MetricCard label="Cycle tasks" value={mission.missionSnapshot.tasks.length} />
                      <MetricCard label="Office agents" value={mission.agents.length} hint="Lead Engineer, iOS Dev, Full-stack Dev, QA, Support" tone="good" />
                      <MetricCard label="Discovered runtimes" value={discoveredAgents} />
                      <MetricCard label="Queued imports" value={mission.missionSnapshot.rosterImport.staged} tone={mission.missionSnapshot.rosterImport.staged > 0 ? "warn" : "default"} />
                    </div>
                    <div className="overflow-hidden rounded-[28px] border border-linear-line bg-gradient-to-b from-mission-900/70 to-mission-950/90">
                      <Suspense
                        fallback={
                          <div className="flex h-[420px] items-center justify-center text-sm text-linear-muted">
                            Loading live map...
                          </div>
                        }
                      >
                        <MissionScene
                          agents={mission.agents}
                          selectedAgentId={mission.selectedAgentId}
                          onSelectAgent={(agentId) => mission.setSelectedAgentId(agentId)}
                        />
                      </Suspense>
                    </div>
                  </div>
                </SectionCard>

                <div className="grid gap-5 xl:grid-cols-2">
                  <SectionCard title="Hot tasks" subtitle="Most recently updated Linear work items">
                    <div className="space-y-3">
                      {mission.missionSnapshot.tasks.slice(0, 6).map((task) => (
                        <button
                          key={task.id}
                          className="mission-list-item flex w-full items-start justify-between text-left"
                          onClick={() => {
                            startTransition(() => {
                              mission.setSelectedTaskId(task.id);
                              mission.setActiveView("tasks");
                            });
                          }}
                        >
                          <div>
                            <div className="font-semibold text-white">{task.identifier}</div>
                            <div className="mt-1 text-sm text-linear-ink">{task.title}</div>
                            <div className="mission-muted mt-2">{task.team.name}</div>
                          </div>
                          <span className={cx("mission-badge border", taskWorkflowTone(task))}>{task.state.name}</span>
                        </button>
                      ))}
                    </div>
                  </SectionCard>

                  <ProviderRosterPanel
                    title="Runtime roster"
                    subtitle="Detected provider agents and external runtimes. Linked residents are visualized in the office scene."
                    connectors={mission.missionSnapshot.connectors}
                    agents={mission.missionSnapshot.providerAgents}
                    compact
                  />
                </div>
              </div>

              <div className="flex flex-col gap-5">
                <SectionCard title="Selected agent" subtitle={selectedAgent ? selectedAgent.role : "No agent selected"}>
                  {selectedAgent ? (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-linear-line bg-linear-surface p-4">
                        <div className="text-xl font-semibold text-white">{selectedAgent.name}</div>
                        <div className="mission-muted mt-2">{selectedAgent.role}</div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className={cx("mission-badge border", statusTone(selectedAgent.status))}>{selectedAgent.status}</span>
                          <span className="mission-badge">{selectedAgent.location || "desk"}</span>
                        </div>
                        <p className="mt-4 text-sm leading-6 text-linear-ink">{selectedAgent.task || "No active task assigned."}</p>
                        <p className="mission-muted mt-3">{selectedAgent.message || "No recent agent message."}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-linear-line px-4 py-12 text-center text-linear-muted">
                      Select an agent from the roster or scene.
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Upcoming jobs" subtitle="Provider-imported cron and scheduled runs">
                  <div className="space-y-3">
                    {mission.missionSnapshot.schedules.slice(0, 6).map((schedule) => (
                      <div key={schedule.id} className="mission-list-item">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-white">{schedule.name}</div>
                            <div className="mission-muted mt-1">{schedule.recurrence}</div>
                          </div>
                          <span className="mission-badge">{schedule.provider}</span>
                        </div>
                        <div className="mission-muted mt-3">Next run {formatClockTime(schedule.nextRunAt)}</div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Pending handoffs" subtitle={`${pendingHandoffs.length} waiting on response`}>
                  <div className="space-y-3">
                    {pendingHandoffs.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-linear-line px-4 py-10 text-center text-linear-muted">
                        No pending handoffs for the currently selected task.
                      </div>
                    ) : (
                      pendingHandoffs.map((handoff) => (
                        <HandoffCard
                          key={handoff.id}
                          handoff={handoff}
                          onRespond={(status) => mission.respondToHandoff(handoff.id, { status }, handoff.taskId)}
                        />
                      ))
                    )}
                  </div>
                </SectionCard>
              </div>
            </div>
          ) : null}

          {mission.activeView === "tasks" ? (
            <div className="grid flex-1 gap-4 2xl:grid-cols-[440px_minmax(0,1fr)]">
              <SectionCard title="Current cycle" subtitle="Only issues in currently active Linear cycles are synced.">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="mission-input max-w-sm"
                    placeholder="Search issues, teams, or keys"
                    value={taskSearch}
                    onChange={(event) => setTaskSearch(event.target.value)}
                  />
                  <span className="mission-badge">{visibleTasks.length} issues</span>
                  <span className="mission-badge">Active cycle only</span>
                </div>
                <div className="mission-table mt-3">
                  <div className="mission-table-head grid-cols-[84px_minmax(0,1fr)_96px_84px_44px]">
                    <span>Issue</span>
                    <span>Title</span>
                    <span>Assignee</span>
                    <span>Status</span>
                    <span>Age</span>
                  </div>
                  {visibleTasks.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-linear-muted">No tasks matched the current active cycle filter.</div>
                  ) : (
                    visibleTasks.map((task) => (
                      <button
                        key={task.id}
                        className={cx(
                          "mission-table-row w-full grid-cols-[84px_minmax(0,1fr)_96px_84px_44px]",
                          mission.selectedTaskId === task.id
                            ? "bg-linear-teal/10"
                            : "",
                        )}
                        onClick={() => {
                          startTransition(() => {
                            mission.setSelectedTaskId(task.id);
                          });
                        }}
                      >
                        <span className="truncate text-xs font-semibold text-white">{task.identifier}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-white">{task.title}</span>
                          <span className="mission-muted mt-0.5 block truncate">{task.team.key ?? task.team.name} · {taskCycleLabel(task)}</span>
                        </span>
                        <span className="truncate text-[12px] text-linear-ink">{task.assignee?.name ?? "Unassigned"}</span>
                        <span className={cx("mission-badge border w-fit", taskWorkflowTone(task))}>{task.state.name}</span>
                        <span className="text-[12px] text-linear-muted">{formatRelativeStamp(task.updatedAt)}</span>
                      </button>
                    ))
                  )}
                </div>
              </SectionCard>

              <TaskDetailPanel
                detail={mission.selectedTaskDetail}
                agentNames={agentNames}
                busyKey={mission.busyKey}
                onUpdate={(taskId, input) => mission.saveTaskUpdate(taskId, input)}
                onComment={(taskId, body) => mission.addComment(taskId, { body })}
                onHandoff={async (taskId, note, toAgentName) => {
                  await mission.createHandoff(taskId, { note, toAgentName });
                }}
                onRespond={(handoffId, taskId, status) => mission.respondToHandoff(handoffId, { status }, taskId)}
              />
            </div>
          ) : null}

          {mission.activeView === "schedules" ? (
            <SectionCard title="Schedules" subtitle="All provider-imported cron and scheduled jobs">
              <div className="grid gap-3">
                {mission.missionSnapshot.schedules.map((schedule) => (
                  <article key={schedule.id} className="rounded-xl border border-linear-line bg-linear-surface p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="font-display text-lg font-semibold text-white">{schedule.name}</div>
                        <div className="mission-muted mt-2">{schedule.recurrence}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="mission-badge">{schedule.provider}</span>
                        <span className={cx("mission-badge border", statusTone(schedule.status))}>{schedule.status}</span>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-linear-muted">Next run</div>
                        <div className="mt-2 text-sm text-white">{formatClockTime(schedule.nextRunAt)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-linear-muted">Last run</div>
                        <div className="mt-2 text-sm text-white">{formatClockTime(schedule.lastRunAt)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-linear-muted">Target</div>
                        <div className="mt-2 text-sm text-white">{schedule.targetLabel || schedule.targetAgentId || "Unassigned"}</div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </SectionCard>
          ) : null}

          {mission.activeView === "settings" ? (
            <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-5">
                {mission.missionSnapshot.connectors.map((connector) => (
                  <ConnectorSettingsCard
                    key={connector.provider}
                    connector={connector}
                    busyKey={mission.busyKey}
                    onSave={(provider, input) => mission.saveConnector(provider, input)}
                    onTest={(provider) => mission.testConnectorHealth(provider)}
                    onSync={(provider) => mission.syncConnector(provider)}
                  />
                ))}
              </div>

              <ProviderRosterPanel
                title="Provider discovery"
                subtitle="Use this to verify whether OpenClaw and Hermes are returning roster data, not just passing a health check."
                connectors={mission.missionSnapshot.connectors}
                agents={mission.missionSnapshot.providerAgents}
              />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
