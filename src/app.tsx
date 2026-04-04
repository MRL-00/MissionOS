import { useMissionControl } from "./mission/hooks/useMissionControl";
import { Layout } from "./layout/Layout";
import { MissionsDashboard } from "./pages/missions/MissionsDashboard";
import { AgentRoster } from "./pages/agents/AgentRoster";
import { OrgChartPage } from "./pages/orgchart/OrgChartPage";
import { IssuesBoard } from "./pages/issues/IssuesBoard";
import { RunLog } from "./pages/runs/RunLog";
import { AgentOnboarding } from "./pages/onboarding/AgentOnboarding";
import { Settings } from "./pages/settings/Settings";

export function App() {
  const mission = useMissionControl();

  return (
    <Layout
      activeView={mission.activeView}
      connectionState={mission.connectionState}
      onNavigate={mission.setActiveView}
    >
      {mission.activeView === "missions" && <MissionsDashboard mission={mission} />}
      {mission.activeView === "agents" && <AgentRoster mission={mission} />}
      {mission.activeView === "orgchart" && <OrgChartPage mission={mission} />}
      {mission.activeView === "issues" && <IssuesBoard mission={mission} />}
      {mission.activeView === "runs" && <RunLog mission={mission} />}
      {mission.activeView === "onboarding" && <AgentOnboarding mission={mission} />}
      {mission.activeView === "settings" && <Settings mission={mission} />}
    </Layout>
  );
}
