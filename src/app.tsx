import { lazy, Suspense } from "react";
import { useMissionControl } from "./mission/hooks/useMissionControl";
import { Layout } from "./layout/Layout";

const LandingPage = lazy(() => import("./pages/landing/LandingPage").then((module) => ({ default: module.LandingPage })));
const MissionsDashboard = lazy(() =>
  import("./pages/missions/MissionsDashboard").then((module) => ({ default: module.MissionsDashboard })),
);
const AgentRoster = lazy(() => import("./pages/agents/AgentRoster").then((module) => ({ default: module.AgentRoster })));
const OrgChartPage = lazy(() => import("./pages/orgchart/OrgChartPage").then((module) => ({ default: module.OrgChartPage })));
const IssuesBoard = lazy(() => import("./pages/issues/IssuesBoard").then((module) => ({ default: module.IssuesBoard })));
const RunLog = lazy(() => import("./pages/runs/RunLog").then((module) => ({ default: module.RunLog })));
const SchedulesPage = lazy(() => import("./pages/schedules/SchedulesPage").then((module) => ({ default: module.SchedulesPage })));
const AgentOnboarding = lazy(() =>
  import("./pages/onboarding/AgentOnboarding").then((module) => ({ default: module.AgentOnboarding })),
);
const Settings = lazy(() => import("./pages/settings/Settings").then((module) => ({ default: module.Settings })));
const SetupAccountPage = lazy(() =>
  import("./pages/setup/SetupAccountPage").then((module) => ({ default: module.SetupAccountPage })),
);
const LoginPage = lazy(() => import("./pages/setup/LoginPage").then((module) => ({ default: module.LoginPage })));
const ProjectSetupPage = lazy(() =>
  import("./pages/setup/ProjectSetupPage").then((module) => ({ default: module.ProjectSetupPage })),
);
const DocsPage = lazy(() => import("./pages/docs/DocsPage").then((module) => ({ default: module.DocsPage })));
const HelpPage = lazy(() => import("./pages/help/HelpPage").then((module) => ({ default: module.HelpPage })));
const SearchPage = lazy(() => import("./pages/search/SearchPage").then((module) => ({ default: module.SearchPage })));

function ViewLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f0f10] text-white">
      <div className="rounded-xl border border-white/[0.06] bg-[#131314] px-6 py-4 text-[13px] text-[#c8c4d7]">
        Loading view...
      </div>
    </div>
  );
}

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
    return (
      <Suspense fallback={<ViewLoading />}>
        <LandingPage mission={mission} />
      </Suspense>
    );
  }

  if (mission.activeView === "setup") {
    return (
      <Suspense fallback={<ViewLoading />}>
        <SetupAccountPage mission={mission} />
      </Suspense>
    );
  }

  if (mission.activeView === "login") {
    return (
      <Suspense fallback={<ViewLoading />}>
        <LoginPage mission={mission} />
      </Suspense>
    );
  }

  if (mission.activeView === "project-setup") {
    return (
      <Suspense fallback={<ViewLoading />}>
        <ProjectSetupPage mission={mission} />
      </Suspense>
    );
  }

  if (mission.activeView === "onboarding") {
    return (
      <Suspense fallback={<ViewLoading />}>
        <AgentOnboarding mission={mission} />
      </Suspense>
    );
  }

  return (
    <Layout
      activeView={mission.activeView}
      connectionState={mission.connectionState}
      onNavigate={mission.setActiveView}
      mission={mission}
    >
      <Suspense fallback={<ViewLoading />}>
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
      </Suspense>
    </Layout>
  );
}
