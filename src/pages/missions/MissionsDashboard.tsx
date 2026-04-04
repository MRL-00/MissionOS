import { PlusIcon, ClockIcon, UsersIcon, ActivityIcon, TrendingUpIcon, ChevronRightIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface MissionsDashboardProps {
  mission: MissionControlState;
}

const MOCK_MISSIONS = [
  {
    id: "1",
    name: "Operation Nightfall",
    status: "ACTIVE" as const,
    progress: 72,
    agents: 6,
    timeRemaining: "2d 14h",
    description: "Deep reconnaissance of target infrastructure",
  },
  {
    id: "2",
    name: "Project Sunrise",
    status: "ACTIVE" as const,
    progress: 45,
    agents: 4,
    timeRemaining: "5d 8h",
    description: "Automated deployment pipeline setup",
  },
  {
    id: "3",
    name: "Task Force Delta",
    status: "PLANNING" as const,
    progress: 15,
    agents: 8,
    timeRemaining: "7d 0h",
    description: "Multi-agent coordination protocol",
  },
  {
    id: "4",
    name: "Echo Protocol",
    status: "ACTIVE" as const,
    progress: 88,
    agents: 3,
    timeRemaining: "12h",
    description: "Signal processing and analysis",
  },
  {
    id: "5",
    name: "Vanguard Initiative",
    status: "COMPLETE" as const,
    progress: 100,
    agents: 5,
    timeRemaining: "—",
    description: "Security audit complete",
  },
];

const STATUS_COLORS = {
  ACTIVE: "bg-[#5e4ae3]/20 text-[#c6bfff] border-[#5e4ae3]/30",
  PLANNING: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  COMPLETE: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

const PROGRESS_COLORS = {
  ACTIVE: "bg-[#5e4ae3]",
  PLANNING: "bg-yellow-500",
  COMPLETE: "bg-emerald-500",
};

export function MissionsDashboard({ mission }: MissionsDashboardProps) {
  const [selectedMission, setSelectedMission] = useState<string | null>("1");
  const selected = MOCK_MISSIONS.find((m) => m.id === selectedMission);

  const taskCount = mission.missionSnapshot.tasks.length;
  const agentCount = mission.missionSnapshot.providerAgents.length;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Stats Row */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          <StatCard icon={<ActivityIcon className="size-4" />} label="Active Missions" value={taskCount || 12} accent />
          <StatCard icon={<UsersIcon className="size-4" />} label="Total Agents" value={agentCount || 48} subtitle="+4 this week" />
          <StatCard icon={<TrendingUpIcon className="size-4" />} label="System Uptime" value="99.9%" />
          <StatCard icon={<ClockIcon className="size-4" />} label="Success Rate" value="92%" />
        </div>

        {/* Mission Grid */}
        <div className="grid grid-cols-3 gap-4">
          {MOCK_MISSIONS.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedMission(m.id)}
              className={cn(
                "rounded-xl border p-4 text-left transition-all",
                selectedMission === m.id
                  ? "border-[#5e4ae3]/50 bg-[#5e4ae3]/[0.06]"
                  : "border-white/[0.06] bg-[#1c1b1c] hover:border-white/[0.1]",
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", STATUS_COLORS[m.status])}>
                  {m.status}
                </span>
                <span className="text-[12px] text-[#918f90]">{m.timeRemaining}</span>
              </div>
              <h3 className="text-[14px] font-semibold text-white">{m.name}</h3>
              <p className="mt-1 text-[12px] text-[#918f90]">{m.description}</p>
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-[#918f90]">Progress</span>
                  <span className="text-white">{m.progress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className={cn("h-full rounded-full transition-all", PROGRESS_COLORS[m.status])} style={{ width: `${m.progress}%` }} />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1">
                {Array.from({ length: Math.min(m.agents, 4) }).map((_, i) => (
                  <div key={i} className="size-6 rounded-full bg-gradient-to-br from-[#c6bfff]/60 to-[#5e4ae3]/60 ring-2 ring-[#1c1b1c]" style={{ marginLeft: i > 0 ? -6 : 0 }} />
                ))}
                {m.agents > 4 && <span className="ml-1 text-[11px] text-[#918f90]">+{m.agents - 4}</span>}
              </div>
            </button>
          ))}

          {/* New Mission Card */}
          <button className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-transparent p-4 text-[#918f90] transition-colors hover:border-[#5e4ae3]/40 hover:text-[#c6bfff]">
            <PlusIcon className="mb-2 size-6" />
            <span className="text-[13px] font-medium">New Mission</span>
          </button>
        </div>
      </div>

      {/* Detail Side Panel */}
      {selected && (
        <div className="w-[340px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-white">{selected.name}</h2>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", STATUS_COLORS[selected.status])}>
              {selected.status}
            </span>
          </div>
          <p className="mb-5 text-[13px] leading-relaxed text-[#918f90]">{selected.description}</p>

          {/* Progress */}
          <div className="mb-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Progress</div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className={cn("h-full rounded-full", PROGRESS_COLORS[selected.status])} style={{ width: `${selected.progress}%` }} />
            </div>
            <div className="mt-1 text-right text-[12px] text-white">{selected.progress}%</div>
          </div>

          {/* Milestones */}
          <div className="mb-5">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Milestones</div>
            <div className="space-y-2.5">
              <MilestoneItem label="Infrastructure Setup" status="completed" />
              <MilestoneItem label="Agent Deployment" status="active" />
              <MilestoneItem label="Data Collection" status="pending" />
              <MilestoneItem label="Analysis & Report" status="pending" />
            </div>
          </div>

          {/* Assigned Agents */}
          <div>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Assigned Agents</div>
            <div className="space-y-2">
              {["Pickle", "Nexus", "Scout-01"].map((name) => (
                <div key={name} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <div className="size-7 rounded-full bg-gradient-to-br from-[#c6bfff] to-[#5e4ae3]" />
                  <div>
                    <div className="text-[13px] font-medium text-white">{name}</div>
                    <div className="text-[11px] text-[#918f90]">Active</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button className="fixed bottom-6 right-6 z-20 flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-[#c6bfff] to-[#5e4ae3] shadow-lg shadow-[#5e4ae3]/25 transition-transform hover:scale-105">
        <PlusIcon className="size-5 text-white" />
      </button>
    </div>
  );
}

function StatCard({ icon, label, value, subtitle, accent }: { icon: React.ReactNode; label: string; value: string | number; subtitle?: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-4", accent ? "border-[#5e4ae3]/30 bg-[#5e4ae3]/[0.06]" : "border-white/[0.06] bg-[#1c1b1c]")}>
      <div className="mb-2 flex items-center gap-2 text-[#918f90]">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-white">{value}</div>
      {subtitle && <div className="mt-0.5 text-[11px] text-emerald-400">{subtitle}</div>}
    </div>
  );
}

function MilestoneItem({ label, status }: { label: string; status: "completed" | "active" | "pending" }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "size-2.5 rounded-full",
          status === "completed" ? "bg-emerald-400" : status === "active" ? "bg-[#5e4ae3]" : "bg-white/[0.1]",
        )}
      />
      <span className={cn("text-[13px]", status === "completed" ? "text-[#918f90] line-through" : status === "active" ? "text-white" : "text-[#918f90]")}>
        {label}
      </span>
      {status === "active" && <ChevronRightIcon className="ml-auto size-3.5 text-[#5e4ae3]" />}
    </div>
  );
}
