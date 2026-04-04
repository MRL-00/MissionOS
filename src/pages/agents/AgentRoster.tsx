import { useState } from "react";
import { SearchIcon, ChevronLeftIcon, ChevronRightIcon, FilterIcon, MoreHorizontalIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";

interface AgentRosterProps {
  mission: MissionControlState;
}

type EngineFilter = "all" | "OpenClaw" | "Claude" | "Codex" | "Hermes";
type StatusFilter = "all" | "Running" | "Active" | "Idle" | "Offline";

const MOCK_AGENTS = [
  { id: "1", name: "Pickle", uid: "PKL-001", role: "Orchestrator", engine: "OpenClaw", skills: ["Planning", "Delegation", "Strategy"], status: "Running" as const, lastRun: "2 min ago", avatar: "P" },
  { id: "2", name: "Zoe", uid: "ZOE-042", role: "QA Engineer", engine: "Codex", skills: ["Testing", "Validation", "Reports"], status: "Idle" as const, lastRun: "1h ago", avatar: "Z" },
  { id: "3", name: "Nexus", uid: "NXS-017", role: "Researcher", engine: "OpenClaw", skills: ["Analysis", "Web Search", "Synthesis"], status: "Active" as const, lastRun: "5 min ago", avatar: "N" },
  { id: "4", name: "Spectre", uid: "SPC-099", role: "Infiltration", engine: "Claude", skills: ["Stealth", "Recon", "Evasion"], status: "Offline" as const, lastRun: "3d ago", avatar: "S" },
];

const STATUS_DOT: Record<string, string> = {
  Running: "bg-emerald-400",
  Active: "bg-blue-400",
  Idle: "bg-yellow-400",
  Offline: "bg-red-400",
};

const ENGINE_BADGE: Record<string, string> = {
  OpenClaw: "border-[#5e4ae3]/30 bg-[#5e4ae3]/10 text-[#c6bfff]",
  Claude: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Codex: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  Hermes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

export function AgentRoster({ mission }: AgentRosterProps) {
  const [engineFilter, setEngineFilter] = useState<EngineFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const agents = MOCK_AGENTS.filter((a) => {
    if (engineFilter !== "all" && a.engine !== engineFilter) return false;
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col p-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Agent Roster</h1>
          <p className="mt-1 text-[13px] text-[#918f90]">{agents.length} agents registered</p>
        </div>
        <button className="rounded-lg bg-gradient-to-r from-[#c6bfff] to-[#5e4ae3] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90">
          + Add Agent
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-64 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3">
          <SearchIcon className="size-3.5 text-[#918f90]" />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-[#918f90]"
          />
        </div>
        <FilterDropdown label="Engine" value={engineFilter} options={["all", "OpenClaw", "Claude", "Codex", "Hermes"]} onChange={(v) => setEngineFilter(v as EngineFilter)} />
        <FilterDropdown label="Status" value={statusFilter} options={["all", "Running", "Active", "Idle", "Offline"]} onChange={(v) => setStatusFilter(v as StatusFilter)} />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-hidden rounded-xl border border-white/[0.06]">
        <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr_1fr_1fr_auto] gap-4 border-b border-white/[0.06] bg-[#1c1b1c] px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Agent</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Role</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Engine</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Skills</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Status</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Last Run</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Actions</span>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {agents.map((agent) => (
            <div key={agent.id} className="grid grid-cols-[2fr_1fr_1fr_1.5fr_1fr_1fr_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#c6bfff] to-[#5e4ae3] text-[12px] font-semibold text-white">
                  {agent.avatar}
                </div>
                <div>
                  <div className="text-[13px] font-medium text-white">{agent.name}</div>
                  <div className="text-[11px] text-[#918f90]">{agent.uid}</div>
                </div>
              </div>
              <span className="text-[13px] text-[#c8c4d7]">{agent.role}</span>
              <span className={cn("inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium", ENGINE_BADGE[agent.engine])}>
                {agent.engine}
              </span>
              <div className="flex flex-wrap gap-1">
                {agent.skills.map((s) => (
                  <span key={s} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#918f90]">{s}</span>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", STATUS_DOT[agent.status])} />
                <span className="text-[13px] text-[#c8c4d7]">{agent.status}</span>
              </div>
              <span className="text-[13px] text-[#918f90]">{agent.lastRun}</span>
              <button className="rounded-lg p-1.5 text-[#918f90] transition-colors hover:bg-white/[0.06] hover:text-white">
                <MoreHorizontalIcon className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] text-[#918f90]">Showing {agents.length} of {MOCK_AGENTS.length} agents</span>
        <div className="flex items-center gap-1">
          <button className="rounded-lg border border-white/[0.06] p-1.5 text-[#918f90] transition-colors hover:bg-white/[0.04]">
            <ChevronLeftIcon className="size-4" />
          </button>
          <button className="rounded-lg bg-[#5e4ae3]/20 px-3 py-1 text-[12px] font-medium text-[#c6bfff]">1</button>
          <button className="rounded-lg border border-white/[0.06] p-1.5 text-[#918f90] transition-colors hover:bg-white/[0.04]">
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="mt-3 flex items-center gap-6 rounded-lg border border-white/[0.06] bg-[#1c1b1c] px-4 py-2.5 text-[11px] text-[#918f90]">
        <span>System Latency: <strong className="text-emerald-400">12ms</strong></span>
        <span>Memory Load: <strong className="text-[#c8c4d7]">62%</strong></span>
        <span>Encryption: <strong className="text-[#c6bfff]">AES-256</strong></span>
        <span>Protocol: <strong className="text-[#c8c4d7]">WSS v2</strong></span>
      </div>
    </div>
  );
}

function FilterDropdown({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <FilterIcon className="size-3 text-[#918f90]" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/[0.06] bg-[#1c1b1c] px-2.5 py-1.5 text-[12px] text-[#c8c4d7] outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o === "all" ? `All ${label}s` : o}</option>
        ))}
      </select>
    </div>
  );
}
