import { useMissionControl } from "./mission/hooks/useMissionControl";
import { Layout } from "./layout/Layout";
import { LandingPage } from "./pages/landing/LandingPage";
import { MissionsDashboard } from "./pages/missions/MissionsDashboard";
import { AgentRoster } from "./pages/agents/AgentRoster";
import { OrgChartPage } from "./pages/orgchart/OrgChartPage";
import { IssuesBoard } from "./pages/issues/IssuesBoard";
import { RunLog } from "./pages/runs/RunLog";
import { SchedulesPage } from "./pages/schedules/SchedulesPage";
import { AgentOnboarding } from "./pages/onboarding/AgentOnboarding";
import { Settings } from "./pages/settings/Settings";
import { SetupAccountPage } from "./pages/setup/SetupAccountPage";
import { LoginPage } from "./pages/setup/LoginPage";
import { ProjectSetupPage } from "./pages/setup/ProjectSetupPage";
import { DocsPage } from "./pages/docs/DocsPage";
import { HelpPage } from "./pages/help/HelpPage";
import { SearchPage } from "./pages/search/SearchPage";

export function App() {
  const mission = useMissionControl();

  if (mission.loading && !mission.bootstrap) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f0f10] text-white">
        <div className="rounded-xl border border-white/[0.06] bg-[#131314] px-6 py-4 text-[13px] text-[#c8c4d7]">
          Booting MissionOS...
        </div>
      </div>
    );
  }

  if (mission.activeView === "landing") {
    return <LandingPage mission={mission} />;
  }

  if (mission.activeView === "setup") {
    return <SetupAccountPage mission={mission} />;
  }

  if (mission.activeView === "login") {
    return <LoginPage mission={mission} />;
  }

  if (mission.activeView === "project-setup") {
    return <ProjectSetupPage mission={mission} />;
  }

  if (mission.activeView === "onboarding") {
    return <AgentOnboarding mission={mission} />;
  }

  return (
    <Layout
      activeView={mission.activeView}
      connectionState={mission.connectionState}
      onNavigate={mission.setActiveView}
      mission={mission}
    >
      {mission.activeView === "missions" && <MissionsDashboard mission={mission} />}
      {mission.activeView === "agents" && <AgentRoster mission={mission} />}
      {mission.activeView === "orgchart" && <OrgChartPage mission={mission} />}
      {mission.activeView === "issues" && <IssuesBoard mission={mission} />}
      {mission.activeView === "runs" && <RunLog mission={mission} />}
      {mission.activeView === "schedules" && <SchedulesPage mission={mission} />}
      {mission.activeView === "settings" && <Settings mission={mission} />}
      {mission.activeView === "docs" && <DocsPage mission={mission} />}
      {mission.activeView === "help" && <HelpPage mission={mission} />}
      {mission.activeView === "search" && <SearchPage mission={mission} />}
    </Layout>
  );
}
