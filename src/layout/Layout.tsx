import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import type { MissionView } from "@/mission/navigation";

interface LayoutProps {
  activeView: MissionView;
  connectionState: "connecting" | "connected" | "offline";
  onNavigate: (view: MissionView) => void;
  mission: MissionControlState;
  children: ReactNode;
}

export function Layout({ activeView, connectionState, onNavigate, mission, children }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#0f0f10] text-[#e5e2e3]">
      <Sidebar activeView={activeView} onNavigate={onNavigate} showOnboarding={!mission.bootstrap?.hasAgents} projectLogo={mission.settingsMap.project_logo} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav connectionState={connectionState} mission={mission} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
