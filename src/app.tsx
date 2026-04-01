import { Suspense, lazy, startTransition, useDeferredValue, useCallback, useEffect, useRef, useState } from "react";
import { DEPLOY_BADGE_LABEL } from "./config/buildInfo";
import {
  formatProviderAgentStatus,
  isProviderAgentActivelyExecuting,
} from "./mission/providerAgents";
import { useMissionControl, type MissionView } from "./mission/hooks/useMissionControl";
import { compareMissionTasksForBoard, getMissionTaskBoardStage } from "./mission/taskBoard";
import type { ActivityLogEntry, AgentBackendProvider, AgentRegistration, AgentRuntimeState } from "./types";
import type {
  AgentMessage,
  MissionTask,
  ProviderAgentRecord,
  MissionTaskDetail,
  MissionTaskHandoff,
  MissionTaskUpdateRequest,
  ProviderConnector,
} from "./mission/types";

const OrgChart = lazy(async () => {
  const module = await import("./mission/orgchart/OrgChart");
  return { default: module.OrgChart };
});

const NAV_ITEMS: Array<{ id: MissionView; label: string; hint: string }> = [
  { id: "mission", label: "Mission Control", hint: "Live office and triage" },
  { id: "tasks", label: "Tasks", hint: "Linear-backed execution" },
  { id: "schedules", label: "Schedules", hint: "Provider cron and jobs" },
  { id: "agents", label: "Agents", hint: "Create, edit, link" },
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

function avatarLabel(name: string, emoji?: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return emoji?.trim() || "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 1).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
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
  if (normalized.includes("reject")) {
    return "bg-linear-red/15 text-linear-red border-linear-red/25";
  }
  if (normalized.includes("build")) {
    return "bg-sky-500/15 text-sky-200 border-sky-400/25";
  }
  if (normalized.includes("approve")) {
    return "bg-emerald-500/15 text-emerald-200 border-emerald-400/25";
  }
  if (normalized.includes("spec")) {
    return "bg-amber-500/15 text-amber-200 border-amber-400/25";
  }
  if (normalized.includes("pr ")) {
    return "bg-violet-500/15 text-violet-200 border-violet-400/25";
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
    <section className={cx("mission-panel mission-card flex flex-col gap-3 p-3.5", props.className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="mission-wrap text-[14px] font-medium leading-5 text-white">{props.title}</h2>
          {props.subtitle ? <p className="mission-muted mission-wrap mt-1">{props.subtitle}</p> : null}
        </div>
        {props.action ? <div className="shrink-0">{props.action}</div> : null}
      </div>
      {props.children}
    </section>
  );
}

function MetricCard(props: { label: string; value: string | number; hint?: string; tone?: "default" | "good" | "warn" | "danger" }) {
  const toneClass = props.tone === "good"
    ? "border-linear-teal/20"
    : props.tone === "warn"
      ? "border-linear-warm/20"
      : props.tone === "danger"
        ? "border-linear-red/25"
        : "border-linear-line";

  return (
    <article className={cx("mission-summary-card", toneClass)}>
      <div className="min-w-0 flex-1">
        <p className="mission-summary-label">{props.label}</p>
        {props.hint ? <p className="mission-summary-hint mission-clamp-1 mission-wrap">{props.hint}</p> : null}
      </div>
      <div className="mission-summary-value shrink-0">{props.value}</div>
    </article>
  );
}

function AgentChatPanel(props: {
  agent: AgentRuntimeState | null;
  messages: AgentMessage[];
  loading: boolean;
  busyKey: string | null;
  onSend(agentId: string, message: string): Promise<void>;
  onRefresh(agentId: string): Promise<void>;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const agentId = props.agent?.id ?? "";
  const isSending = props.busyKey === `agent:${agentId}:message`;

  useEffect(() => {
    const scrollArea = messagesScrollRef.current;
    if (!scrollArea) {
      return;
    }

    requestAnimationFrame(() => {
      scrollArea.scrollTop = scrollArea.scrollHeight;
    });
  }, [props.messages.length, isSending]);

  useEffect(() => {
    setDraft("");
  }, [props.agent?.id]);

  if (!props.agent) {
    return null;
  }
  const hasProvider = props.agent.backendLink?.provider && props.agent.backendLink.provider !== "unlinked";

  return (
    <SectionCard
      title={`Chat — ${props.agent.name}`}
      subtitle={`${props.agent.role}${hasProvider ? ` · via ${props.agent.backendLink!.provider}` : ""}`}
      action={
        hasProvider ? (
          <button
            className="mission-button-muted"
            onClick={() => props.onRefresh(agentId)}
            disabled={props.loading}
          >
            {props.loading ? "Loading..." : "Refresh"}
          </button>
        ) : null
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={cx("mission-badge border", statusTone(props.agent.status))}>{props.agent.status}</span>
          <span className="mission-badge">{props.agent.location || "desk"}</span>
          {props.agent.task ? <span className="mission-muted mission-clamp-1 mission-wrap">{props.agent.task}</span> : null}
        </div>
        <div
          ref={messagesScrollRef}
          className="mission-scroll max-h-[400px] space-y-3 rounded-xl border border-linear-line bg-mission-900 p-3"
        >
          {!hasProvider ? (
            <div className="py-6 text-center text-sm text-linear-muted">
              Link this agent to a provider (Hermes, Claude, etc.) to enable chat.
            </div>
          ) : props.loading && props.messages.length === 0 ? (
            <div className="py-6 text-center text-sm text-linear-muted">Loading messages...</div>
          ) : props.messages.length === 0 ? (
            <div className="py-6 text-center text-sm text-linear-muted">
              No messages yet. Send a message to start a conversation.
            </div>
          ) : (
            props.messages.filter((msg) => {
              const t = msg.content.trimStart();
              return !(t.startsWith("{") && /\"(output|exit_code)\"/.test(t));
            }).map((msg) => (
              <div
                key={msg.id}
                className={cx(
                  "min-w-0 max-w-full rounded-lg px-3 py-2 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "ml-8 bg-linear-teal/15 text-linear-teal"
                    : msg.role === "assistant"
                      ? "mr-8 bg-linear-surfaceAlt text-linear-ink"
                      : "bg-linear-warm/10 text-linear-warm text-xs",
                )}
              >
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
                  {msg.role === "user" ? "You" : msg.agentName ?? props.agent!.name}
                </div>
                <p className="mission-wrap whitespace-pre-wrap break-words">{msg.content}</p>
              </div>
            ))
          )}
          {isSending ? (
            <div className="mr-8 min-w-0 max-w-full rounded-lg bg-linear-surfaceAlt px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-linear-muted">{props.agent!.name}</div>
              <div className="flex items-center gap-1.5 text-sm text-linear-muted">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-linear-teal" />
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-linear-teal" style={{ animationDelay: "0.2s" }} />
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-linear-teal" style={{ animationDelay: "0.4s" }} />
                <span className="ml-2">Thinking...</span>
              </div>
            </div>
          ) : null}
        </div>

        {hasProvider ? (
          <div className="mt-3 flex gap-2">
            <textarea
              className="mission-input min-h-[56px] flex-1 resize-none"
              placeholder={`Message ${props.agent.name}...`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && draft.trim()) {
                  event.preventDefault();
                  const message = draft.trim();
                  setDraft("");
                  void props.onSend(agentId, message);
                }
              }}
            />
            <button
              className="mission-button self-end"
              disabled={isSending || !draft.trim()}
              onClick={() => {
                const message = draft.trim();
                if (!message) return;
                setDraft("");
                void props.onSend(agentId, message);
              }}
            >
              {isSending ? "..." : "Send"}
            </button>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function activityKindIcon(kind: ActivityLogEntry["kind"]): string {
  switch (kind) {
    case "agent-message": return "\u{1F4AC}";
    case "agent-status": return "\u{1F504}";
    case "agent-spawn": return "\u{1F680}";
    case "agent-complete": return "\u2705";
    case "meeting-start": return "\u{1F4E2}";
    case "meeting-turn": return "\u{1F399}";
    case "meeting-end": return "\u{1F3C1}";
    case "meeting-stop": return "\u26D4";
    case "registration": return "\u{1F4CB}";
    case "workflow-item": return "\u{1F4DD}";
    case "workflow-handoff": return "\u{1F91D}";
    case "workflow-comment": return "\u{1F4AC}";
    case "workflow-qa": return "\u{1F50D}";
    default: return "\u2022";
  }
}

function ActivityFeed(props: { entries: ActivityLogEntry[]; limit?: number; className?: string }) {
  const limit = props.limit ?? 20;
  const visible = props.entries.slice(0, limit);

  return (
    <div className={cx("min-w-0 space-y-2", props.className)}>
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-linear-line px-4 py-6 text-center text-linear-muted">
          No activity yet. Agent messages, status changes, and handoffs will appear here in real time.
        </div>
      ) : (
        visible.map((entry) => (
          <article key={entry.id} className="mission-list-item">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-xs">{activityKindIcon(entry.kind)}</span>
              <div className="min-w-0 flex-1">
                <p className="mission-wrap text-sm leading-5 text-linear-ink">{entry.message}</p>
                <span className="mission-muted mt-1 block">{formatRelativeStamp(entry.timestamp)}</span>
              </div>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function TaskDetailPanel(props: {
  detail: MissionTaskDetail | null;
  agentNames: string[];
  activityLog: ActivityLogEntry[];
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

  return (
    <SectionCard
      title={task.title}
      subtitle={`${task.identifier} · ${task.team.name}${task.cycle ? ` · ${taskCycleLabel(task)}` : ""}`}
      action={<span className={cx("mission-badge border", taskWorkflowTone(task))}>{task.state.name}</span>}
      className="h-full min-h-0 overflow-hidden"
    >
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_288px]">
        <div className="mission-scroll space-y-4 pr-1">
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

          {task.description ? (
            <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
              <h3 className="font-display text-sm font-semibold text-white">Description</h3>
              <p className="mission-wrap mt-3 whitespace-pre-wrap text-sm leading-6 text-linear-ink">{task.description}</p>
            </div>
          ) : null}

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
                    <div className="flex items-start justify-between gap-3">
                      <strong className="mission-wrap text-sm text-white">{comment.authorName}</strong>
                      <span className="mission-muted shrink-0">{formatDateTime(comment.createdAt)}</span>
                    </div>
                    <p className="mission-wrap mt-3 whitespace-pre-wrap text-sm leading-6 text-linear-ink">{comment.body}</p>
                  </article>
                ))
              )}
            </div>
            <textarea
              className="mission-input mt-4 min-h-[120px] resize-y"
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

        <div className="mission-scroll space-y-4 pr-1">
          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <h3 className="font-display text-sm font-semibold text-white">Task metadata</h3>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="mission-section-label">Team</dt>
                <dd className="mission-wrap mt-1 text-sm text-white">{task.team.name}</dd>
              </div>
              <div>
                <dt className="mission-section-label">Assignee</dt>
                <dd className="mission-wrap mt-1 text-sm text-white">{task.assignee?.name ?? "Unassigned"}</dd>
              </div>
              <div>
                <dt className="mission-section-label">Cycle</dt>
                <dd className="mission-wrap mt-1 text-sm text-white">{taskCycleLabel(task)}</dd>
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
              className="mission-input mt-3 min-h-[110px] resize-y"
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

          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-sm font-semibold text-white">Activity feed</h3>
              <span className="mission-muted">{props.activityLog.length} entries</span>
            </div>
            <div className="mt-4">
              <ActivityFeed entries={props.activityLog} limit={15} />
            </div>
          </div>

        </div>
      </div>
    </SectionCard>
  );
}

function HandoffCard(props: { handoff: MissionTaskHandoff; onRespond(status: "accepted" | "declined"): Promise<void> }) {
  return (
    <article className="mission-list-item">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="mission-wrap text-sm text-white">{props.handoff.fromAgentName} → {props.handoff.toAgentName}</strong>
          <p className="mission-muted mt-1">{formatDateTime(props.handoff.createdAt)}</p>
        </div>
        <span className={cx("mission-badge border", statusTone(props.handoff.status))}>{props.handoff.status}</span>
      </div>
      <p className="mission-wrap mt-3 text-sm leading-6 text-linear-ink">{props.handoff.note}</p>
      {props.handoff.status === "pending" ? (
        <div className="mt-4 flex flex-wrap gap-2">
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
    connectorId: string,
    input: {
      enabled: boolean;
      baseUrl: string;
      websocketUrl: string;
      runtimeBaseUrl: string;
      token?: string;
      adapterConfig?: Record<string, unknown>;
    },
  ): Promise<void>;
  onTest(connectorId: string): Promise<void>;
  onSync(connectorId: string): Promise<void>;
  onRemove(connectorId: string): void;
}) {
  const fields = props.connector.configFields;
  const [enabled, setEnabled] = useState(props.connector.enabled);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(() => {
    if (!fields) return {};
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      initial[field.key] = field.type === "password" ? "" : (props.connector.adapterConfig?.[field.key] ?? "");
    }
    return initial;
  });

  useEffect(() => {
    setEnabled(props.connector.enabled);
    if (fields) {
      const next: Record<string, unknown> = {};
      for (const field of fields) {
        next[field.key] = field.type === "password" ? "" : (props.connector.adapterConfig?.[field.key] ?? "");
      }
      setFieldValues(next);
    }
  }, [props.connector.id, props.connector.enabled, props.connector.adapterConfig]);

  const isBusy = props.busyKey?.startsWith(`connector:${props.connector.id}`) ?? false;

  async function handleSave(): Promise<void> {
    const tokenValue = String(fieldValues.token ?? "").trim();
    // Collect any field values that aren't the well-known connector keys
    // into adapterConfig so adapters can define custom fields freely.
    const knownKeys = new Set(["baseUrl", "websocketUrl", "runtimeBaseUrl", "token"]);
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fieldValues)) {
      if (!knownKeys.has(key)) extras[key] = value;
    }
    await props.onSave(props.connector.id, {
      enabled,
      baseUrl: String(fieldValues.baseUrl ?? props.connector.baseUrl ?? ""),
      websocketUrl: String(fieldValues.websocketUrl ?? props.connector.websocketUrl ?? ""),
      runtimeBaseUrl: String(fieldValues.runtimeBaseUrl ?? props.connector.runtimeBaseUrl ?? ""),
      ...(tokenValue ? { token: tokenValue } : {}),
      ...(Object.keys(extras).length > 0 ? { adapterConfig: extras } : {}),
    });
    setFieldValues((prev) => ({ ...prev, token: "" }));
  }

  function updateField(key: string, value: unknown): void {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <SectionCard
      title={props.connector.label}
      subtitle={props.connector.health.message ?? "No connector message."}
      action={<span className={cx("mission-badge border", connectorTone(props.connector.health.status))}>{props.connector.health.status}</span>}
    >
      {fields && fields.length > 0 ? (
        <div className="grid gap-3">
          {fields.map((field) => (
            <label key={field.key} className="space-y-1.5">
              <span className="mission-section-label">{field.label}</span>
              {field.type === "boolean" ? (
                <div className="mt-1">
                  <input
                    type="checkbox"
                    checked={Boolean(fieldValues[field.key])}
                    onChange={(event) => updateField(field.key, event.target.checked)}
                  />
                </div>
              ) : (
                <input
                  className="mission-input"
                  type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                  value={String(fieldValues[field.key] ?? "")}
                  onChange={(event) => updateField(field.key, field.type === "number" ? Number(event.target.value) || 0 : event.target.value)}
                  placeholder={field.type === "password" && props.connector.tokenConfigured ? "Leave blank to keep current" : field.placeholder}
                />
              )}
              {field.hint ? <p className="mission-muted text-[10px]">{field.hint}</p> : null}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-linear-muted">No configuration fields available for this adapter.</p>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="inline-flex items-center gap-3 rounded-lg border border-linear-line px-3 py-2 text-sm text-white">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Connector enabled
        </label>
        <span className="mission-muted">
          {props.connector.tokenConfigured ? "Token configured" : ""}{props.connector.lastSyncAt ? ` · Last sync ${formatRelativeUpdate(props.connector.lastSyncAt)}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="mission-button"
          disabled={isBusy}
          onClick={() => { void handleSave(); }}
        >
          {isBusy ? "Saving..." : "Save connector"}
        </button>
        <button
          className="mission-button-muted"
          disabled={isBusy}
          onClick={() => props.onTest(props.connector.id)}
        >
          Test
        </button>
        <button
          className="mission-button-muted"
          disabled={isBusy}
          onClick={() => props.onSync(props.connector.id)}
        >
          Sync now
        </button>
        <span className="flex-1" />
        <button
          className="text-[11px] text-linear-red hover:underline"
          disabled={isBusy}
          onClick={() => {
            if (window.confirm(`Remove ${props.connector.label} integration?`)) {
              props.onRemove(props.connector.id);
            }
          }}
        >
          Remove
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
          const roster = props.agents.filter((agent) => agent.connectorId === connector.id);
          const linked = roster.filter((agent) => agent.officeAgentId).length;
          const staged = roster.length - linked;

          return (
            <article key={connector.id} className="rounded-xl border border-linear-line bg-linear-surface p-4">
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
                    <div key={`${agent.connectorId}:${agent.externalId}`} className="mission-list-item">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">{agent.name}</div>
                          <div className="mission-muted mt-1">{agent.externalId}{agent.role ? ` · ${agent.role}` : ""}</div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <span className={cx("mission-badge border", statusTone(formatProviderAgentStatus(agent)))}>
                            {formatProviderAgentStatus(agent)}
                          </span>
                          <span className="mission-badge">{agent.officeAgentId ? "linked" : "staged"}</span>
                        </div>
                      </div>
                      <div className="mission-muted mt-3">
                        {agent.officeAgentId ? `Visible in office as ${agent.officeAgentId}.` : "Not rendered in the office map until it is linked to an office agent."}
                      </div>
                      <div className="mission-muted mt-1">
                        {agent.currentTicket ? `Ticket ${agent.currentTicket}` : "No active ticket"}
                        {agent.taskStage ? ` · ${agent.taskStage}` : agent.task ? ` · ${agent.task}` : ""}
                      </div>
                      <div className="mission-muted mt-1">
                        Last activity {formatDateTime(agent.lastActivityAt ? Date.parse(agent.lastActivityAt) : agent.lastSeenAt)}
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

const INTEGRATION_OPTIONS: Array<{ provider: ProviderConnector["provider"]; label: string; description: string }> = [
  { provider: "hermes", label: "Hermes", description: "Local or remote Hermes CLI agents" },
  { provider: "claude-local", label: "Claude Code", description: "Local Claude Code CLI" },
  { provider: "codex-local", label: "Codex", description: "Local Codex CLI" },
];

function SettingsView(props: {
  connectors: ProviderConnector[];
  providerAgents: ProviderAgentRecord[];
  busyKey: string | null;
  onSave(
    connectorId: string,
    input: {
      enabled: boolean;
      baseUrl: string;
      websocketUrl: string;
      runtimeBaseUrl: string;
      token?: string;
      adapterConfig?: Record<string, unknown>;
    },
  ): Promise<void>;
  onTest(connectorId: string): Promise<void>;
  onSync(connectorId: string): Promise<void>;
  onRemove(connectorId: string): Promise<void>;
}) {
  const enabledConnectors = props.connectors.filter((c) => c.enabled);

  return (
    <div className="grid flex-1 gap-5 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="mission-scroll space-y-5">
        {enabledConnectors.length === 0 ? (
          <SectionCard
            title="No integrations configured"
            subtitle="Add an integration to connect your AI agents to Mission Control."
          >
            <p className="text-sm text-linear-muted">
              Click &ldquo;+ Add integration&rdquo; in the header to get started.
            </p>
          </SectionCard>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {enabledConnectors.map((connector) => (
              <ConnectorSettingsCard
                key={connector.id}
                connector={connector}
                busyKey={props.busyKey}
                onSave={(connectorId, input) => props.onSave(connectorId, input)}
                onTest={(connectorId) => props.onTest(connectorId)}
                onSync={(connectorId) => props.onSync(connectorId)}
                onRemove={(connectorId) => { void props.onRemove(connectorId); }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mission-scroll">
        {enabledConnectors.length > 0 ? (
          <ProviderRosterPanel
            title="Provider discovery"
            subtitle="Verify whether connectors are returning roster data, not just passing a health check."
            connectors={enabledConnectors}
            agents={props.providerAgents}
          />
        ) : null}
      </div>
    </div>
  );
}

const PROVIDER_OPTIONS: Array<{ value: AgentBackendProvider; label: string }> = [
  { value: "hermes", label: "Hermes" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "unlinked", label: "Unlinked" },
];

function AgentListPanel(props: {
  agents: AgentRuntimeState[];
  selectedAgentId: string | null;
  busyKey: string | null;
  onSelect(agentId: string): void;
  onCreate(): void;
  onDelete(agentId: string): Promise<void>;
}) {
  return (
    <SectionCard
      title="Office agents"
      subtitle={`${props.agents.length} agent${props.agents.length === 1 ? "" : "s"}`}
      action={<button className="mission-button" onClick={props.onCreate}>New agent</button>}
    >
      <div className="mission-table">
        <div className="mission-table-head grid-cols-[minmax(0,1fr)_100px_80px_72px]">
          <span>Agent</span>
          <span>Provider</span>
          <span>Status</span>
          <span></span>
        </div>
        {props.agents.length === 0 ? (
          <div className="px-4 py-6 text-sm text-linear-muted">No agents registered yet.</div>
        ) : (
          props.agents.map((agent) => {
            const provider = agent.backendLink?.provider ?? "unlinked";
            const isBusy = props.busyKey?.startsWith(`agent:${agent.id}`) ?? false;
            return (
              <button
                key={agent.id}
                className={cx(
                  "mission-table-row w-full grid-cols-[minmax(0,1fr)_100px_80px_72px]",
                  props.selectedAgentId === agent.id ? "bg-linear-teal/10" : "",
                )}
                onClick={() => props.onSelect(agent.id)}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-base">{agent.emoji || "\u{1F916}"}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-white">{agent.name}</span>
                    <span className="block truncate text-[11px] text-linear-muted">{agent.role}</span>
                  </span>
                </span>
                <span className="mission-badge w-fit">{provider}</span>
                <span className={cx("mission-badge border w-fit", statusTone(agent.status))}>{agent.status}</span>
                <span
                  className="text-[11px] text-linear-red hover:underline cursor-pointer"
                  role="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (window.confirm(`Remove agent "${agent.name}"?`)) {
                      if (!isBusy) void props.onDelete(agent.id);
                    }
                  }}
                >
                  {isBusy ? "..." : "Remove"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </SectionCard>
  );
}

function AgentFormPanel(props: {
  mode: "create" | "edit";
  initial: AgentRuntimeState | null;
  agents: AgentRuntimeState[];
  providerAgents: ProviderAgentRecord[];
  connectors: ProviderConnector[];
  busyKey: string | null;
  onSave(input: AgentRegistration): Promise<void>;
  onCancel(): void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [emoji, setEmoji] = useState("");
  const [agentType, setAgentType] = useState<"resident" | "visitor">("resident");
  const [provider, setProvider] = useState<AgentBackendProvider>("unlinked");
  const [connectorId, setConnectorId] = useState("");
  const [externalId, setExternalId] = useState("");
  const [connected, setConnected] = useState(false);
  const [parentAgentId, setParentAgentId] = useState("");

  useEffect(() => {
    if (props.mode === "edit" && props.initial) {
      setId(props.initial.id);
      setName(props.initial.name);
      setRole(props.initial.role);
      setEmoji(props.initial.emoji ?? "");
      setAgentType(props.initial.type ?? "resident");
      setProvider(props.initial.backendLink?.provider ?? "unlinked");
      setConnectorId(props.initial.backendLink?.connectorId ?? "");
      setExternalId(props.initial.backendLink?.agentId ?? "");
      setConnected(props.initial.backendLink?.connected ?? false);
      setParentAgentId(props.initial.parentAgentId ?? "");
    } else {
      setId("");
      setName("");
      setRole("");
      setEmoji("");
      setAgentType("resident");
      setProvider("unlinked");
      setConnectorId("");
      setExternalId("");
      setConnected(false);
      setParentAgentId("");
    }
  }, [props.mode, props.initial?.id]);

  const isBusy = props.busyKey?.startsWith("agent:") ?? false;

  const connectorOptions = props.connectors
    .filter((c) => c.enabled)
    .map((c) => ({ value: c.id, label: c.label, provider: c.provider }));

  const filteredProviderAgents = connectorId
    ? props.providerAgents.filter((agent) => agent.connectorId === connectorId)
    : [];

  const parentCandidates = props.agents.filter((a) => {
    const currentId = props.mode === "edit" ? props.initial?.id : id;
    return a.id !== currentId;
  });

  function handleSubmit(): void {
    const input: AgentRegistration = {
      id: props.mode === "create" ? id : props.initial!.id,
      name,
      role,
      emoji: emoji || undefined,
      type: agentType,
      backendLink: {
        provider,
        connectorId: connectorId || undefined,
        agentId: externalId || undefined,
        connected,
      },
      parentAgentId: parentAgentId || null,
    };
    void props.onSave(input);
  }

  return (
    <SectionCard
      title={props.mode === "create" ? "New agent" : `Edit ${props.initial?.name ?? "agent"}`}
      subtitle={props.mode === "create" ? "Register a new office agent" : "Update agent configuration"}
    >
      <div className="grid gap-3">
        {props.mode === "create" ? (
          <label className="block">
            <span className="mission-section-label">Agent ID</span>
            <input
              className="mission-input mt-1.5"
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="e.g. dan-agent"
            />
          </label>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mission-section-label">Name</span>
            <input className="mission-input mt-1.5" value={name} onChange={(event) => setName(event.target.value)} placeholder="Dan" />
          </label>
          <label className="block">
            <span className="mission-section-label">Role</span>
            <input className="mission-input mt-1.5" value={role} onChange={(event) => setRole(event.target.value)} placeholder="Lead Engineer" />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mission-section-label">Emoji</span>
            <input className="mission-input mt-1.5" value={emoji} onChange={(event) => setEmoji(event.target.value)} placeholder="\u{1F9E0}" />
          </label>
          <label className="block">
            <span className="mission-section-label">Type</span>
            <select className="mission-input mt-1.5" value={agentType} onChange={(event) => setAgentType(event.target.value as "resident" | "visitor")}>
              <option value="resident">Resident</option>
              <option value="visitor">Visitor</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mission-section-label">Parent agent</span>
          <select className="mission-input mt-1.5" value={parentAgentId} onChange={(event) => setParentAgentId(event.target.value)}>
            <option value="">None (top-level)</option>
            {parentCandidates.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
            ))}
          </select>
          <p className="mission-muted mt-1 text-[10px]">Set this agent's parent in the org chart. Top-level agents appear as peer orchestrators.</p>
        </label>

        <div className="mt-2 border-t border-linear-line pt-3">
          <p className="mission-section-label mb-3">Provider link</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mission-section-label">Connector</span>
              <select
                className="mission-input mt-1.5"
                value={connectorId}
                onChange={(event) => {
                  const cId = event.target.value;
                  setConnectorId(cId);
                  const c = props.connectors.find((conn) => conn.id === cId);
                  if (c) {
                    const providerMap: Record<string, AgentBackendProvider> = {
                      hermes: "hermes", "claude-local": "claude", "codex-local": "codex",
                    };
                    setProvider(providerMap[c.provider] ?? "unlinked");
                  } else {
                    setProvider("unlinked");
                  }
                  setExternalId("");
                }}
              >
                <option value="">Unlinked</option>
                {connectorOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mission-section-label">External agent</span>
              {filteredProviderAgents.length > 0 ? (
                <select className="mission-input mt-1.5" value={externalId} onChange={(event) => setExternalId(event.target.value)}>
                  <option value="">None (manual)</option>
                  {filteredProviderAgents.map((agent) => (
                    <option key={agent.externalId} value={agent.externalId}>
                      {agent.name} ({agent.externalId})
                    </option>
                  ))}
                </select>
              ) : (
                <input className="mission-input mt-1.5" value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="External ID" />
              )}
            </label>
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-[13px] text-linear-ink">
            <input type="checkbox" checked={connected} onChange={(event) => setConnected(event.target.checked)} />
            Mark as connected
          </label>
        </div>

        <div className="mt-2 flex gap-2">
          <button
            className="mission-button"
            disabled={isBusy || !name.trim() || !role.trim() || (props.mode === "create" && !id.trim())}
            onClick={handleSubmit}
          >
            {isBusy ? "Saving..." : props.mode === "create" ? "Create agent" : "Save changes"}
          </button>
          <button className="mission-button-muted" onClick={props.onCancel} disabled={isBusy}>
            Cancel
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

export function App() {
  const mission = useMissionControl();
  const [taskSearch, setTaskSearch] = useState("");
  const deferredTaskSearch = useDeferredValue(taskSearch);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentFormMode, setAgentFormMode] = useState<"create" | "edit">("create");
  const [addIntegrationOpen, setAddIntegrationOpen] = useState(false);
  const addIntegrationRef = useRef<HTMLDivElement>(null);
  const isTasksView = mission.activeView === "tasks";

  const handleAddIntegration = useCallback(async (provider: string) => {
    setAddIntegrationOpen(false);
    const label = window.prompt(`Name for this ${INTEGRATION_OPTIONS.find((o) => o.provider === provider)?.label ?? provider} integration:`);
    if (!label) return;
    await mission.addConnector(provider, label);
  }, [mission.addConnector]);

  // Close add-integration dropdown on outside click
  useEffect(() => {
    if (!addIntegrationOpen) return;
    function handleClick(event: MouseEvent): void {
      if (addIntegrationRef.current && !addIntegrationRef.current.contains(event.target as Node)) {
        setAddIntegrationOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [addIntegrationOpen]);

  const selectedAgent = mission.agents.find((agent) => agent.id === mission.selectedAgentId) ?? null;
  const pendingHandoffs = mission.selectedTaskDetail?.handoffs.filter((handoff) => handoff.status === "pending") ?? [];
  const discoveredAgents = mission.missionSnapshot.providerAgents.length;
  const stagedAgents = mission.missionSnapshot.providerAgents.filter((agent) => !agent.officeAgentId).length;
  const activeExecutingAgentIds = new Set(
    mission.agents
      .filter((agent) => agent.status === "working")
      .map((agent) => agent.id),
  );
  mission.missionSnapshot.providerAgents.forEach((agent) => {
    if (agent.officeAgentId && isProviderAgentActivelyExecuting(agent)) {
      activeExecutingAgentIds.add(agent.officeAgentId);
    }
  });
  const activeExecutingCount = activeExecutingAgentIds.size;
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
      <div className="relative z-10 grid min-h-screen grid-cols-1 xl:h-screen xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-b border-linear-line bg-[#111318] p-3 xl:flex xl:h-screen xl:min-h-0 xl:flex-col xl:overflow-hidden xl:border-b-0 xl:border-r">
          <div className="px-2 py-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-linear-muted">The Office</p>
            <h1 className="mt-2 text-[28px] font-semibold leading-none text-white">Mission Control</h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={cx("mission-badge border", connectionTone(mission.connectionState))}>{mission.connectionState}</span>
              <span className="mission-badge">Build {DEPLOY_BADGE_LABEL}</span>
            </div>
          </div>

          <nav className="mt-5 grid gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={cx(
                  "flex items-center rounded-[8px] border border-transparent px-3 py-2.5 text-left text-[13px] font-medium text-linear-ink transition hover:bg-linear-surface hover:text-white",
                  mission.activeView === item.id && "border-linear-lineStrong bg-linear-surfaceHover text-white",
                )}
                onClick={() => {
                  startTransition(() => {
                    mission.setActiveView(item.id);
                  });
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <section className="mission-sidebar-section xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
            <div className="mission-sidebar-section-title">Office roster</div>
            <p className="mission-muted px-2 pt-1">
              {mission.agents.length} linked office agent{mission.agents.length === 1 ? "" : "s"}{stagedAgents ? ` · ${stagedAgents} staged` : ""}
            </p>
            <div className="mission-scroll mt-2 flex-1 pr-1">
              {mission.agents.map((agent) => (
                <button
                  key={agent.id}
                  className={cx(
                    "mission-sidebar-agent",
                    mission.selectedAgentId === agent.id
                      ? "mission-sidebar-agent--selected"
                      : "",
                  )}
                  onClick={() => {
                    startTransition(() => {
                      mission.setSelectedAgentId(agent.id);
                      mission.setActiveView("mission");
                    });
                  }}
                >
                  <span className="mission-avatar">{avatarLabel(agent.name, agent.emoji)}</span>
                  <div className="mission-sidebar-meta">
                    <div className="mission-sidebar-copy">
                      <div className="mission-sidebar-name">{agent.name}</div>
                      <div className="mission-sidebar-subtitle">{agent.role}</div>
                      <div className="mission-sidebar-task mission-clamp-2 mission-wrap">{agent.task || "No active task"}</div>
                    </div>
                    <span className={cx("mission-badge border", statusTone(agent.status))}>{agent.status}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="flex min-h-screen flex-col gap-3 bg-mission-950 p-3 sm:p-4 xl:h-screen xl:min-h-0 xl:overflow-hidden xl:p-4">
          {isTasksView ? (
            <header className="flex flex-col gap-2 border-b border-linear-line pb-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-linear-muted">
                  <span className="text-linear-muted">Current cycle</span>
                  <span className="text-linear-muted">›</span>
                  <span className="truncate font-medium text-white">Task Board</span>
                </div>
                <p className="mission-muted mt-1.5">
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
            <header className="flex flex-col gap-2 border-b border-linear-line pb-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-linear-muted">
                  <div className="mission-badge">Task sync {mission.missionSnapshot.taskSync.state}</div>
                  <p className="mission-muted">
                    {mission.missionSnapshot.taskSync.message || formatRelativeUpdate(mission.missionSnapshot.taskSync.updatedAt)}
                  </p>
                </div>
                <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-white">
                  {mission.activeView === "mission" ? "Hermes Mission Control" : mission.activeView === "schedules" ? "Schedules" : "Connector Settings"}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="mission-button-muted"
                  onClick={() => void mission.refreshMission()}
                >
                  Refresh snapshot
                </button>
                {mission.activeView === "settings" ? (
                  <div className="relative" ref={addIntegrationRef}>
                    <button
                      className="mission-button"
                      onClick={() => setAddIntegrationOpen((v) => !v)}
                    >
                      + Add integration
                    </button>
                    {addIntegrationOpen ? (
                      <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-linear-line bg-linear-surface shadow-lg">
                        {INTEGRATION_OPTIONS.map((opt) => (
                          <button
                            key={opt.provider}
                            className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition first:rounded-t-xl last:rounded-b-xl hover:bg-linear-surfaceHover"
                            onClick={() => { void handleAddIntegration(opt.provider); }}
                          >
                            <span className="text-[13px] font-medium text-white">{opt.label}</span>
                            <span className="text-[11px] text-linear-muted">{opt.description}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </header>
          )}

          {mission.error && mission.connectionState !== "connecting" ? (
            <div className="rounded-[10px] border border-linear-red/25 bg-linear-red/10 px-4 py-3 text-[13px] font-medium text-linear-red">
              {mission.error}
            </div>
          ) : null}

          {mission.activeView === "mission" ? (
            <div className="grid flex-1 gap-3 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_460px] 2xl:grid-cols-[minmax(0,1fr)_540px]">
              <div className="flex min-h-0 flex-col gap-3">
                <SectionCard
                  title="Command map"
                  subtitle="Office agents, provider runtimes, and the current command topology."
                  action={<span className="mission-badge">{activeExecutingCount} actively executing</span>}
                  className="flex-1 min-h-0 overflow-hidden"
                >
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <MetricCard label="Cycle tasks" value={mission.missionSnapshot.tasks.length} />
                      <MetricCard label="Office agents" value={mission.agents.length} hint={mission.agents.map((a) => a.name).join(", ") || "None registered"} tone="good" />
                      <MetricCard label="Discovered runtimes" value={discoveredAgents} />
                      <MetricCard label="Queued imports" value={mission.missionSnapshot.rosterImport.staged} tone={mission.missionSnapshot.rosterImport.staged > 0 ? "warn" : "default"} />
                    </div>
                    <div className="flex min-h-[320px] flex-1 xl:min-h-0">
                      <Suspense
                        fallback={
                          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[10px] border border-linear-line bg-linear-surface/40 text-sm text-linear-muted xl:min-h-0">
                            Loading org chart...
                          </div>
                        }
                      >
                        <OrgChart
                          agents={mission.agents}
                          providerAgents={mission.missionSnapshot.providerAgents}
                          selectedAgentId={mission.selectedAgentId}
                          thinkingAgentId={mission.busyKey?.match(/^agent:(.+):message$/)?.[1] ?? null}
                          onSelectAgent={(agentId) => mission.setSelectedAgentId(agentId)}
                        />
                      </Suspense>
                    </div>
                  </div>
                </SectionCard>

              </div>

              <div className="flex min-h-0 flex-col overflow-hidden">
                <div className="mission-scroll flex min-h-0 flex-1 flex-col gap-3 pr-1">
                  {selectedAgent ? (
                    <AgentChatPanel
                      agent={selectedAgent}
                      messages={mission.agentMessages}
                      loading={mission.agentMessagesLoading}
                      busyKey={mission.busyKey}
                      onSend={(agentId, message) => mission.sendMessageToAgent(agentId, message)}
                      onRefresh={(agentId) => mission.refreshAgentMessages(agentId)}
                      className="min-h-[420px] shrink-0 overflow-hidden 2xl:min-h-[520px]"
                    />
                  ) : (
                    <SectionCard title="Selected agent" subtitle="No agent selected" className="min-h-[220px] shrink-0">
                      <div className="rounded-xl border border-dashed border-linear-line px-4 py-12 text-center text-linear-muted">
                        Select an agent from the roster or scene.
                      </div>
                    </SectionCard>
                  )}

                  <SectionCard title="Upcoming jobs" subtitle="Provider-imported cron and scheduled runs" className="shrink-0">
                    <div className="space-y-2">
                      {mission.missionSnapshot.schedules.slice(0, 3).map((schedule) => (
                        <div key={schedule.id} className="mission-list-item">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="mission-wrap font-semibold text-white">{schedule.name}</div>
                              <div className="mission-muted mission-wrap mt-1">{schedule.recurrence}</div>
                            </div>
                            <span className="mission-badge">{schedule.provider}</span>
                          </div>
                          <div className="mission-muted mt-3">Next run {formatClockTime(schedule.nextRunAt)}</div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>

                  <SectionCard title="Pending handoffs" subtitle={`${pendingHandoffs.length} waiting on response`} className="shrink-0">
                    <div className="space-y-2">
                      {pendingHandoffs.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-linear-line px-4 py-6 text-center text-linear-muted">
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

                  <SectionCard title="Activity feed" subtitle="Live agent messages, spawns, and status changes" className="min-h-[180px] shrink-0 overflow-hidden">
                    <div className="mission-scroll max-h-[320px] flex-1 pr-1">
                      <ActivityFeed entries={mission.activityLog} limit={40} />
                    </div>
                  </SectionCard>
                </div>
              </div>
            </div>
          ) : null}

          {mission.activeView === "tasks" ? (
            <div className="grid flex-1 gap-3 xl:min-h-0 xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,390px)_minmax(0,1fr)]">
              <SectionCard title="Current cycle" subtitle="Only issues in currently active Linear cycles are synced." className="min-h-0 overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-linear-line pb-3">
                  <input
                    className="mission-input"
                    placeholder="Search issues, teams, or keys"
                    value={taskSearch}
                    onChange={(event) => setTaskSearch(event.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mission-badge">{visibleTasks.length} issues</span>
                    <span className="mission-badge">Active cycle only</span>
                  </div>
                </div>
                <div className="mission-issue-list mt-1 flex-1 space-y-1.5">
                  {visibleTasks.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-linear-muted">No tasks matched the current active cycle filter.</div>
                  ) : (
                    visibleTasks.map((task) => (
                      <button
                        key={task.id}
                        className={cx(
                          "mission-issue-row",
                          mission.selectedTaskId === task.id
                            ? "mission-issue-row--selected"
                            : "",
                        )}
                        onClick={() => {
                          startTransition(() => {
                            mission.setSelectedTaskId(task.id);
                          });
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="mission-issue-key">{task.identifier}</span>
                              <span className="mission-muted truncate">{task.team.key ?? task.team.name}</span>
                            </div>
                          </div>
                          <span className="shrink-0 text-[11px] text-linear-muted">{formatRelativeStamp(task.updatedAt)}</span>
                        </div>
                        <div className="mission-clamp-2 mission-wrap mt-2 text-sm font-medium leading-5 text-white">{task.title}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-linear-muted">
                          <span className={cx("mission-badge border", taskWorkflowTone(task))}>{task.state.name}</span>
                          <span className="mission-wrap">{task.assignee?.name ?? "Unassigned"}</span>
                          <span className="mission-wrap">{taskCycleLabel(task)}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </SectionCard>

              <TaskDetailPanel
                detail={mission.selectedTaskDetail}
                agentNames={agentNames}
                activityLog={mission.activityLog}
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

          {mission.activeView === "agents" ? (
            <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
              <AgentListPanel
                agents={mission.agents}
                selectedAgentId={editingAgentId}
                busyKey={mission.busyKey}
                onSelect={(agentId) => { setEditingAgentId(agentId); setAgentFormMode("edit"); }}
                onCreate={() => { setEditingAgentId(null); setAgentFormMode("create"); }}
                onDelete={(agentId) => mission.removeAgent(agentId)}
              />
              <AgentFormPanel
                mode={agentFormMode}
                initial={editingAgentId ? mission.agents.find((a) => a.id === editingAgentId) ?? null : null}
                agents={mission.agents}
                providerAgents={mission.missionSnapshot.providerAgents}
                connectors={mission.missionSnapshot.connectors}
                busyKey={mission.busyKey}
                onSave={async (input) => {
                  if (agentFormMode === "edit" && editingAgentId) {
                    await mission.editAgent(editingAgentId, input);
                  } else {
                    await mission.createAgent(input);
                  }
                  setEditingAgentId(null);
                  setAgentFormMode("create");
                }}
                onCancel={() => { setEditingAgentId(null); setAgentFormMode("create"); }}
              />
            </div>
          ) : null}

          {mission.activeView === "settings" ? (
            <SettingsView
              connectors={mission.missionSnapshot.connectors}
              providerAgents={mission.missionSnapshot.providerAgents}
              busyKey={mission.busyKey}
              onSave={(connectorId, input) => mission.saveConnector(connectorId, input)}
              onTest={(connectorId) => mission.testConnectorHealth(connectorId)}
              onSync={(connectorId) => mission.syncConnector(connectorId)}
              onRemove={(connectorId) => mission.removeConnector(connectorId)}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
