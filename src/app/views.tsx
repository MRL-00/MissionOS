import { useEffect, useMemo, useState } from "react";
import type { MissionControlState } from "../mission/hooks/useMissionControl";
import { formatProviderAgentStatus } from "../mission/providerAgents";
import { compareMissionTasksForBoard, getMissionTaskBoardStage } from "../mission/taskBoard";
import type {
  MissionTask,
  MissionTaskDetail,
  MissionTeamBootstrapRequest,
  ProviderAgentRecord,
  ProviderConnector,
} from "../mission/types";
import type { AgentRuntimeState } from "../types";
import { ConnectorSettingsCard, HermesDefaultsCard } from "./panels";
import {
  ActivityFeed,
  MarkdownContent,
  MetricCard,
  SectionCard,
  avatarLabel,
  connectorTone,
  cx,
  formatDateTime,
  formatRelativeStamp,
  formatRelativeUpdate,
  statusTone,
  taskAutomationTone,
  taskCycleLabel,
  taskWorkflowTone,
} from "./shared";

type TeamDraftRow = {
  key: string;
  connectorId: string;
  externalId: string;
  selected: boolean;
  name: string;
  role: string;
  officeAgentId: string;
  emoji: string;
  parentOfficeAgentId: string;
  sourceKind: "provider" | "connector";
  sourceLabel: string;
  statusLabel: string;
};

function normalizeOfficeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
}

function suggestRole(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("hermes")) return "Command lead";
  if (normalized.includes("scout")) return "Lead engineer";
  if (normalized.includes("atlas")) return "Senior engineer";
  if (normalized.includes("orbit")) return "Specialist engineer";
  if (normalized.includes("claude")) return "AI specialist";
  if (normalized.includes("codex")) return "Implementation engineer";
  return "Team member";
}

function suggestEmoji(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("hermes")) return "🧠";
  if (normalized.includes("scout")) return "🧭";
  if (normalized.includes("atlas")) return "🛠️";
  if (normalized.includes("orbit")) return "📱";
  if (normalized.includes("claude")) return "✍️";
  if (normalized.includes("codex")) return "⚙️";
  return "•";
}

function priorityTone(task: MissionTask): "default" | "warn" | "danger" {
  if (task.priority <= 1) return "danger";
  if (task.priority === 2) return "warn";
  return "default";
}

function summarizeTaskDescription(task: MissionTask): string {
  return task.description?.trim() || "No task description has been mirrored yet.";
}

function groupTasks(tasks: MissionTask[]) {
  const buckets = {
    todo: [] as MissionTask[],
    in_progress: [] as MissionTask[],
    review: [] as MissionTask[],
    done: [] as MissionTask[],
    backlog: [] as MissionTask[],
  };

  tasks.forEach((task) => {
    const stage = getMissionTaskBoardStage(task.state);
    if (stage === "todo") {
      buckets.todo.push(task);
      return;
    }
    if (stage === "in_progress") {
      buckets.in_progress.push(task);
      return;
    }
    if (stage === "qa_review" || stage === "uat_review" || stage === "ready_to_deploy") {
      buckets.review.push(task);
      return;
    }
    if (stage === "deployed") {
      buckets.done.push(task);
      return;
    }
    buckets.backlog.push(task);
  });

  return buckets;
}

function buildTeamDraft(connectors: ProviderConnector[], providerAgents: ProviderAgentRecord[], officeAgents: AgentRuntimeState[]): TeamDraftRow[] {
  const rows: TeamDraftRow[] = [];
  const usedConnectors = new Set<string>();

  const officeByLink = new Map<string, AgentRuntimeState>();
  officeAgents.forEach((agent) => {
    const connectorId = agent.backendLink?.connectorId?.trim();
    const externalId = agent.backendLink?.agentId?.trim();
    if (connectorId && externalId) {
      officeByLink.set(`${connectorId}:${externalId}`, agent);
    }
  });

  providerAgents.forEach((providerAgent) => {
    usedConnectors.add(providerAgent.connectorId);
    const linkedAgent = providerAgent.officeAgentId
      ? officeAgents.find((agent) => agent.id === providerAgent.officeAgentId)
      : officeByLink.get(`${providerAgent.connectorId}:${providerAgent.externalId}`);
    rows.push({
      key: `provider:${providerAgent.connectorId}:${providerAgent.externalId}`,
      connectorId: providerAgent.connectorId,
      externalId: providerAgent.externalId,
      selected: providerAgent.imported || Boolean(linkedAgent),
      name: linkedAgent?.name ?? providerAgent.name,
      role: linkedAgent?.role ?? providerAgent.title ?? providerAgent.role ?? suggestRole(providerAgent.name),
      officeAgentId: linkedAgent?.id ?? normalizeOfficeId(providerAgent.name),
      emoji: linkedAgent?.emoji ?? suggestEmoji(providerAgent.name),
      parentOfficeAgentId: linkedAgent?.parentAgentId ?? "",
      sourceKind: "provider",
      sourceLabel: providerAgent.name,
      statusLabel: formatProviderAgentStatus(providerAgent),
    });
  });

  connectors
    .filter((connector) => connector.enabled)
    .forEach((connector) => {
      if (usedConnectors.has(connector.id)) {
        return;
      }
      const linkedAgent = officeAgents.find((agent) => agent.backendLink?.connectorId === connector.id);
      rows.push({
        key: `connector:${connector.id}`,
        connectorId: connector.id,
        externalId: linkedAgent?.backendLink?.agentId ?? normalizeOfficeId(connector.label),
        selected: Boolean(linkedAgent),
        name: linkedAgent?.name ?? connector.label,
        role: linkedAgent?.role ?? suggestRole(connector.label),
        officeAgentId: linkedAgent?.id ?? normalizeOfficeId(connector.label),
        emoji: linkedAgent?.emoji ?? suggestEmoji(connector.label),
        parentOfficeAgentId: linkedAgent?.parentAgentId ?? "",
        sourceKind: "connector",
        sourceLabel: `${connector.label} runtime`,
        statusLabel: connector.health.status,
      });
    });

  return applyRecommendedStructure(rows);
}

function applyRecommendedStructure(rows: TeamDraftRow[]): TeamDraftRow[] {
  const hermes = rows.find((row) => row.name.toLowerCase().includes("hermes"));
  const scout = rows.find((row) => row.name.toLowerCase().includes("scout"));

  return rows
    .map((row) => {
      if (row.parentOfficeAgentId) {
        return row;
      }
      const normalized = row.name.toLowerCase();
      if (normalized.includes("hermes")) {
        return { ...row, parentOfficeAgentId: "" };
      }
      if (normalized.includes("scout")) {
        return { ...row, parentOfficeAgentId: hermes?.officeAgentId ?? "" };
      }
      if (normalized.includes("atlas") || normalized.includes("orbit")) {
        return { ...row, parentOfficeAgentId: scout?.officeAgentId ?? hermes?.officeAgentId ?? "" };
      }
      return row;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function guessCommandLead(rows: TeamDraftRow[]): string {
  return rows.find((row) => row.name.toLowerCase().includes("hermes"))?.officeAgentId
    ?? rows.find((row) => row.selected)?.officeAgentId
    ?? rows[0]?.officeAgentId
    ?? "";
}

function buildTeamRequest(rows: TeamDraftRow[], commandAgentId: string, defaultRunConnectorId: string): MissionTeamBootstrapRequest {
  return {
    commandAgentId: commandAgentId || undefined,
    defaultRunConnectorId: defaultRunConnectorId || undefined,
    agents: rows
      .filter((row) => row.selected)
      .map((row) => ({
        officeAgentId: row.officeAgentId.trim(),
        connectorId: row.connectorId,
        externalId: row.externalId.trim(),
        name: row.name.trim(),
        role: row.role.trim(),
        emoji: row.emoji.trim() || undefined,
        type: "resident" as const,
        parentOfficeAgentId: row.parentOfficeAgentId.trim() || null,
      })),
  };
}

function TaskInspector(props: {
  detail: MissionTaskDetail | null;
  busyKey: string | null;
  onRun(taskId: string): Promise<void>;
}) {
  if (!props.detail) {
    return (
      <SectionCard title="Task details" subtitle="Select a task to see the brief, execution state, and recent updates.">
        <div className="app-empty">
          Pick a task from the board to inspect it.
        </div>
      </SectionCard>
    );
  }

  const { task, comments, events, artifacts } = props.detail;
  const isRunning = props.busyKey === `task:${task.id}:run`;

  return (
    <div className="space-y-4">
      <SectionCard
        title={task.title}
        subtitle={task.identifier}
        action={(
          <button
            className="mission-button"
            disabled={isRunning}
            onClick={() => {
              void props.onRun(task.id);
            }}
          >
            {isRunning ? "Submitting..." : "Submit run"}
          </button>
        )}
      >
        <div className="flex flex-wrap gap-2">
          <span className={cx("mission-badge border", taskWorkflowTone(task))}>{task.state.name}</span>
          {task.execution ? (
            <span className={cx("mission-badge border", taskAutomationTone(task))}>
              {task.execution.activeOwnerLabel ?? task.execution.connectorId} · {task.execution.status}
            </span>
          ) : (
            <span className="mission-badge">Not running</span>
          )}
          <span className="mission-badge">{task.assignee?.name ?? "Unassigned"}</span>
          <span className="mission-badge">{taskCycleLabel(task)}</span>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Priority" value={task.priority} tone={priorityTone(task)} />
          <MetricCard label="Comments" value={comments.length} />
          <MetricCard label="Updates" value={events.length} />
        </div>

        <div className="rounded-[18px] border border-linear-line bg-[#0c0e13] p-4">
          <div className="app-kicker">Brief</div>
          <div className="mt-3 text-sm leading-7 text-[#dbe0ea]">
            <MarkdownContent text={summarizeTaskDescription(task)} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Run timeline" subtitle="Mirrored provider updates for this task">
        <div className="space-y-2">
          {events.length === 0 ? (
            <div className="app-empty">No run events have been mirrored for this task yet.</div>
          ) : (
            events.slice(0, 8).map((event) => (
              <article key={event.id} className="app-list-row">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">{event.summary}</div>
                  <div className="mission-muted mt-1">
                    {event.actorLabel ?? event.kind} · {formatDateTime(event.createdAt)}
                  </div>
                </div>
                {event.status ? <span className={cx("mission-badge border", statusTone(event.status))}>{event.status}</span> : null}
              </article>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard title="Recent comments" subtitle="Latest discussion mirrored from Linear">
        <div className="space-y-2">
          {comments.length === 0 ? (
            <div className="app-empty">No comments yet.</div>
          ) : (
            comments.slice(-4).reverse().map((comment) => (
              <article key={comment.id} className="app-list-row">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{comment.authorName}</span>
                    <span className="mission-badge">{comment.source}</span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[#cfd4df]">
                    <MarkdownContent text={comment.body} />
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard title="Artifacts" subtitle="Useful provider outputs, links, or mirrored notes">
        <div className="space-y-2">
          {artifacts.length === 0 ? (
            <div className="app-empty">No artifacts have been mirrored yet.</div>
          ) : (
            artifacts.slice(0, 6).map((artifact) => (
              <article key={artifact.id} className="app-list-row">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{artifact.label}</span>
                    <span className="mission-badge">{artifact.kind}</span>
                  </div>
                  {artifact.body ? <p className="mission-muted mt-2 whitespace-pre-wrap">{artifact.body}</p> : null}
                  {artifact.url ? (
                    <a className="mt-2 inline-block text-sm text-[#9fb0ff] underline" href={artifact.url} target="_blank" rel="noreferrer">
                      Open link
                    </a>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function RecentRunDetail(props: { detail: MissionTaskDetail | null; activityLog: MissionControlState["activityLog"]; }) {
  const task = props.detail?.task;

  return (
    <div className="space-y-4">
      <SectionCard
        title={task?.execution ? `${task.identifier} · ${task.execution.activeOwnerLabel ?? task.execution.connectorId}` : "Select a run"}
        subtitle={task?.execution?.message ?? "Choose a recent run to inspect its timeline and mirrored activity."}
      >
        {!task?.execution ? (
          <div className="app-empty">No run selected yet.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard label="Status" value={task.execution.status} />
            <MetricCard label="Stage" value={task.execution.stage ?? "n/a"} />
            <MetricCard label="Updated" value={formatRelativeUpdate(task.execution.updatedAt)} />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Timeline" subtitle="Execution updates returned by the provider">
        <div className="space-y-2">
          {props.detail?.events.length ? (
            props.detail.events.slice(0, 10).map((event) => (
              <article key={event.id} className="app-list-row">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">{event.summary}</div>
                  <div className="mission-muted mt-1">
                    {event.actorLabel ?? event.kind} · {formatDateTime(event.createdAt)}
                  </div>
                </div>
                {event.status ? <span className={cx("mission-badge border", statusTone(event.status))}>{event.status}</span> : null}
              </article>
            ))
          ) : (
            <div className="app-empty">No provider events mirrored yet.</div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Live office activity" subtitle="Recent activity across the team">
        <ActivityFeed entries={props.activityLog} limit={10} />
      </SectionCard>
    </div>
  );
}

export function SetupView(props: { mission: MissionControlState; onAddIntegration(provider: string): Promise<void>; }) {
  const connectors = useMemo(() => props.mission.missionSnapshot.connectors, [props.mission.missionSnapshot.connectors]);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(connectors[0]?.id ?? null);

  useEffect(() => {
    if (!selectedConnectorId || !connectors.some((connector) => connector.id === selectedConnectorId)) {
      setSelectedConnectorId(connectors[0]?.id ?? null);
    }
  }, [connectors, selectedConnectorId]);

  const selectedConnector = connectors.find((connector) => connector.id === selectedConnectorId) ?? connectors[0] ?? null;
  const readyConnectors = connectors.filter((connector) => connector.enabled && connector.health.status === "ok").length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_420px]">
      <div className="space-y-5">
        <SectionCard title="Start with runtimes, not org charts" subtitle="Connect each runtime once, check that it is alive, then move to Team to decide who reports to whom.">
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Configured" value={connectors.length} />
            <MetricCard label="Healthy" value={readyConnectors} tone={readyConnectors > 0 ? "good" : "default"} />
            <MetricCard label="Detected runtimes" value={props.mission.missionSnapshot.providerAgents.length} />
            <MetricCard label="Task sync" value={props.mission.missionSnapshot.taskSync.state} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {[
              { provider: "hermes", label: "Add Hermes", hint: "Remote gateway or local CLI" },
              { provider: "claude-local", label: "Add Claude Code", hint: "Claude-powered local worker" },
              { provider: "codex-local", label: "Add Codex", hint: "OpenAI coding worker" },
            ].map((entry) => (
              <button
                key={entry.provider}
                className="app-tile-button"
                onClick={() => {
                  void props.onAddIntegration(entry.provider);
                }}
              >
                <span className="app-tile-title">{entry.label}</span>
                <span className="app-tile-copy">{entry.hint}</span>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Connected runtimes" subtitle="Pick one runtime to edit. This keeps setup manageable instead of showing every low-level field at once.">
          <div className="space-y-3">
            {connectors.length === 0 ? (
              <div className="app-empty">No runtimes added yet. Start by adding Hermes or another coding runtime above.</div>
            ) : (
              connectors.map((connector) => {
                const isSelected = selectedConnectorId === connector.id;
                return (
                  <button
                    key={connector.id}
                    className={cx("app-runtime-row", isSelected && "app-runtime-row--selected")}
                    onClick={() => setSelectedConnectorId(connector.id)}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{connector.label}</span>
                        <span className={cx("mission-badge border", connectorTone(connector.health.status))}>{connector.health.status}</span>
                      </div>
                      <p className="mission-muted mt-1">
                        {connector.health.message ?? "No connector message yet."}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mission-badge">{connector.provider}</span>
                      <span className="mission-badge">{connector.enabled ? "Enabled" : "Disabled"}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </SectionCard>

        {selectedConnector ? (
          <ConnectorSettingsCard
            connector={selectedConnector}
            hermesDefaults={props.mission.missionSnapshot.hermesDefaults}
            busyKey={props.mission.busyKey}
            onSave={(connectorId, input) => props.mission.saveConnector(connectorId, input)}
            onTest={(connectorId) => props.mission.testConnectorHealth(connectorId)}
            onSync={(connectorId) => props.mission.syncConnector(connectorId)}
            onRemove={(connectorId) => { void props.mission.removeConnector(connectorId); }}
          />
        ) : null}
      </div>

      <div className="space-y-5">
        <SectionCard title="How this works" subtitle="The product flow is now setup first, team second, work third.">
          <div className="space-y-3">
            <div className="app-step-row">
              <span className="app-step-number">1</span>
              <div>
                <div className="text-sm font-medium text-white">Connect Hermes, Claude, or Codex</div>
                <p className="mission-muted mt-1">Get the runtime healthy before worrying about roles or reporting lines.</p>
              </div>
            </div>
            <div className="app-step-row">
              <span className="app-step-number">2</span>
              <div>
                <div className="text-sm font-medium text-white">Sync or map the team</div>
                <p className="mission-muted mt-1">Use Team to decide which runtime becomes Hermes, Scout, Atlas, or Orbit.</p>
              </div>
            </div>
            <div className="app-step-row">
              <span className="app-step-number">3</span>
              <div>
                <div className="text-sm font-medium text-white">Run work and watch runs</div>
                <p className="mission-muted mt-1">Use Work to submit tasks, then Runs to observe recent execution and schedules.</p>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="What is ready right now" subtitle="A quick read on whether the onboarding path is unblocked.">
          <div className="space-y-3">
            <div className="app-status-row">
              <span className={cx("mission-badge border", readyConnectors > 0 ? "bg-emerald-500/15 text-emerald-200 border-emerald-400/25" : "bg-[#171a21] text-[#8d93a1] border-linear-line")}>
                {readyConnectors > 0 ? "Ready" : "Waiting"}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">Runtime connectivity</div>
                <p className="mission-muted mt-1">{readyConnectors} healthy runtime{readyConnectors === 1 ? "" : "s"} available.</p>
              </div>
            </div>
            <div className="app-status-row">
              <span className={cx("mission-badge border", props.mission.agents.length > 0 ? "bg-emerald-500/15 text-emerald-200 border-emerald-400/25" : "bg-[#171a21] text-[#8d93a1] border-linear-line")}>
                {props.mission.agents.length > 0 ? "Ready" : "Waiting"}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">Team mapping</div>
                <p className="mission-muted mt-1">{props.mission.agents.length} team member{props.mission.agents.length === 1 ? "" : "s"} currently linked.</p>
              </div>
            </div>
            <div className="app-status-row">
              <span className={cx("mission-badge border", props.mission.missionSnapshot.tasks.length > 0 ? "bg-emerald-500/15 text-emerald-200 border-emerald-400/25" : "bg-[#171a21] text-[#8d93a1] border-linear-line")}>
                {props.mission.missionSnapshot.tasks.length > 0 ? "Ready" : "Waiting"}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">Task intake</div>
                <p className="mission-muted mt-1">{props.mission.missionSnapshot.taskSync.message || "Linear task sync has not run yet."}</p>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export function TeamView(props: { mission: MissionControlState }) {
  const connectors = useMemo(
    () => props.mission.missionSnapshot.connectors.filter((connector) => connector.enabled),
    [props.mission.missionSnapshot.connectors],
  );
  const [rows, setRows] = useState<TeamDraftRow[]>([]);
  const [commandAgentId, setCommandAgentId] = useState("");
  const [defaultRunConnectorId, setDefaultRunConnectorId] = useState("");

  useEffect(() => {
    const nextRows = buildTeamDraft(connectors, props.mission.missionSnapshot.providerAgents, props.mission.agents);
    setRows(nextRows);
    const nextCommandAgentId = props.mission.missionSnapshot.teamSettings.commandAgentId || guessCommandLead(nextRows);
    setCommandAgentId(nextCommandAgentId);
    setDefaultRunConnectorId(
      props.mission.missionSnapshot.teamSettings.defaultRunConnectorId
      || nextRows.find((row) => row.officeAgentId === nextCommandAgentId)?.connectorId
      || nextRows[0]?.connectorId
      || "",
    );
  }, [connectors, props.mission.agents, props.mission.missionSnapshot.providerAgents, props.mission.missionSnapshot.teamSettings.commandAgentId, props.mission.missionSnapshot.teamSettings.defaultRunConnectorId]);

  const groupedRows = useMemo(() => {
    return connectors.map((connector) => ({
      connector,
      rows: rows.filter((row) => row.connectorId === connector.id),
    }));
  }, [connectors, rows]);

  const selectedRows = rows.filter((row) => row.selected);
  const saveDisabled = selectedRows.length === 0 || props.mission.busyKey === "team:bootstrap";
  const availableParents = selectedRows.map((row) => ({
    id: row.officeAgentId,
    name: row.name,
  }));

  function updateRow(key: string, patch: Partial<TeamDraftRow>): void {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function syncAll(): Promise<void> {
    for (const connector of connectors) {
      // Sequential keeps the UI state readable.
      // eslint-disable-next-line no-await-in-loop
      await props.mission.syncConnector(connector.id);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <SectionCard
          title="Turn runtimes into a visible org"
          subtitle="This is the Paperclip-style control-plane idea: your team lives here, even when the runtimes sit on different gateways."
          action={(
            <div className="flex flex-wrap gap-2">
              <button className="mission-button-muted" onClick={() => { void syncAll(); }}>
                Sync all runtimes
              </button>
              <button className="mission-button-muted" onClick={() => setRows((current) => applyRecommendedStructure(current))}>
                Apply recommended structure
              </button>
            </div>
          )}
        >
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Connected runtimes" value={connectors.length} />
            <MetricCard label="Detected people" value={rows.length} />
            <MetricCard label="Included in team" value={selectedRows.length} tone={selectedRows.length > 0 ? "good" : "default"} />
            <MetricCard label="Command lead" value={commandAgentId || "Not set"} />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
            <label className="space-y-2">
              <span className="app-field-label">Command lead</span>
              <select className="mission-input" value={commandAgentId} onChange={(event) => setCommandAgentId(event.target.value)}>
                <option value="">Select a lead</option>
                {selectedRows.map((row) => (
                  <option key={row.key} value={row.officeAgentId}>{row.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="app-field-label">Default run connector</span>
              <select className="mission-input" value={defaultRunConnectorId} onChange={(event) => setDefaultRunConnectorId(event.target.value)}>
                <option value="">Automatic</option>
                {connectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>{connector.label}</option>
                ))}
              </select>
            </label>
          </div>
        </SectionCard>

        {groupedRows.map(({ connector, rows: connectorRows }) => (
          <SectionCard
            key={connector.id}
            title={connector.label}
            subtitle={connector.health.message ?? "No connector message yet."}
            action={(
              <div className="flex items-center gap-2">
                <span className={cx("mission-badge border", connectorTone(connector.health.status))}>{connector.health.status}</span>
                <button className="mission-button-muted" onClick={() => { void props.mission.syncConnector(connector.id); }}>
                  Sync runtime
                </button>
              </div>
            )}
          >
            {connectorRows.length === 0 ? (
              <div className="app-empty">
                No runtime roster was discovered, so Team will still let you use this connector as a single team member.
              </div>
            ) : (
              <div className="space-y-3">
                {connectorRows.map((row) => (
                  <div key={row.key} className="rounded-[20px] border border-linear-line bg-[#0c0e13] p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                      <div className="flex min-w-0 flex-1 gap-3">
                        <label className="mt-1 inline-flex items-center">
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(event) => updateRow(row.key, { selected: event.target.checked })}
                          />
                        </label>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-linear-line bg-[#11141b] text-sm text-white">
                              {row.emoji || avatarLabel(row.name)}
                            </span>
                            <div>
                              <div className="text-sm font-medium text-white">{row.sourceLabel}</div>
                              <div className="mission-muted">{row.sourceKind === "provider" ? "Discovered from runtime" : "Built from connector"}</div>
                            </div>
                            <span className="mission-badge">{row.statusLabel}</span>
                          </div>

                          <div className="mt-4 grid gap-3 lg:grid-cols-2">
                            <label className="space-y-2">
                              <span className="app-field-label">Display name</span>
                              <input className="mission-input" value={row.name} onChange={(event) => updateRow(row.key, { name: event.target.value })} />
                            </label>
                            <label className="space-y-2">
                              <span className="app-field-label">Role</span>
                              <input className="mission-input" value={row.role} onChange={(event) => updateRow(row.key, { role: event.target.value })} />
                            </label>
                            <label className="space-y-2">
                              <span className="app-field-label">Team id</span>
                              <input className="mission-input" value={row.officeAgentId} onChange={(event) => updateRow(row.key, { officeAgentId: normalizeOfficeId(event.target.value) })} />
                            </label>
                            <label className="space-y-2">
                              <span className="app-field-label">Reports to</span>
                              <select className="mission-input" value={row.parentOfficeAgentId} onChange={(event) => updateRow(row.key, { parentOfficeAgentId: event.target.value })}>
                                <option value="">Top level</option>
                                {availableParents
                                  .filter((entry) => entry.id !== row.officeAgentId)
                                  .map((entry) => (
                                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                                  ))}
                              </select>
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        ))}

        <div className="sticky bottom-4 z-10 rounded-[22px] border border-[#222734] bg-[rgba(10,12,17,0.92)] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-medium text-white">Save the team structure</div>
              <p className="mission-muted mt-1">
                {selectedRows.length} runtime{selectedRows.length === 1 ? "" : "s"} will become visible team members.
              </p>
            </div>
            <button
              className="mission-button"
              disabled={saveDisabled}
              onClick={() => {
                void props.mission.bootstrapTeam(buildTeamRequest(rows, commandAgentId, defaultRunConnectorId));
              }}
            >
              {props.mission.busyKey === "team:bootstrap" ? "Saving..." : "Save team"}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <SectionCard title="Current org" subtitle="This is the visible team people will understand, regardless of where the runtimes are hosted.">
          <div className="space-y-2">
            {props.mission.agents.length === 0 ? (
              <div className="app-empty">No team members saved yet.</div>
            ) : (
              props.mission.agents.map((agent) => (
                <article key={agent.id} className="app-list-row">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-linear-line bg-[#11141b] text-xs text-white">
                        {agent.emoji || avatarLabel(agent.name)}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-white">{agent.name}</div>
                        <div className="mission-muted">{agent.role}</div>
                      </div>
                    </div>
                  </div>
                  <span className={cx("mission-badge border", statusTone(agent.status))}>{agent.status}</span>
                </article>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="Recommended structure" subtitle="A simple default that matches your four-gateway setup.">
          <div className="space-y-3 text-sm leading-6 text-[#d1d6e0]">
            <p><strong className="text-white">Hermes</strong> should be the command lead and default entrypoint.</p>
            <p><strong className="text-white">Scout</strong> should report to Hermes and act as lead engineer.</p>
            <p><strong className="text-white">Atlas</strong> and <strong className="text-white">Orbit</strong> should report to Scout and stay focused on their own work areas.</p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export function WorkView(props: { mission: MissionControlState }) {
  const [search, setSearch] = useState("");
  const normalized = search.trim().toLowerCase();
  const visibleTasks = props.mission.missionSnapshot.tasks
    .filter((task) => {
      if (!normalized) return true;
      return `${task.identifier} ${task.title} ${task.team.name} ${task.state.name}`.toLowerCase().includes(normalized);
    })
    .sort(compareMissionTasksForBoard);
  const columns = groupTasks(visibleTasks);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-5">
        <SectionCard title="Current work" subtitle="The synced Linear queue, grouped by the stage people actually care about.">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <input
              className="mission-input max-w-xl"
              placeholder="Search tasks, teams, or issue keys"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <span className="mission-badge">{visibleTasks.length} tasks</span>
              <span className="mission-badge">Linear active cycles</span>
            </div>
          </div>
        </SectionCard>

        <div className="grid gap-4 2xl:grid-cols-4 xl:grid-cols-2">
          {[
            { id: "todo", title: "Todo", tasks: columns.todo },
            { id: "in_progress", title: "In progress", tasks: columns.in_progress },
            { id: "review", title: "Review", tasks: columns.review },
            { id: "done", title: "Done", tasks: columns.done },
          ].map((column) => (
            <SectionCard key={column.id} title={column.title} subtitle={`${column.tasks.length} tasks`} className="min-h-[320px]">
              <div className="space-y-3">
                {column.tasks.length === 0 ? (
                  <div className="app-empty">No tasks in this lane.</div>
                ) : (
                  column.tasks.map((task) => (
                    <button
                      key={task.id}
                      className={cx("app-task-card", props.mission.selectedTaskId === task.id && "app-task-card--selected")}
                      onClick={() => props.mission.setSelectedTaskId(task.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ca4b4]">{task.identifier}</span>
                            <span className={cx("mission-badge border", taskWorkflowTone(task))}>{task.state.name}</span>
                          </div>
                          <div className="mt-2 text-sm font-medium leading-6 text-white">{task.title}</div>
                        </div>
                        <span className="text-[11px] text-[#737a88]">{formatRelativeStamp(task.updatedAt)}</span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="mission-badge">{task.assignee?.name ?? "Unassigned"}</span>
                        <span className="mission-badge">{taskCycleLabel(task)}</span>
                        {task.execution ? (
                          <span className={cx("mission-badge border", taskAutomationTone(task))}>{task.execution.status}</span>
                        ) : null}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </SectionCard>
          ))}
        </div>
      </div>

      <TaskInspector detail={props.mission.selectedTaskDetail} busyKey={props.mission.busyKey} onRun={props.mission.runTask} />
    </div>
  );
}

export function RunsView(props: { mission: MissionControlState }) {
  const recentTasks = [...props.mission.missionSnapshot.tasks]
    .filter((task) => task.execution)
    .sort((left, right) => (right.execution?.updatedAt ?? 0) - (left.execution?.updatedAt ?? 0));

  const queuedCount = recentTasks.filter((task) => task.execution?.status === "queued").length;
  const runningCount = recentTasks.filter((task) => task.execution?.status === "running").length;

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="space-y-5">
        <SectionCard title="Recent runs" subtitle="This is the new primary observation surface instead of the old mission map.">
          <div className="grid gap-3 grid-cols-3">
            <MetricCard label="Recent" value={recentTasks.length} />
            <MetricCard label="Queued" value={queuedCount} tone={queuedCount > 0 ? "warn" : "default"} />
            <MetricCard label="Running" value={runningCount} tone={runningCount > 0 ? "good" : "default"} />
          </div>
        </SectionCard>

        <SectionCard title="Run list" subtitle="Choose a task to inspect its execution trail.">
          <div className="space-y-2">
            {recentTasks.length === 0 ? (
              <div className="app-empty">No runs have been submitted yet. Use Work to start one.</div>
            ) : (
              recentTasks.map((task) => (
                <button
                  key={task.id}
                  className={cx("app-runtime-row", props.mission.selectedTaskId === task.id && "app-runtime-row--selected")}
                  onClick={() => props.mission.setSelectedTaskId(task.id)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{task.identifier}</span>
                      <span className={cx("mission-badge border", taskAutomationTone(task))}>{task.execution?.status}</span>
                    </div>
                    <div className="mt-1 text-sm text-[#cfd4df]">{task.title}</div>
                    <div className="mission-muted mt-1">
                      {task.execution?.activeOwnerLabel ?? task.execution?.connectorId} · {formatDateTime(task.execution?.updatedAt)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="Scheduled wakeups" subtitle="Your first version of heartbeat-style automation. Keep this simple at the start.">
          <div className="space-y-2">
            {props.mission.missionSnapshot.schedules.length === 0 ? (
              <div className="app-empty">No schedules imported yet.</div>
            ) : (
              props.mission.missionSnapshot.schedules.map((schedule) => (
                <article key={schedule.id} className="app-list-row">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">{schedule.name}</div>
                    <div className="mission-muted mt-1">{schedule.recurrence}</div>
                  </div>
                  <span className={cx("mission-badge border", statusTone(schedule.status))}>{schedule.status}</span>
                </article>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      <RecentRunDetail detail={props.mission.selectedTaskDetail} activityLog={props.mission.activityLog} />
    </div>
  );
}

export function SettingsView(props: { mission: MissionControlState }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <HermesDefaultsCard
          defaults={props.mission.missionSnapshot.hermesDefaults}
          busyKey={props.mission.busyKey}
          onSave={(input) => props.mission.saveHermesSharedDefaults(input)}
        />

        <SectionCard title="Imported schedules" subtitle="This is where cron-style wakeups live. Keep this advanced, not central to the onboarding flow.">
          <div className="space-y-2">
            {props.mission.missionSnapshot.schedules.length === 0 ? (
              <div className="app-empty">No schedules imported yet.</div>
            ) : (
              props.mission.missionSnapshot.schedules.map((schedule) => (
                <article key={schedule.id} className="app-list-row">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">{schedule.name}</div>
                    <div className="mission-muted mt-1">{schedule.recurrence}</div>
                  </div>
                  <div className="text-right">
                    <span className={cx("mission-badge border", statusTone(schedule.status))}>{schedule.status}</span>
                    <div className="mission-muted mt-1">{schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : "No next run"}</div>
                  </div>
                </article>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      <div className="space-y-5">
        <SectionCard title="Why settings is smaller now" subtitle="Most people should not have to live here.">
          <div className="space-y-3 text-sm leading-6 text-[#cfd4df]">
            <p>Connector creation lives in Setup.</p>
            <p>Org design lives in Team.</p>
            <p>Running tasks lives in Work.</p>
            <p>Watching execution lives in Runs.</p>
            <p>Settings stays for shared defaults and automation controls.</p>
          </div>
        </SectionCard>

        <SectionCard title="Runtime health" subtitle="Quick read-only diagnostics without dragging setup back into this screen.">
          <div className="space-y-2">
            {props.mission.missionSnapshot.connectors.map((connector) => (
              <article key={connector.id} className="app-list-row">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">{connector.label}</div>
                  <div className="mission-muted mt-1">{connector.health.message ?? "No message"}</div>
                </div>
                <span className={cx("mission-badge border", connectorTone(connector.health.status))}>{connector.health.status}</span>
              </article>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
