import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import { DEPLOY_BADGE_LABEL } from "./config/buildInfo";
import { useMissionControl, type MissionView } from "./mission/hooks/useMissionControl";
import { AgentsView, MissionView as MissionDashboardView, SchedulesView, SettingsView, TasksView } from "./app/views";
import { avatarLabel, connectionTone, cx, formatRelativeUpdate } from "./app/shared";

const NAV_ITEMS: Array<{ id: MissionView; label: string }> = [
  { id: "mission", label: "Mission Control" },
  { id: "tasks", label: "Tasks" },
  { id: "schedules", label: "Schedules" },
  { id: "agents", label: "Agents" },
  { id: "settings", label: "Settings" },
];

const INTEGRATION_OPTIONS = [
  { provider: "hermes", label: "Hermes", description: "Local or remote Hermes CLI agents" },
  { provider: "claude-local", label: "Claude Code", description: "Local Claude Code CLI" },
  { provider: "codex-local", label: "Codex", description: "Local Codex CLI" },
] as const;

function appTitle(view: MissionView): string {
  switch (view) {
    case "mission":
      return "Hermes Mission Control";
    case "schedules":
      return "Schedules";
    case "agents":
      return "Agents";
    case "settings":
      return "Connector Settings";
    case "tasks":
    default:
      return "Tasks";
  }
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

  useEffect(() => {
    if (!addIntegrationOpen) {
      return;
    }

    function handleClick(event: MouseEvent): void {
      if (addIntegrationRef.current && !addIntegrationRef.current.contains(event.target as Node)) {
        setAddIntegrationOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [addIntegrationOpen]);

  async function handleAddIntegration(provider: string): Promise<void> {
    setAddIntegrationOpen(false);
    const label = window.prompt(
      `Name for this ${INTEGRATION_OPTIONS.find((option) => option.provider === provider)?.label ?? provider} integration:`,
    );
    if (!label) {
      return;
    }
    await mission.addConnector(provider, label);
  }

  function resetAgentForm(): void {
    setEditingAgentId(null);
    setAgentFormMode("create");
  }

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
              {mission.agents.length} linked office agent{mission.agents.length === 1 ? "" : "s"}
              {mission.missionSnapshot.rosterImport.staged ? ` · ${mission.missionSnapshot.rosterImport.staged} staged` : ""}
            </p>
            <div className="mission-scroll mt-2 flex-1 pr-1">
              {mission.agents.map((agent) => (
                <button
                  key={agent.id}
                  className={cx("mission-sidebar-agent", mission.selectedAgentId === agent.id ? "mission-sidebar-agent--selected" : "")}
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
                    <span className="mission-badge border border-linear-lineStrong">{agent.status}</span>
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
                  <span className="text-linear-muted">&gt;</span>
                  <span className="truncate font-medium text-white">Task Board</span>
                </div>
                <p className="mission-muted mt-1.5">
                  {mission.missionSnapshot.taskSync.message || formatRelativeUpdate(mission.missionSnapshot.taskSync.updatedAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mission-badge">Sync {mission.missionSnapshot.taskSync.state}</span>
                <button className="mission-button-muted" onClick={() => void mission.refreshMission()}>
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
                <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-white">{appTitle(mission.activeView)}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="mission-button-muted" onClick={() => void mission.refreshMission()}>
                  Refresh snapshot
                </button>
                {mission.activeView === "settings" ? (
                  <div className="relative" ref={addIntegrationRef}>
                    <button className="mission-button" onClick={() => setAddIntegrationOpen((open) => !open)}>
                      + Add integration
                    </button>
                    {addIntegrationOpen ? (
                      <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-linear-line bg-linear-surface shadow-lg">
                        {INTEGRATION_OPTIONS.map((option) => (
                          <button
                            key={option.provider}
                            className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition first:rounded-t-xl last:rounded-b-xl hover:bg-linear-surfaceHover"
                            onClick={() => { void handleAddIntegration(option.provider); }}
                          >
                            <span className="text-[13px] font-medium text-white">{option.label}</span>
                            <span className="text-[11px] text-linear-muted">{option.description}</span>
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

          {mission.activeView === "mission" ? <MissionDashboardView mission={mission} /> : null}
          {mission.activeView === "tasks" ? (
            <TasksView
              mission={mission}
              taskSearch={taskSearch}
              filterText={deferredTaskSearch}
              onTaskSearchChange={setTaskSearch}
            />
          ) : null}
          {mission.activeView === "schedules" ? <SchedulesView mission={mission} /> : null}
          {mission.activeView === "settings" ? <SettingsView mission={mission} /> : null}
          {mission.activeView === "agents" ? (
            <AgentsView
              mission={mission}
              editingAgentId={editingAgentId}
              agentFormMode={agentFormMode}
              onEditAgent={(agentId) => {
                setEditingAgentId(agentId);
                setAgentFormMode("edit");
              }}
              onCreateAgent={() => {
                setEditingAgentId(null);
                setAgentFormMode("create");
              }}
              onResetForm={resetAgentForm}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
