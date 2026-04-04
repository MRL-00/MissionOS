import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, FilterIcon, ActivityIcon, ClockIcon, ZapIcon, CpuIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";

interface RunLogProps {
  mission: MissionControlState;
}

interface RunEntry {
  id: string;
  timestamp: string;
  agent: string;
  agentAvatar: string;
  mission: string;
  engine: string;
  status: "success" | "failed" | "running" | "warning";
  duration: string;
  expanded?: boolean;
  details?: { time: string; message: string; type: "system" | "tool" }[];
}

const STATUS_BADGE: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  failed: "bg-red-500/15 text-red-400 border-red-500/25",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  warning: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
};

const MOCK_RUNS: RunEntry[] = [
  {
    id: "1", timestamp: "14:32:08", agent: "Pickle", agentAvatar: "P", mission: "MOS-388", engine: "OpenClaw",
    status: "success", duration: "3:42",
    details: [
      { time: "14:32:08", message: "Initializing agent runtime...", type: "system" },
      { time: "14:32:10", message: "Tool call: read_file(src/app.tsx)", type: "tool" },
      { time: "14:35:48", message: "Task completed successfully", type: "system" },
    ],
  },
  {
    id: "2", timestamp: "14:28:15", agent: "Nexus", agentAvatar: "N", mission: "MOS-391", engine: "OpenClaw",
    status: "running", duration: "4:12",
    details: [
      { time: "14:28:15", message: "Starting analysis pipeline...", type: "system" },
      { time: "14:28:22", message: "Tool call: web_search(WebSocket patterns)", type: "tool" },
    ],
  },
  {
    id: "3", timestamp: "14:15:33", agent: "Zoe", agentAvatar: "Z", mission: "MOS-387", engine: "Codex",
    status: "success", duration: "2:58",
  },
  {
    id: "4", timestamp: "14:02:41", agent: "Spectre", agentAvatar: "S", mission: "MOS-385", engine: "Claude",
    status: "failed", duration: "1:15",
    details: [
      { time: "14:02:41", message: "Initializing stealth protocol...", type: "system" },
      { time: "14:03:56", message: "Error: Connection timeout after 75s", type: "system" },
    ],
  },
  {
    id: "5", timestamp: "13:48:20", agent: "Pickle", agentAvatar: "P", mission: "MOS-386", engine: "OpenClaw",
    status: "success", duration: "5:33",
  },
  {
    id: "6", timestamp: "13:22:07", agent: "Nexus", agentAvatar: "N", mission: "MOS-389", engine: "OpenClaw",
    status: "warning", duration: "8:12",
  },
];

export function RunLog({ mission }: RunLogProps) {
  const [expandedId, setExpandedId] = useState<string | null>("1");

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Stats */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          <RunStatCard icon={<ActivityIcon className="size-4" />} label="Total Runs" value="1,284" change="+12%" />
          <RunStatCard icon={<ZapIcon className="size-4" />} label="Success Rate" value="98.2%" subtitle="OPTIMAL" good />
          <RunStatCard icon={<ClockIcon className="size-4" />} label="Avg Duration" value="04:12" />
          <RunStatCard icon={<CpuIcon className="size-4" />} label="Active Engines" value="3" subtitle="GPT / CLD / MSR + 4" />
        </div>

        {/* Filters */}
        <div className="mb-4 flex items-center gap-3">
          <FilterSelect label="Agent" options={["All Systems", "Pickle", "Nexus", "Zoe", "Spectre"]} />
          <FilterSelect label="Engine" options={["All Engines", "OpenClaw", "Claude", "Codex", "Hermes"]} />
          <FilterSelect label="Status" options={["All Status", "Success", "Failed", "Running", "Warning"]} />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-white/[0.06]">
          {/* Header */}
          <div className="grid grid-cols-[100px_1.5fr_1.2fr_1fr_1fr_80px_40px] gap-4 border-b border-white/[0.06] bg-[#1c1b1c] px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Time</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Agent</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Mission/Issue</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Engine</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Status</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Duration</span>
            <span />
          </div>

          {/* Rows */}
          <div className="divide-y divide-white/[0.04]">
            {MOCK_RUNS.map((run) => (
              <div key={run.id}>
                <button
                  onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
                  className="grid w-full grid-cols-[100px_1.5fr_1.2fr_1fr_1fr_80px_40px] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <span className="font-mono text-[12px] text-[#918f90]">{run.timestamp}</span>
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-[#c6bfff] to-[#5e4ae3] text-[10px] font-semibold text-white">
                      {run.agentAvatar}
                    </div>
                    <span className="text-[13px] font-medium text-white">{run.agent}</span>
                  </div>
                  <span className="text-[13px] text-[#c8c4d7]">{run.mission}</span>
                  <span className="text-[13px] text-[#918f90]">{run.engine}</span>
                  <span className={cn("inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_BADGE[run.status])}>
                    {run.status}
                  </span>
                  <span className="font-mono text-[12px] text-[#c8c4d7]">{run.duration}</span>
                  <div className="flex justify-end text-[#918f90]">
                    {expandedId === run.id ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
                  </div>
                </button>

                {/* Expanded Details */}
                {expandedId === run.id && run.details && (
                  <div className="border-t border-white/[0.04] bg-[#0f0f10] px-6 py-3">
                    <div className="space-y-2">
                      {run.details.map((d, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <span className="mt-0.5 font-mono text-[11px] text-[#918f90]">{d.time}</span>
                          <span className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                            d.type === "tool" ? "bg-cyan-500/10 text-cyan-400" : "bg-white/[0.04] text-[#918f90]",
                          )}>
                            {d.type}
                          </span>
                          <span className="text-[12px] text-[#c8c4d7]">{d.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel - Engine Performance */}
      <div className="w-[300px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
        <h3 className="mb-4 text-[14px] font-semibold text-white">Engine Performance</h3>

        {/* Throughput */}
        <div className="mb-5 rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Real-time Throughput</div>
          <div className="text-2xl font-semibold text-white">4.2k <span className="text-[13px] text-[#918f90]">tokens/sec</span></div>
          <div className="mt-3 flex h-10 items-end gap-0.5">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-sm bg-[#5e4ae3]/60" style={{ height: `${Math.random() * 80 + 20}%` }} />
            ))}
          </div>
        </div>

        {/* Engine Load */}
        <div className="mb-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Engine Load</div>
          <div className="space-y-3">
            {[
              { name: "OpenClaw", load: 78, color: "bg-[#5e4ae3]" },
              { name: "Claude", load: 45, color: "bg-amber-500" },
              { name: "Codex", load: 32, color: "bg-cyan-500" },
              { name: "Hermes", load: 61, color: "bg-emerald-500" },
            ].map((e) => (
              <div key={e.name}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-[#c8c4d7]">{e.name}</span>
                  <span className="text-[#918f90]">{e.load}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className={cn("h-full rounded-full", e.color)} style={{ width: `${e.load}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Anomaly Alerts */}
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Anomaly Alerts</div>
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/[0.06] p-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-yellow-400" />
              <span className="text-[12px] font-medium text-yellow-300">Latency Spike</span>
            </div>
            <p className="mt-1 text-[11px] text-[#918f90]">Claude engine response time exceeded 2s threshold at 14:15</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunStatCard({ icon, label, value, change, subtitle, good }: { icon: React.ReactNode; label: string; value: string; change?: string; subtitle?: string; good?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
      <div className="mb-2 flex items-center gap-2 text-[#918f90]">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-white">{value}</div>
      {change && <div className="mt-0.5 text-[11px] text-emerald-400">{change}</div>}
      {subtitle && <div className={cn("mt-0.5 text-[11px]", good ? "text-emerald-400" : "text-[#918f90]")}>{subtitle}</div>}
    </div>
  );
}

function FilterSelect({ label, options }: { label: string; options: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <FilterIcon className="size-3 text-[#918f90]" />
      <select className="rounded-lg border border-white/[0.06] bg-[#1c1b1c] px-2.5 py-1.5 text-[12px] text-[#c8c4d7] outline-none">
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
