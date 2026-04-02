import { Suspense, lazy, startTransition } from "react";
import { compareMissionTasksForBoard } from "../mission/taskBoard";
import type { MissionControlState } from "../mission/hooks/useMissionControl";
import { isProviderAgentActivelyExecuting } from "../mission/providerAgents";
import { AgentChatPanel, AgentFormPanel, AgentListPanel, ConnectorSettingsCard, HermesDefaultsCard, ProviderRosterPanel, TaskDetailPanel } from "./panels";
import {
  ActivityFeed,
  HandoffCard,
  SectionCard,
  cx,
  formatClockTime,
  formatRelativeStamp,
  formatRelativeUpdate,
  statusTone,
  taskAccentColor,
  taskAutomationTone,
  taskCycleLabel,
  taskWorkflowTone,
} from "./shared";

const OrgChart = lazy(async () => {
  const module = await import("../mission/orgchart/OrgChart");
  return { default: module.OrgChart };
});

export function MissionView(props: { mission: MissionControlState }) {
  const { mission } = props;
  const selectedAgent = mission.agents.find((agent) => agent.id === mission.selectedAgentId) ?? null;
  const pendingHandoffs = mission.selectedTaskDetail?.handoffs.filter((handoff) => handoff.status === "pending") ?? [];

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

  return (
    <div className="grid flex-1 gap-3 xl:min-h-0 xl:grid-cols-[300px_minmax(0,1fr)_460px] 2xl:grid-cols-[320px_minmax(0,1fr)_540px]">
      <div className="flex min-h-0 flex-col overflow-hidden">
        <div className="mission-scroll flex min-h-0 flex-1 flex-col gap-3 pr-1">
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
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <SectionCard
          title="Command map"
          subtitle="Office agents, provider runtimes, and the current command topology."
          action={<span className="mission-badge">{activeExecutingAgentIds.size} actively executing</span>}
          className="flex-1 min-h-0 overflow-hidden"
        >
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
        </SectionCard>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden">
        <div className="mission-scroll flex min-h-0 flex-1 flex-col gap-3 pr-1">
          {selectedAgent ? (
            <AgentChatPanel
              agent={selectedAgent}
              messages={mission.agentMessages}
              activityLog={mission.activityLog}
              loading={mission.agentMessagesLoading}
              busyKey={mission.busyKey}
              onSend={(agentId, message) => mission.sendMessageToAgent(agentId, message)}
              onRefresh={(agentId) => mission.refreshAgentMessages(agentId)}
            />
          ) : (
            <SectionCard title="Selected agent" subtitle="No agent selected" className="min-h-[220px] shrink-0">
              <div className="rounded-xl border border-dashed border-linear-line px-4 py-12 text-center text-linear-muted">
                Select an agent from the roster or scene.
              </div>
            </SectionCard>
          )}

          <SectionCard title="Activity feed" subtitle="Live agent messages, spawns, and status changes" className="min-h-[180px] shrink-0 overflow-hidden">
            <div className="mission-scroll max-h-[320px] flex-1 pr-1">
              <ActivityFeed entries={mission.activityLog} limit={40} />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

export function TasksView(props: {
  mission: MissionControlState;
  taskSearch: string;
  filterText: string;
  onTaskSearchChange(value: string): void;
}) {
  const { mission, filterText, taskSearch } = props;
  const needle = filterText.trim().toLowerCase();
  const visibleTasks = mission.missionSnapshot.tasks
    .filter((task) => (!needle
      ? true
      : `${task.identifier} ${task.title} ${task.team.name} ${task.state.name}`.toLowerCase().includes(needle)))
    .sort(compareMissionTasksForBoard);
  const agentNames = mission.agents.map((agent) => agent.name);

  return (
    <div className="grid flex-1 gap-3 xl:min-h-0 xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,390px)_minmax(0,1fr)]">
      <SectionCard title="Current cycle" subtitle="Only issues in currently active Linear cycles are synced." className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-linear-line pb-3">
          <input
            className="mission-input"
            placeholder="Search issues, teams, or keys"
            value={taskSearch}
            onChange={(event) => props.onTaskSearchChange(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="mission-badge">{visibleTasks.length} issues</span>
            <span className="mission-badge">Active cycle only</span>
          </div>
        </div>
        <div className="mission-issue-list mt-1 flex-1 space-y-2">
          {visibleTasks.length === 0 ? (
            <div className="px-4 py-6 text-sm text-linear-muted">No tasks matched the current active cycle filter.</div>
          ) : (
            visibleTasks.map((task) => (
              <button
                key={task.id}
                className={cx("mission-task-card", mission.selectedTaskId === task.id ? "mission-task-card--selected" : "")}
                onClick={() => {
                  startTransition(() => {
                    mission.setSelectedTaskId(task.id);
                  });
                }}
              >
                <div className="mission-task-card-accent" style={{ background: taskAccentColor(task) }} />
                <div className="mission-task-card-body">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="mission-issue-key">{task.identifier}</span>
                      <span className="mission-muted truncate">{task.team.key ?? task.team.name}</span>
                    </div>
                    <span className="shrink-0 text-[11px] text-linear-muted">{formatRelativeStamp(task.updatedAt)}</span>
                  </div>
                  <div className="mission-clamp-2 mission-wrap mt-1.5 text-[13px] font-medium leading-[1.4] text-white">{task.title}</div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className={cx("mission-badge border", taskWorkflowTone(task))}>{task.state.name}</span>
                    {task.automation ? (
                      <span className={cx("mission-badge border", taskAutomationTone(task))}>
                        {task.automation.ownerAgentName ?? "workflow"} · {task.automation.status}
                      </span>
                    ) : null}
                    <span className="mission-task-chip">{task.assignee?.name ?? "Unassigned"}</span>
                    <span className="mission-task-chip">{taskCycleLabel(task)}</span>
                  </div>
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
        onComment={(taskId, input) => mission.addComment(taskId, input)}
        onHandoff={async (taskId, note, toAgentName) => {
          await mission.createHandoff(taskId, { note, toAgentName });
        }}
        onRun={(taskId) => mission.runTaskWorkflow(taskId)}
        onRespond={(handoffId, taskId, status) => mission.respondToHandoff(handoffId, { status }, taskId)}
      />
    </div>
  );
}

export function SchedulesView(props: { mission: MissionControlState }) {
  return (
    <SectionCard title="Schedules" subtitle="All provider-imported cron and scheduled jobs">
      <div className="grid gap-3">
        {props.mission.missionSnapshot.schedules.map((schedule) => (
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
  );
}

export function SettingsView(props: { mission: MissionControlState }) {
  const enabledConnectors = props.mission.missionSnapshot.connectors.filter((connector) => connector.enabled);
  const hermesConnectors = props.mission.missionSnapshot.connectors.filter((connector) => connector.provider === "hermes");

  return (
    <div className="grid flex-1 gap-5 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="mission-scroll space-y-5">
        {hermesConnectors.length > 0 ? (
          <HermesDefaultsCard
            defaults={props.mission.missionSnapshot.hermesDefaults}
            busyKey={props.mission.busyKey}
            onSave={(input) => props.mission.saveHermesSharedDefaults(input)}
          />
        ) : null}
        {enabledConnectors.length === 0 ? (
          <SectionCard title="No integrations configured" subtitle="Add an integration to connect your AI agents to Mission Control.">
            <p className="text-sm text-linear-muted">Click "+ Add integration" in the header to get started.</p>
          </SectionCard>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {enabledConnectors.map((connector) => (
              <ConnectorSettingsCard
                key={connector.id}
                connector={connector}
                hermesDefaults={props.mission.missionSnapshot.hermesDefaults}
                busyKey={props.mission.busyKey}
                onSave={(connectorId, input) => props.mission.saveConnector(connectorId, input)}
                onTest={(connectorId) => props.mission.testConnectorHealth(connectorId)}
                onSync={(connectorId) => props.mission.syncConnector(connectorId)}
                onRemove={(connectorId) => { void props.mission.removeConnector(connectorId); }}
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
            agents={props.mission.missionSnapshot.providerAgents}
          />
        ) : null}
      </div>
    </div>
  );
}

export function AgentsView(props: {
  mission: MissionControlState;
  editingAgentId: string | null;
  agentFormMode: "create" | "edit";
  onEditAgent(agentId: string): void;
  onCreateAgent(): void;
  onResetForm(): void;
}) {
  return (
    <div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <AgentListPanel
        agents={props.mission.agents}
        selectedAgentId={props.editingAgentId}
        busyKey={props.mission.busyKey}
        onSelect={props.onEditAgent}
        onCreate={props.onCreateAgent}
        onDelete={(agentId) => props.mission.removeAgent(agentId)}
      />
      <AgentFormPanel
        mode={props.agentFormMode}
        initial={props.editingAgentId ? props.mission.agents.find((agent) => agent.id === props.editingAgentId) ?? null : null}
        agents={props.mission.agents}
        providerAgents={props.mission.missionSnapshot.providerAgents}
        connectors={props.mission.missionSnapshot.connectors}
        busyKey={props.mission.busyKey}
        onSave={async (input) => {
          if (props.agentFormMode === "edit" && props.editingAgentId) {
            await props.mission.editAgent(props.editingAgentId, input);
          } else {
            await props.mission.createAgent(input);
          }
          props.onResetForm();
        }}
        onCancel={props.onResetForm}
      />
    </div>
  );
}
