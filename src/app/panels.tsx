import { useEffect, useRef, useState } from "react";
import { formatProviderAgentStatus } from "../mission/providerAgents";
import type {
  AgentMessage,
  HermesDefaults,
  MissionTaskComment,
  MissionTaskCommentCreateRequest,
  MissionTaskDetail,
  MissionTeamBootstrapRequest,
  MissionTeamSettings,
  MissionTaskUpdateRequest,
  ProviderAgentRecord,
  ProviderConnector,
} from "../mission/types";
import type {
  ActivityLogEntry,
  AgentBackendProvider,
  AgentRegistration,
  AgentRuntimeState,
} from "../types";
import {
  ActivityFeed,
  MarkdownContent,
  MetricCard,
  SectionCard,
  connectorTone,
  cx,
  formatDateTime,
  formatRelativeUpdate,
  parseHermesRuntimePort,
  statusTone,
  taskAutomationTone,
  taskCycleLabel,
  taskWorkflowTone,
} from "./shared";

interface ThreadedMissionTaskComment extends MissionTaskComment {
  replies: ThreadedMissionTaskComment[];
}

function buildThreadedMissionComments(comments: MissionTaskComment[]): ThreadedMissionTaskComment[] {
  const nodes = new Map<string, ThreadedMissionTaskComment>();
  comments.forEach((comment) => {
    nodes.set(comment.id, {
      ...comment,
      replies: [],
    });
  });

  const roots: ThreadedMissionTaskComment[] = [];
  comments.forEach((comment) => {
    const node = nodes.get(comment.id);
    if (!node) {
      return;
    }

    if (comment.parentCommentId) {
      const parent = nodes.get(comment.parentCommentId);
      if (parent) {
        parent.replies.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const sortNodes = (entries: ThreadedMissionTaskComment[]): void => {
    entries.sort((left, right) => left.createdAt - right.createdAt);
    entries.forEach((entry) => sortNodes(entry.replies));
  };

  sortNodes(roots);
  return roots;
}

const CHAT_ACTIVITY_KINDS = new Set<ActivityLogEntry["kind"]>([
  "agent-message",
  "agent-status",
  "agent-spawn",
  "agent-complete",
  "meeting-turn",
]);

function stripAgentPrefix(message: string, agentName: string): string {
  const prefix = `${agentName}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

export function AgentChatPanel(props: {
  agent: AgentRuntimeState | null;
  messages: AgentMessage[];
  activityLog: ActivityLogEntry[];
  loading: boolean;
  busyKey: string | null;
  onSend(agentId: string, message: string): Promise<void>;
  onRefresh(agentId: string): Promise<void>;
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

  const agent = props.agent;
  const hasProvider = agent.backendLink?.provider && agent.backendLink.provider !== "unlinked";
  const knownMessages = new Set(
    props.messages
      .map((message) => message.content.trim())
      .filter(Boolean),
  );
  const recentUpdates = props.activityLog
    .filter((entry) => entry.agentId === agent.id && CHAT_ACTIVITY_KINDS.has(entry.kind))
    .filter((entry) => {
      if (entry.kind !== "agent-message" && entry.kind !== "meeting-turn") {
        return true;
      }
      const stripped = stripAgentPrefix(entry.message.trim(), agent.name).trim();
      return stripped.length > 0 && !knownMessages.has(stripped);
    })
    .slice(0, 4);

  return (
    <SectionCard
      title={`Chat — ${agent.name}`}
      subtitle={`${agent.role}${hasProvider ? ` · via ${agent.backendLink!.provider}` : ""}`}
      action={hasProvider ? (
        <button
          className="mission-button-muted"
          onClick={() => props.onRefresh(agentId)}
          disabled={props.loading}
        >
          {props.loading ? "Loading..." : "Refresh"}
        </button>
      ) : null}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={cx("mission-badge border", statusTone(agent.status))}>{agent.status}</span>
          <span className="mission-badge">{agent.location || "desk"}</span>
          {agent.task ? <span className="mission-muted mission-clamp-1 mission-wrap">{agent.task}</span> : null}
        </div>
        {recentUpdates.length > 0 ? (
          <div className="mb-3 overflow-hidden rounded-xl border border-linear-line bg-mission-950/75">
            <div className="flex items-center justify-between border-b border-linear-line px-3 py-2">
              <span className="mission-section-label">Live updates</span>
              <span className="mission-muted">Recent agent activity</span>
            </div>
            <div className="max-h-[220px] overflow-y-auto">
              <ActivityFeed entries={recentUpdates} limit={4} className="space-y-0" />
            </div>
          </div>
        ) : null}
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
            props.messages
              .filter((message) => {
                const trimmed = message.content.trimStart();
                return !(trimmed.startsWith("{") && /"(output|exit_code)"/.test(trimmed));
              })
              .map((message) => (
                <div
                  key={message.id}
                  className={cx(
                    "min-w-0 max-w-full rounded-lg px-3 py-2 text-sm leading-relaxed",
                    message.role === "user"
                      ? "ml-8 bg-linear-teal/15 text-linear-teal"
                      : message.role === "assistant"
                        ? "mr-8 bg-linear-surfaceAlt text-linear-ink"
                        : "bg-linear-warm/10 text-linear-warm text-xs",
                  )}
                >
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    {message.role === "user" ? "You" : message.agentName ?? agent.name}
                  </div>
                  <p className="mission-wrap whitespace-pre-wrap break-words">{message.content}</p>
                </div>
              ))
          )}
          {isSending ? (
            <div className="mr-8 min-w-0 max-w-full rounded-lg bg-linear-surfaceAlt px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-linear-muted">{agent.name}</div>
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
              placeholder={`Message ${agent.name}...`}
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
                if (!message) {
                  return;
                }
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

export function TaskDetailPanel(props: {
  detail: MissionTaskDetail | null;
  activityLog: ActivityLogEntry[];
  busyKey: string | null;
  onUpdate(taskId: string, input: MissionTaskUpdateRequest): Promise<void>;
  onComment(taskId: string, input: MissionTaskCommentCreateRequest): Promise<void>;
  onRun(taskId: string): Promise<void>;
}) {
  const task = props.detail?.task ?? null;
  const [title, setTitle] = useState("");
  const [stateName, setStateName] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [replyTargetCommentId, setReplyTargetCommentId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  useEffect(() => {
    if (!task) {
      setTitle("");
      setStateName("");
      setAssigneeId("");
      setCommentBody("");
      setReplyTargetCommentId(null);
      setReplyBody("");
      return;
    }

    setTitle(task.title);
    setStateName(task.state.name);
    setAssigneeId(task.assignee?.id ?? "");
    setCommentBody("");
    setReplyTargetCommentId(null);
    setReplyBody("");
  }, [task?.id]);

  if (!task || !props.detail) {
    return (
      <SectionCard title="Task Detail" subtitle="Pick a task from the board to inspect its Linear data and provider execution state.">
        <div className="rounded-xl border border-dashed border-linear-line bg-linear-surface px-5 py-16 text-center text-linear-muted">
          Select a task to open its mission-control detail panel.
        </div>
      </SectionCard>
    );
  }

  const busyPrefix = `task:${task.id}`;
  const isBusy = props.busyKey?.startsWith(busyPrefix) ?? false;
  const threadedComments = buildThreadedMissionComments(props.detail.comments);

  const renderCommentThread = (comment: ThreadedMissionTaskComment, depth = 0) => {
    const isReply = depth > 0;
    const isThreadStarter = depth === 0 && comment.replies.length > 0;

    return (
      <div
        key={comment.id}
        className={cx(
          isReply ? "ml-4 border-l-2 border-linear-teal/20 pl-4" : "",
          isThreadStarter ? "rounded-2xl border border-linear-lineStrong bg-mission-950/55 p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.18)]" : "",
          depth === 0 && !isThreadStarter ? "rounded-xl border border-linear-line bg-mission-950/55 p-3.5" : "",
        )}
      >
        <article
          className={cx(
            "min-w-0",
            isReply ? "rounded-xl border border-linear-line bg-mission-950/70 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]" : "",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="mission-wrap text-sm text-white">{comment.authorName}</strong>
                <span
                  className={cx(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]",
                    isReply
                      ? "border-linear-line bg-mission-900 text-linear-muted"
                      : isThreadStarter
                        ? "border-linear-teal/25 bg-linear-teal/10 text-linear-teal"
                        : "border-linear-line bg-linear-surface text-linear-muted",
                  )}
                >
                  {isReply ? "Reply" : isThreadStarter ? "Thread" : "Comment"}
                </span>
                {isThreadStarter ? (
                  <span className="mission-muted">{comment.replies.length + 1} messages</span>
                ) : null}
              </div>
            </div>
            <span className="mission-muted shrink-0">{formatDateTime(comment.createdAt)}</span>
          </div>
          {!isReply && isThreadStarter ? (
            <div className="mt-2 border-t border-linear-line/80 pt-2">
              <span className="mission-section-label">Thread starter</span>
            </div>
          ) : null}
          <div className="mission-wrap mt-3">
            <MarkdownContent text={comment.body} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className="mission-button-muted"
              disabled={isBusy}
              onClick={() => {
                setReplyTargetCommentId((current) => (current === comment.id ? null : comment.id));
                setReplyBody("");
              }}
            >
              {replyTargetCommentId === comment.id ? "Cancel reply" : "Reply"}
            </button>
            {comment.replies.length > 0 ? (
              <span className="mission-muted">{comment.replies.length} repl{comment.replies.length === 1 ? "y" : "ies"}</span>
            ) : null}
          </div>
          {replyTargetCommentId === comment.id ? (
            <div className="mt-3 rounded-xl border border-linear-teal/20 bg-mission-900/80 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="mission-section-label">Replying in thread</span>
                <span className="mission-muted">{comment.authorName}</span>
              </div>
              <textarea
                className="mission-input min-h-[96px] resize-y"
                placeholder={`Reply to ${comment.authorName}...`}
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
              />
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="mission-button-muted"
                  disabled={isBusy || !replyBody.trim()}
                  onClick={async () => {
                    const body = replyBody.trim();
                    if (!body) {
                      return;
                    }
                    await props.onComment(task.id, { body, parentCommentId: comment.id });
                    setReplyBody("");
                    setReplyTargetCommentId(null);
                  }}
                >
                  Reply in thread
                </button>
                <button
                  className="mission-button-muted"
                  disabled={isBusy}
                  onClick={() => {
                    setReplyBody("");
                    setReplyTargetCommentId(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </article>
        {comment.replies.length > 0 ? (
          <div className={cx("space-y-3", isThreadStarter ? "mt-4" : "mt-3")}>
            {isThreadStarter ? (
              <div className="flex items-center gap-2">
                <span className="mission-section-label">Replies</span>
                <div className="h-px flex-1 bg-linear-line/80" />
              </div>
            ) : null}
            {comment.replies.map((reply) => renderCommentThread(reply, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <SectionCard
      title={task.title}
      subtitle={`${task.identifier} · ${task.team.name}${task.cycle ? ` · ${taskCycleLabel(task)}` : ""}`}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {task.execution ? (
            <span className={cx("mission-badge border", taskAutomationTone(task))}>
              {task.execution.status}
            </span>
          ) : null}
          <span className={cx("mission-badge border", taskWorkflowTone(task))}>{task.state.name}</span>
        </div>
      }
      className="h-full min-h-0 overflow-hidden"
    >
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_288px]">
        <div className="mission-scroll space-y-4 pr-1">
          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-sm font-semibold text-white">Provider run</h3>
                <p className="mission-muted mt-1">
                  Submit this task to the configured provider orchestrator. Mission Control mirrors execution state but does not route sub-agents locally.
                </p>
                {task.execution ? (
                  <p className="mission-muted mt-3">
                    {task.execution.activeOwnerLabel ? `${task.execution.activeOwnerLabel} · ` : ""}
                    {task.execution.stage ?? task.execution.status}
                    {task.execution.message ? ` · ${task.execution.message}` : ""}
                  </p>
                ) : null}
              </div>
              <button
                className="mission-button"
                disabled={isBusy || task.execution?.status === "queued" || task.execution?.status === "running"}
                onClick={() => props.onRun(task.id)}
              >
                {isBusy && props.busyKey === `${busyPrefix}:run`
                  ? "Starting..."
                  : task.execution?.status === "queued" || task.execution?.status === "running"
                    ? "Run in progress"
                    : "Submit run"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <label className="mission-section-label">Title</label>
            <input className="mission-input mt-3" value={title} onChange={(event) => setTitle(event.target.value)} />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mission-section-label">State</span>
                <input className="mission-input mt-2" value={stateName} onChange={(event) => setStateName(event.target.value)} />
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
              <div className="mission-wrap mt-3">
                <MarkdownContent text={task.description} />
              </div>
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
                threadedComments.map((comment) => renderCommentThread(comment))
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
                await props.onComment(task.id, { body: commentBody.trim() });
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
              {task.execution ? (
                <div>
                  <dt className="mission-section-label">Execution</dt>
                  <dd className="mission-wrap mt-1 text-sm text-white">
                    {task.execution.activeOwnerLabel ? `${task.execution.activeOwnerLabel} · ` : ""}
                    {task.execution.stage ?? task.execution.status}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-sm font-semibold text-white">Run timeline</h3>
              <span className="mission-muted">{props.detail.events.length} events</span>
            </div>
            <div className="mt-4 space-y-3">
              {props.detail.events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-linear-line px-4 py-6 text-center text-linear-muted">
                  No run events recorded for this task.
                </div>
              ) : (
                props.detail.events.map((event) => (
                  <article key={event.id} className="mission-list-item">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mission-wrap text-sm text-white">{event.summary}</div>
                        <div className="mission-muted mt-1">
                          {event.actorLabel ?? event.kind} · {formatDateTime(event.createdAt)}
                        </div>
                      </div>
                      {event.status ? <span className={cx("mission-badge border", statusTone(event.status))}>{event.status}</span> : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-linear-line bg-linear-surface p-3.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-sm font-semibold text-white">Artifacts</h3>
              <span className="mission-muted">{props.detail.artifacts.length} mirrored</span>
            </div>
            <div className="mt-4 space-y-3">
              {props.detail.artifacts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-linear-line px-4 py-6 text-center text-linear-muted">
                  No provider artifacts recorded for this task.
                </div>
              ) : (
                props.detail.artifacts.map((artifact) => (
                  <article key={artifact.id} className="mission-list-item">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mission-wrap text-sm font-medium text-white">{artifact.label}</div>
                        {artifact.body ? <div className="mission-wrap mission-muted mt-1">{artifact.body}</div> : null}
                        {artifact.url ? (
                          <a className="mission-muted mt-2 inline-block underline" href={artifact.url} target="_blank" rel="noreferrer">
                            {artifact.url}
                          </a>
                        ) : null}
                      </div>
                      <span className="mission-badge">{artifact.kind}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
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

export function HermesDefaultsCard(props: {
  defaults: HermesDefaults;
  busyKey: string | null;
  onSave(input: { sshHost: string; runtimeHost: string; token?: string }): Promise<void>;
}) {
  const [sshHost, setSshHost] = useState(props.defaults.sshHost ?? "");
  const [runtimeHost, setRuntimeHost] = useState(props.defaults.runtimeHost ?? "");
  const [token, setToken] = useState("");

  useEffect(() => {
    setSshHost(props.defaults.sshHost ?? "");
    setRuntimeHost(props.defaults.runtimeHost ?? "");
    setToken("");
  }, [props.defaults.runtimeHost, props.defaults.sshHost, props.defaults.tokenConfigured]);

  const isBusy = props.busyKey === "hermes-defaults:save";

  return (
    <SectionCard
      title="Shared Hermes defaults"
      subtitle="Use one host and token across Hermes-family connectors, then override only when a gateway needs its own values."
      action={<span className="mission-badge">{props.defaults.tokenConfigured ? "Token configured" : "No token"}</span>}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1.5">
          <span className="mission-section-label">SSH host</span>
          <input className="mission-input" value={sshHost} onChange={(event) => setSshHost(event.target.value)} placeholder="matt@192.168.1.113" />
          <p className="mission-muted text-[11px]">Used when a Hermes connector inherits shared defaults.</p>
        </label>
        <label className="space-y-1.5">
          <span className="mission-section-label">Runtime host</span>
          <input className="mission-input" value={runtimeHost} onChange={(event) => setRuntimeHost(event.target.value)} placeholder="http://192.168.1.113" />
          <p className="mission-muted text-[11px]">Connectors can derive their runtime URL from this host plus their own port.</p>
        </label>
        <label className="space-y-1.5">
          <span className="mission-section-label">API token</span>
          <input
            className="mission-input"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={props.defaults.tokenConfigured ? "Leave blank to keep current" : "Bearer token for /events"}
          />
          <p className="mission-muted text-[11px]">Shared bearer token for runtime events and API auth.</p>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="mission-button"
          disabled={isBusy}
          onClick={() => {
            void props.onSave({
              sshHost,
              runtimeHost,
              ...(token.trim() ? { token: token.trim() } : {}),
            });
          }}
        >
          {isBusy ? "Saving..." : "Save shared defaults"}
        </button>
        <span className="mission-muted">These values can power Hermes, Scout, Atlas, and Orbit when inheritance is enabled.</span>
      </div>
    </SectionCard>
  );
}

export function ConnectorSettingsCard(props: {
  connector: ProviderConnector;
  hermesDefaults: HermesDefaults;
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
      useHermesDefaults?: boolean;
    },
  ): Promise<void>;
  onTest(connectorId: string): Promise<void>;
  onSync(connectorId: string): Promise<void>;
  onRemove(connectorId: string): void;
}) {
  const fields = props.connector.configFields;
  const isHermes = props.connector.provider === "hermes";
  const [enabled, setEnabled] = useState(props.connector.enabled);
  const [useHermesDefaults, setUseHermesDefaults] = useState(props.connector.useHermesDefaults ?? isHermes);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(() => {
    if (!fields) {
      return {};
    }

    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      initial[field.key] = field.type === "password" ? "" : (props.connector.adapterConfig?.[field.key] ?? "");
    }
    return initial;
  });

  useEffect(() => {
    setEnabled(props.connector.enabled);
    setUseHermesDefaults(props.connector.useHermesDefaults ?? isHermes);

    if (!fields) {
      return;
    }

    const next: Record<string, unknown> = {};
    for (const field of fields) {
      next[field.key] = field.type === "password" ? "" : (props.connector.adapterConfig?.[field.key] ?? "");
    }
    if (isHermes) {
      next.runtimePort = props.connector.adapterConfig?.runtimePort ?? parseHermesRuntimePort(
        props.connector.runtimeBaseUrl,
        props.hermesDefaults.runtimeHost,
      );
    }
    setFieldValues(next);
  }, [fields, isHermes, props.connector.adapterConfig, props.connector.enabled, props.connector.id, props.connector.runtimeBaseUrl, props.connector.useHermesDefaults, props.hermesDefaults.runtimeHost]);

  const isBusy = props.busyKey?.startsWith(`connector:${props.connector.id}`) ?? false;

  async function handleSave(): Promise<void> {
    const tokenValue = String(fieldValues.token ?? "").trim();
    const knownKeys = new Set(["baseUrl", "websocketUrl", "runtimeBaseUrl", "runtimePort", "token"]);
    const extras: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(fieldValues)) {
      if (!knownKeys.has(key)) {
        extras[key] = value;
      }
    }

    const runtimePortValue = String(fieldValues.runtimePort ?? "").trim();
    if (isHermes && useHermesDefaults && runtimePortValue) {
      extras.runtimePort = Number(runtimePortValue);
    }

    await props.onSave(props.connector.id, {
      enabled,
      baseUrl: String(fieldValues.baseUrl ?? props.connector.baseUrl ?? ""),
      websocketUrl: isHermes && useHermesDefaults ? "" : String(fieldValues.websocketUrl ?? props.connector.websocketUrl ?? ""),
      runtimeBaseUrl: isHermes && useHermesDefaults ? "" : String(fieldValues.runtimeBaseUrl ?? props.connector.runtimeBaseUrl ?? ""),
      ...(tokenValue ? { token: tokenValue } : {}),
      ...(Object.keys(extras).length > 0 ? { adapterConfig: extras } : {}),
      ...(isHermes ? { useHermesDefaults } : {}),
    });

    setFieldValues((previous) => ({ ...previous, token: "" }));
  }

  function updateField(key: string, value: unknown): void {
    setFieldValues((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <SectionCard
      title={props.connector.label}
      subtitle={props.connector.health.message ?? "No connector message."}
      action={
        <div className="flex items-center gap-2">
          <span className={cx("mission-badge border", connectorTone(props.connector.health.status))}>{props.connector.health.status}</span>
          {props.connector.lastSyncAt ? <span className="mission-badge">{formatRelativeUpdate(props.connector.lastSyncAt)}</span> : null}
        </div>
      }
    >
      {isHermes ? (
        <div className="grid gap-4">
          <label className="space-y-1.5">
            <span className="mission-section-label">CLI command</span>
            <input
              className="mission-input"
              value={String(fieldValues.baseUrl ?? "")}
              onChange={(event) => updateField("baseUrl", event.target.value)}
              placeholder="hermes"
            />
            <p className="mission-muted text-[11px]">CLI binary name or full path. Use wrappers if each gateway needs its own profile.</p>
          </label>
          <label className="inline-flex items-center gap-3 rounded-xl border border-linear-line bg-[#0f1218] px-3 py-3 text-sm text-white">
            <input type="checkbox" checked={useHermesDefaults} onChange={(event) => setUseHermesDefaults(event.target.checked)} />
            Use shared Hermes host defaults
          </label>
          {useHermesDefaults ? (
            <>
              <div className="grid gap-3 rounded-xl border border-linear-line bg-[#0f1218] px-4 py-4 md:grid-cols-3">
                <div>
                  <div className="mission-section-label">SSH host</div>
                  <div className="mt-2 text-sm text-white">{props.hermesDefaults.sshHost || "Not set"}</div>
                </div>
                <div>
                  <div className="mission-section-label">Runtime host</div>
                  <div className="mt-2 text-sm text-white">{props.hermesDefaults.runtimeHost || "Not set"}</div>
                </div>
                <div>
                  <div className="mission-section-label">Token</div>
                  <div className="mt-2 text-sm text-white">{props.hermesDefaults.tokenConfigured ? "Configured" : "Not set"}</div>
                </div>
              </div>
              <label className="space-y-1.5">
                <span className="mission-section-label">Runtime port</span>
                <input
                  className="mission-input"
                  type="number"
                  value={String(fieldValues.runtimePort ?? "")}
                  onChange={(event) => updateField("runtimePort", event.target.value)}
                  placeholder="8642"
                />
                <p className="mission-muted text-[11px]">
                  Derived URL: {props.hermesDefaults.runtimeHost && String(fieldValues.runtimePort ?? "").trim()
                    ? `${props.hermesDefaults.runtimeHost.replace(/\/+$/, "")}:${String(fieldValues.runtimePort ?? "").trim()}`
                    : "set shared runtime host and a port"}
                </p>
              </label>
            </>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-1.5">
                <span className="mission-section-label">SSH host</span>
                <input
                  className="mission-input"
                  value={String(fieldValues.websocketUrl ?? "")}
                  onChange={(event) => updateField("websocketUrl", event.target.value)}
                  placeholder="matt@192.168.1.113"
                />
              </label>
              <label className="space-y-1.5">
                <span className="mission-section-label">Runtime bridge URL</span>
                <input
                  className="mission-input"
                  value={String(fieldValues.runtimeBaseUrl ?? "")}
                  onChange={(event) => updateField("runtimeBaseUrl", event.target.value)}
                  placeholder="http://192.168.1.113:8642"
                />
              </label>
              <label className="space-y-1.5">
                <span className="mission-section-label">API token</span>
                <input
                  className="mission-input"
                  type="password"
                  value={String(fieldValues.token ?? "")}
                  onChange={(event) => updateField("token", event.target.value)}
                  placeholder={props.connector.tokenConfigured ? "Leave blank to keep current" : "Bearer token"}
                />
              </label>
            </div>
          )}
        </div>
      ) : fields && fields.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
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
              {field.hint ? <p className="mission-muted text-[11px]">{field.hint}</p> : null}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-linear-muted">No configuration fields available for this adapter.</p>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="inline-flex items-center gap-3 rounded-xl border border-linear-line bg-[#0f1218] px-3 py-2.5 text-sm text-white">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Connector enabled
        </label>
        <span className="mission-muted">{(props.connector.tokenConfigured || (isHermes && useHermesDefaults && props.hermesDefaults.tokenConfigured)) ? "Token configured" : "No token set"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="mission-button" disabled={isBusy} onClick={() => { void handleSave(); }}>
          {isBusy ? "Saving..." : "Save connector"}
        </button>
        <button className="mission-button-muted" disabled={isBusy} onClick={() => props.onTest(props.connector.id)}>
          Test
        </button>
        <button className="mission-button-muted" disabled={isBusy} onClick={() => props.onSync(props.connector.id)}>
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

export function ProviderRosterPanel(props: {
  connectors: ProviderConnector[];
  agents: ProviderAgentRecord[];
  title: string;
  subtitle: string;
  busyKey?: string | null;
  onSyncConnector?(connectorId: string): Promise<void>;
}) {
  return (
    <SectionCard title={props.title} subtitle={props.subtitle}>
      <div className="space-y-4">
        {props.connectors.map((connector) => {
          const roster = props.agents.filter((agent) => agent.connectorId === connector.id);
          const linked = roster.filter((agent) => agent.officeAgentId).length;
          const staged = roster.length - linked;
          const isBusy = props.busyKey === `connector:${connector.id}:sync`;

          return (
            <article key={connector.id} className="rounded-xl border border-linear-line bg-linear-surface p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="font-semibold text-white">{connector.label}</div>
                  <p className="mission-muted mt-1">{connector.health.message ?? "Waiting for sync."}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx("mission-badge border", connectorTone(connector.health.status))}>{connector.health.status}</span>
                  <span className="mission-badge">{roster.length} discovered</span>
                  {props.onSyncConnector ? (
                    <button className="mission-button-muted" disabled={isBusy} onClick={() => { void props.onSyncConnector?.(connector.id); }}>
                      {isBusy ? "Syncing..." : "Sync"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MetricCard label="Discovered" value={roster.length} />
                <MetricCard label="Linked" value={linked} />
                <MetricCard label="Staged" value={staged} />
              </div>

              <div className="mt-4 space-y-2">
                {roster.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-linear-line px-4 py-4 text-sm text-linear-muted">
                    No agents discovered yet. If the connector is reachable but this stays empty, check provider auth and whether the runtime exposes a supported roster or session API.
                  </div>
                ) : (
                  roster.map((agent) => (
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
              </div>
            </article>
          );
        })}
      </div>
    </SectionCard>
  );
}

interface TeamBootstrapDraftRow {
  key: string;
  connectorId: string;
  connectorLabel: string;
  externalId: string;
  selected: boolean;
  officeAgentId: string;
  name: string;
  role: string;
  emoji: string;
  parentOfficeAgentId: string;
  linked: boolean;
}

function slugifyOfficeAgentId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function providerAliases(value: string): Set<string> {
  const trimmed = value.trim();
  const aliases = new Set<string>([trimmed]);
  if (!trimmed) {
    return aliases;
  }
  if (trimmed.endsWith("-gateway")) {
    aliases.add(trimmed.slice(0, -"-gateway".length));
  } else {
    aliases.add(`${trimmed}-gateway`);
  }
  return aliases;
}

function linkedOfficeAgentId(
  officeAgents: AgentRuntimeState[],
  connectorId: string,
  externalId: string,
): string | undefined {
  const aliases = providerAliases(externalId);
  return officeAgents.find((agent) => {
    const backendLink = agent.backendLink;
    const backendAgentId = backendLink?.agentId?.trim();
    return Boolean(
      backendLink
      && backendLink.connectorId === connectorId
      && backendAgentId
      && aliases.has(backendAgentId),
    );
  })?.id;
}

function buildBootstrapDraftRows(
  connectors: ProviderConnector[],
  providerAgents: ProviderAgentRecord[],
  officeAgents: AgentRuntimeState[],
): TeamBootstrapDraftRow[] {
  const connectorLabels = new Map(connectors.map((connector) => [connector.id, connector.label]));
  const rows = providerAgents.map<TeamBootstrapDraftRow>((agent) => {
    const existingOfficeAgentId = linkedOfficeAgentId(officeAgents, agent.connectorId, agent.externalId);
    const existingOfficeAgent = existingOfficeAgentId
      ? officeAgents.find((officeAgent) => officeAgent.id === existingOfficeAgentId) ?? null
      : null;

    return {
      key: `${agent.connectorId}:${agent.externalId}`,
      connectorId: agent.connectorId,
      connectorLabel: connectorLabels.get(agent.connectorId) ?? agent.connectorId,
      externalId: agent.externalId,
      selected: true,
      officeAgentId: existingOfficeAgent?.id ?? slugifyOfficeAgentId(agent.name || agent.externalId),
      name: existingOfficeAgent?.name ?? agent.name,
      role: existingOfficeAgent?.role ?? agent.title ?? agent.role ?? agent.teamName ?? "Engineer",
      emoji: existingOfficeAgent?.emoji ?? "",
      parentOfficeAgentId: existingOfficeAgent?.parentAgentId ?? "",
      linked: Boolean(existingOfficeAgent),
    };
  });

  const officeIdByProviderKey = new Map(rows.map((row) => [row.key, row.officeAgentId]));
  return rows.map((row) => {
    if (row.parentOfficeAgentId) {
      return row;
    }
    const providerAgent = providerAgents.find((entry) => `${entry.connectorId}:${entry.externalId}` === row.key);
    const parentExternalId = providerAgent?.reportsToExternalId ?? providerAgent?.managerExternalId;
    if (!parentExternalId) {
      return row;
    }
    const parentRow = providerAgents.find((entry) => providerAliases(entry.externalId).has(parentExternalId));
    if (!parentRow) {
      return row;
    }
    return {
      ...row,
      parentOfficeAgentId: officeIdByProviderKey.get(`${parentRow.connectorId}:${parentRow.externalId}`) ?? "",
    };
  });
}

export function TeamBootstrapPanel(props: {
  connectors: ProviderConnector[];
  providerAgents: ProviderAgentRecord[];
  officeAgents: AgentRuntimeState[];
  teamSettings: MissionTeamSettings;
  busyKey: string | null;
  onSyncConnector?(connectorId: string): Promise<void>;
  onApply(input: MissionTeamBootstrapRequest): Promise<void>;
}) {
  const [rows, setRows] = useState<TeamBootstrapDraftRow[]>([]);
  const [commandAgentId, setCommandAgentId] = useState("");
  const [defaultRunConnectorId, setDefaultRunConnectorId] = useState("");

  useEffect(() => {
    const nextRows = buildBootstrapDraftRows(props.connectors, props.providerAgents, props.officeAgents);
    setRows(nextRows);
    setCommandAgentId(props.teamSettings.commandAgentId ?? nextRows.find((row) => !row.parentOfficeAgentId)?.officeAgentId ?? nextRows[0]?.officeAgentId ?? "");
    setDefaultRunConnectorId(props.teamSettings.defaultRunConnectorId ?? nextRows[0]?.connectorId ?? "");
  }, [props.connectors, props.officeAgents, props.providerAgents, props.teamSettings.commandAgentId, props.teamSettings.defaultRunConnectorId]);

  const isBusy = props.busyKey === "team:bootstrap";
  const selectedRows = rows.filter((row) => row.selected);
  const selectedOfficeAgentIds = new Set(selectedRows.map((row) => row.officeAgentId.trim()).filter(Boolean));
  const connectorGroups = props.connectors
    .filter((connector) => connector.enabled)
    .map((connector) => ({
      connector,
      rows: rows.filter((row) => row.connectorId === connector.id),
    }));
  const parentOptions = [
    ...selectedRows.map((row) => ({
      id: row.officeAgentId,
      label: `${row.name || row.officeAgentId} (${row.officeAgentId})`,
    })),
    ...props.officeAgents
      .filter((agent) => !selectedOfficeAgentIds.has(agent.id))
      .map((agent) => ({
        id: agent.id,
        label: `${agent.name} (${agent.id})`,
      })),
  ];

  function patchRow(rowKey: string, patch: Partial<TeamBootstrapDraftRow>): void {
    setRows((current) => current.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
  }

  async function handleApply(): Promise<void> {
    const agents = selectedRows.map((row) => ({
      officeAgentId: row.officeAgentId.trim(),
      connectorId: row.connectorId,
      externalId: row.externalId,
      name: row.name.trim(),
      role: row.role.trim(),
      emoji: row.emoji.trim() || undefined,
      type: "resident" as const,
      parentOfficeAgentId: row.parentOfficeAgentId.trim() || null,
    }));

    await props.onApply({
      commandAgentId: commandAgentId || undefined,
      defaultRunConnectorId: defaultRunConnectorId || undefined,
      agents,
    });
  }

  const hasInvalidRow = selectedRows.some((row) => !row.officeAgentId.trim() || !row.name.trim() || !row.role.trim());

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-linear-line bg-[#111318]/95 shadow-[0_8px_30px_rgba(0,0,0,0.22)]">
        <div className="border-b border-linear-line px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-linear-muted">Workspace</div>
              <h2 className="mt-1 text-xl font-semibold text-white">Build the team from discovered runtimes</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-linear-muted">
                Sync each connector, keep the runtimes you want, assign their role in the org, then set which lead receives new runs first.
              </p>
            </div>
            <div className="grid min-w-[220px] gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-linear-line bg-[#0d0f14] px-3 py-2.5">
                <div className="mission-section-label">Discovered</div>
                <div className="mt-2 text-lg font-semibold text-white">{rows.length}</div>
              </div>
              <div className="rounded-xl border border-linear-line bg-[#0d0f14] px-3 py-2.5">
                <div className="mission-section-label">Selected</div>
                <div className="mt-2 text-lg font-semibold text-white">{selectedRows.length}</div>
              </div>
              <div className="rounded-xl border border-linear-line bg-[#0d0f14] px-3 py-2.5">
                <div className="mission-section-label">Linked</div>
                <div className="mt-2 text-lg font-semibold text-white">{selectedRows.filter((row) => row.linked).length}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mission-section-label">Command lead</span>
              <select className="mission-input mt-2" value={commandAgentId} onChange={(event) => setCommandAgentId(event.target.value)}>
                <option value="">Select a lead</option>
                {selectedRows.map((row) => (
                  <option key={row.key} value={row.officeAgentId}>{row.name || row.officeAgentId}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mission-section-label">Default run connector</span>
              <select className="mission-input mt-2" value={defaultRunConnectorId} onChange={(event) => setDefaultRunConnectorId(event.target.value)}>
                <option value="">Automatic</option>
                {props.connectors.filter((connector) => connector.enabled).map((connector) => (
                  <option key={connector.id} value={connector.id}>{connector.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="rounded-xl border border-linear-line bg-[#0d0f14] px-4 py-3">
            <div className="mission-section-label">Suggested structure</div>
            <p className="mt-2 text-sm leading-6 text-linear-muted">
              For your setup: make <span className="text-white">Hermes</span> the command lead, <span className="text-white">Scout</span> report to Hermes, and have <span className="text-white">Atlas</span> and <span className="text-white">Orbit</span> report to Scout.
            </p>
          </div>
        </div>
      </section>

      {connectorGroups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-linear-line bg-[#111318]/90 px-5 py-8 text-sm text-linear-muted">
          Add and enable at least one connector in Settings, then come back here to build the team.
        </div>
      ) : (
        connectorGroups.map(({ connector, rows: connectorRows }) => {
          const isSyncing = props.busyKey === `connector:${connector.id}:sync`;
          return (
            <section key={connector.id} className="rounded-2xl border border-linear-line bg-[#111318]/95 shadow-[0_8px_30px_rgba(0,0,0,0.18)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linear-line px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-white">{connector.label}</h3>
                    <span className={cx("mission-badge border", connectorTone(connector.health.status))}>{connector.health.status}</span>
                    <span className="mission-badge">{connectorRows.length} discovered</span>
                  </div>
                  <p className="mt-2 text-sm text-linear-muted">{connector.health.message ?? "Waiting for connector sync."}</p>
                </div>
                {props.onSyncConnector ? (
                  <button className="mission-button-muted" disabled={isSyncing} onClick={() => { void props.onSyncConnector?.(connector.id); }}>
                    {isSyncing ? "Syncing..." : "Sync runtime"}
                  </button>
                ) : null}
              </div>

              {connectorRows.length === 0 ? (
                <div className="px-5 py-6 text-sm text-linear-muted">
                  No runtimes discovered yet for this connector. If the health check passes but this remains empty, verify the gateway exposes roster or runtime state.
                </div>
              ) : (
                <div className="px-3 py-3">
                  <div className="hidden grid-cols-[44px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_220px] gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-linear-muted lg:grid">
                    <span>Use</span>
                    <span>Runtime</span>
                    <span>Name + ID</span>
                    <span>Role</span>
                    <span>Reports to</span>
                  </div>
                  <div className="space-y-2">
                    {connectorRows.map((row) => (
                      <article
                        key={row.key}
                        className={cx(
                          "rounded-xl border px-3 py-3 transition",
                          row.selected ? "border-linear-lineStrong bg-[#151922]" : "border-linear-line bg-[#0f1218]",
                        )}
                      >
                        <div className="grid gap-3 lg:grid-cols-[44px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_220px] lg:items-center">
                          <label className="flex items-center justify-center pt-1 lg:pt-0">
                            <input type="checkbox" checked={row.selected} onChange={(event) => patchRow(row.key, { selected: event.target.checked })} />
                          </label>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="truncate text-sm font-medium text-white">{row.externalId}</div>
                              <span className="mission-badge">{row.linked ? "linked" : "new"}</span>
                            </div>
                            <div className="mt-1 text-xs text-linear-muted">{connector.label}</div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px] lg:grid-cols-1">
                            <input
                              className="mission-input"
                              value={row.name}
                              onChange={(event) => patchRow(row.key, { name: event.target.value })}
                              placeholder="Display name"
                            />
                            <input
                              className="mission-input"
                              value={row.officeAgentId}
                              onChange={(event) => patchRow(row.key, { officeAgentId: slugifyOfficeAgentId(event.target.value) })}
                              placeholder="office-agent-id"
                            />
                          </div>

                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_84px] lg:grid-cols-1">
                            <input
                              className="mission-input"
                              value={row.role}
                              onChange={(event) => patchRow(row.key, { role: event.target.value })}
                              placeholder="Role"
                            />
                            <input
                              className="mission-input"
                              value={row.emoji}
                              onChange={(event) => patchRow(row.key, { emoji: event.target.value })}
                              placeholder="Emoji"
                            />
                          </div>

                          <select className="mission-input" value={row.parentOfficeAgentId} onChange={(event) => patchRow(row.key, { parentOfficeAgentId: event.target.value })}>
                            <option value="">Top-level</option>
                            {parentOptions
                              .filter((option) => option.id !== row.officeAgentId)
                              .map((option) => (
                                <option key={`${row.key}:${option.id}`} value={option.id}>{option.label}</option>
                              ))}
                          </select>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}

      <div className="sticky bottom-0 z-10 rounded-2xl border border-linear-line bg-[#101318]/95 px-5 py-4 shadow-[0_-12px_30px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-medium text-white">Ready to save the org chart</div>
            <p className="mt-1 text-sm text-linear-muted">
              {selectedRows.length} of {rows.length} discovered runtimes will be added to the visible team.
            </p>
          </div>
          <button className="mission-button" disabled={isBusy || selectedRows.length === 0 || hasInvalidRow} onClick={() => { void handleApply(); }}>
            {isBusy ? "Saving team..." : "Save team setup"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentListPanel(props: {
  title?: string;
  subtitle?: string;
  agents: AgentRuntimeState[];
  selectedAgentId: string | null;
  busyKey: string | null;
  onSelect?(agentId: string): void;
  onCreate?(): void;
  onDelete?(agentId: string): Promise<void>;
}) {
  const showDelete = Boolean(props.onDelete);
  const showCreate = Boolean(props.onCreate);
  return (
    <SectionCard
      title={props.title ?? "Office agents"}
      subtitle={props.subtitle ?? `${props.agents.length} agent${props.agents.length === 1 ? "" : "s"}`}
      action={showCreate ? <button className="mission-button" onClick={props.onCreate}>New agent</button> : undefined}
    >
      <div className="mission-table">
        <div className={cx("mission-table-head", showDelete ? "grid-cols-[minmax(0,1fr)_100px_80px_72px]" : "grid-cols-[minmax(0,1fr)_100px_80px]")}>
          <span>Agent</span>
          <span>Provider</span>
          <span>Status</span>
          {showDelete ? <span></span> : null}
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
                  "mission-table-row w-full",
                  showDelete ? "grid-cols-[minmax(0,1fr)_100px_80px_72px]" : "grid-cols-[minmax(0,1fr)_100px_80px]",
                  props.selectedAgentId === agent.id ? "bg-linear-teal/10" : "",
                )}
                onClick={() => props.onSelect?.(agent.id)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-base">{agent.emoji || "\u{1F916}"}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-white">{agent.name}</span>
                    <span className="block truncate text-[11px] text-linear-muted">{agent.role}</span>
                  </span>
                </span>
                <span className="mission-badge w-fit">{provider}</span>
                <span className={cx("mission-badge border w-fit", statusTone(agent.status))}>{agent.status}</span>
                {showDelete ? (
                  <span
                    className="cursor-pointer text-[11px] text-linear-red hover:underline"
                    role="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (window.confirm(`Remove agent "${agent.name}"?`) && !isBusy) {
                        void props.onDelete?.(agent.id);
                      }
                    }}
                  >
                    {isBusy ? "..." : "Remove"}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </SectionCard>
  );
}

const PROVIDER_BY_CONNECTOR: Record<ProviderConnector["provider"], AgentBackendProvider> = {
  hermes: "hermes",
  "claude-local": "claude",
  "codex-local": "codex",
};

export function AgentFormPanel(props: {
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
      return;
    }

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
  }, [props.initial, props.mode]);

  const isBusy = props.busyKey?.startsWith("agent:") ?? false;
  const connectorOptions = props.connectors.filter((connector) => connector.enabled);
  const filteredProviderAgents = connectorId
    ? props.providerAgents.filter((agent) => agent.connectorId === connectorId)
    : [];
  const currentId = props.mode === "edit" ? props.initial?.id : id;
  const parentCandidates = props.agents.filter((agent) => agent.id !== currentId);

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
            <input className="mission-input mt-1.5" value={id} onChange={(event) => setId(event.target.value)} placeholder="e.g. dan-agent" />
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
            {parentCandidates.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name} ({agent.id})</option>
            ))}
          </select>
          <p className="mission-muted mt-1 text-[10px]">Set this agent's parent in the org chart. Top-level agents appear as peer orchestrators.</p>
        </label>

        <div className="mt-2 border-t border-linear-line pt-3">
          <p className="mb-3 mission-section-label">Provider link</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mission-section-label">Connector</span>
              <select
                className="mission-input mt-1.5"
                value={connectorId}
                onChange={(event) => {
                  const nextConnectorId = event.target.value;
                  const connector = props.connectors.find((candidate) => candidate.id === nextConnectorId);
                  setConnectorId(nextConnectorId);
                  setProvider(connector ? PROVIDER_BY_CONNECTOR[connector.provider] : "unlinked");
                  setExternalId("");
                }}
              >
                <option value="">Unlinked</option>
                {connectorOptions.map((connector) => (
                  <option key={connector.id} value={connector.id}>{connector.label}</option>
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
