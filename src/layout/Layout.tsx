import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import type { MissionView } from "@/mission/hooks/useMissionControl";

interface LayoutProps {
  activeView: MissionView;
  connectionState: "connecting" | "connected" | "offline";
  onNavigate: (view: MissionView) => void;
  children: ReactNode;
}

export function Layout({ activeView, connectionState, onNavigate, children }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#0f0f10] text-[#e5e2e3]">
      <Sidebar activeView={activeView} onNavigate={onNavigate} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav connectionState={connectionState} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
