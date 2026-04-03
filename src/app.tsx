import { startTransition } from "react";
import { DEPLOY_BADGE_LABEL } from "./config/buildInfo";
import { useMissionControl, type MissionView } from "./mission/hooks/useMissionControl";
import { RunsView, SettingsView, SetupView, TeamView, WorkView } from "./app/views";
import { connectionTone, cx, formatRelativeUpdate } from "./app/shared";

const NAV_ITEMS: Array<{ id: MissionView; label: string; hint: string }> = [
  { id: "setup", label: "Setup", hint: "Connect runtimes" },
  { id: "team", label: "Team", hint: "Build the org" },
  { id: "work", label: "Work", hint: "Run tasks" },
  { id: "runs", label: "Runs", hint: "See activity" },
  { id: "settings", label: "Settings", hint: "Advanced" },
];

const VIEW_META: Record<MissionView, { title: string; subtitle: string }> = {
  setup: {
    title: "Bring your runtimes online",
    subtitle: "Connect Hermes, Claude, or Codex first. Then turn them into a visible team.",
  },
  team: {
    title: "Design the team",
    subtitle: "Map your runtimes to real roles, reporting lines, and the default execution path.",
  },
  work: {
    title: "Assign and run work",
    subtitle: "Review synced Linear tasks, pick what matters, and submit runs to the team.",
  },
  runs: {
    title: "Watch the team work",
    subtitle: "See live runs, recent execution history, wakeups, and mirrored provider activity.",
  },
  settings: {
    title: "Advanced settings",
    subtitle: "Shared defaults, runtime wakeups, and the lower-level controls most people should rarely touch.",
  },
};

function onboardingProgress(activeView: MissionView): string {
  switch (activeView) {
    case "setup":
      return "Step 1 of 4";
    case "team":
      return "Step 2 of 4";
    case "work":
      return "Step 3 of 4";
    case "runs":
    case "settings":
      return "Operate";
    default:
      return "";
  }
}

export function App() {
  const mission = useMissionControl();
  const current = VIEW_META[mission.activeView];

  async function handleAddIntegration(provider: string): Promise<void> {
    const defaultLabel = provider === "hermes"
      ? "Hermes"
      : provider === "claude-local"
        ? "Claude Code"
        : provider === "codex-local"
          ? "Codex"
          : provider;
    await mission.addConnector(provider, defaultLabel);
  }

  return (
    <div className="mission-shell">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="border-b border-linear-line bg-[#08090d]/98 lg:min-h-screen lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col px-4 py-5">
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#8d93a1]">The Office</p>
                <h1 className="mt-2 text-[32px] font-semibold leading-[0.95] tracking-[-0.045em] text-white">
                  Agent
                  <br />
                  Teams
                </h1>
              </div>

              <div className="space-y-2 rounded-[22px] border border-[#171a21] bg-[#0d0f14] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className={cx("mission-badge border", connectionTone(mission.connectionState))}>
                    {mission.connectionState}
                  </span>
                  <span className="mission-badge">Build {DEPLOY_BADGE_LABEL}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="app-stat">
                    <span className="app-stat-label">Connectors</span>
                    <strong className="app-stat-value">{mission.missionSnapshot.connectors.length}</strong>
                  </div>
                  <div className="app-stat">
                    <span className="app-stat-label">Team</span>
                    <strong className="app-stat-value">{mission.agents.length}</strong>
                  </div>
                  <div className="app-stat">
                    <span className="app-stat-label">Tasks</span>
                    <strong className="app-stat-value">{mission.missionSnapshot.tasks.length}</strong>
                  </div>
                  <div className="app-stat">
                    <span className="app-stat-label">Schedules</span>
                    <strong className="app-stat-value">{mission.missionSnapshot.schedules.length}</strong>
                  </div>
                </div>
              </div>
            </div>

            <nav className="mt-8 space-y-1.5">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={cx("app-nav-link", mission.activeView === item.id && "app-nav-link--active")}
                  onClick={() => {
                    startTransition(() => {
                      mission.setActiveView(item.id);
                    });
                  }}
                >
                  <span className="app-nav-label">{item.label}</span>
                  <span className="app-nav-hint">{item.hint}</span>
                </button>
              ))}
            </nav>

            <div className="mt-auto rounded-[22px] border border-[#171a21] bg-[#0d0f14] p-4">
              <div className="app-kicker">Status</div>
              <p className="mt-2 text-sm leading-6 text-[#d8dce5]">
                {mission.missionSnapshot.taskSync.message || formatRelativeUpdate(mission.missionSnapshot.taskSync.updatedAt)}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="mission-badge">Task sync {mission.missionSnapshot.taskSync.state}</span>
                <span className="mission-badge">{onboardingProgress(mission.activeView)}</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-screen flex-col bg-transparent">
          <header className="sticky top-0 z-10 border-b border-linear-line bg-[rgba(6,7,10,0.82)] px-4 py-4 backdrop-blur xl:px-8">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="app-kicker">{onboardingProgress(mission.activeView)}</div>
                <h2 className="mt-2 text-[32px] font-semibold tracking-[-0.045em] text-white">{current.title}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[#9ea4b2]">{current.subtitle}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="mission-badge">{mission.missionSnapshot.taskSync.state}</span>
                <span className="mission-badge">{mission.missionSnapshot.providerAgents.length} detected runtimes</span>
                <button className="mission-button-muted" onClick={() => void mission.refreshMission()}>
                  Refresh snapshot
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 px-4 py-5 xl:px-8 xl:py-6">
            {mission.error && mission.connectionState !== "connecting" ? (
              <div className="mb-4 rounded-[18px] border border-[#5b1f25] bg-[#1a0d11] px-4 py-3 text-sm font-medium text-[#ff9aa6]">
                {mission.error}
              </div>
            ) : null}

            {mission.activeView === "setup" ? <SetupView mission={mission} onAddIntegration={handleAddIntegration} /> : null}
            {mission.activeView === "team" ? <TeamView mission={mission} /> : null}
            {mission.activeView === "work" ? <WorkView mission={mission} /> : null}
            {mission.activeView === "runs" ? <RunsView mission={mission} /> : null}
            {mission.activeView === "settings" ? <SettingsView mission={mission} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
