import { useEffect, useMemo, useState } from "react";
import { ActivityIcon, ChevronDownIcon, ChevronUpIcon, ClockIcon, CpuIcon, ExternalLinkIcon, FilterIcon, GitBranchIcon, GitPullRequestIcon, LayersIcon, Trash2Icon, ZapIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";
import { estimateRunUsage, formatMoneyFromUsd, formatTokenCount } from "@/lib/usageEstimates";
import { formatDateTime } from "@/lib/dateFormat";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface RunLogProps {
  mission: MissionControlState;
}

const STATUS_BADGE: Record<string, string> = {
  complete: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  failed: "bg-red-500/15 text-red-400 border-red-500/25",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  planning: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
};

function formatDuration(run: MissionControlState["runs"][number]) {
  if (run.duration_ms) {
    const seconds = Math.floor(run.duration_ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return "—";
}

export function RunLog({ mission }: RunLogProps) {
  const [agentFilter, setAgentFilter] = useState("");
  const [engineFilter, setEngineFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState("");
  const [runFormError, setRunFormError] = useState("");

  const trimmedPrompt = prompt.trim();
  const canTriggerRun = Boolean(agentId && trimmedPrompt) && mission.busyKey !== "run:create";

  const runs = useMemo(
    () =>
      mission.runs.filter((run) => {
        if (agentFilter && run.agent_id !== agentFilter) return false;
        if (engineFilter && run.engine !== engineFilter) return false;
        if (statusFilter && run.status !== statusFilter) return false;
        return true;
      }),
    [agentFilter, engineFilter, mission.runs, statusFilter],
  );

  const totalRuns = mission.runs.length;
  const successfulRuns = mission.runs.filter((run) => run.status === "complete").length;
  const runningRuns = mission.runs.filter((run) => run.status === "running").length;
  const successRate = totalRuns > 0 ? `${Math.round((successfulRuns / totalRuns) * 100)}%` : "0%";
  const usageSummary = useMemo(() => {
    const agentsById = new Map(mission.agents.map((agent) => [agent.id, agent]));
    const byEngine = new Map<string, { tokens: number; usdCost: number }>();
    const unpricedEngines = new Set<string>();
    let totalTokens = 0;
    let totalUsdCost = 0;

    for (const run of runs) {
      const agent = run.agent_id ? agentsById.get(run.agent_id) : undefined;
      const estimate = estimateRunUsage(run, agent);
      totalTokens += estimate.totalTokens;
      totalUsdCost += estimate.usdCost;

      if (!estimate.priced && estimate.totalTokens > 0) {
        unpricedEngines.add(run.engine);
      }

      const current = byEngine.get(run.engine) ?? { tokens: 0, usdCost: 0 };
      current.tokens += estimate.totalTokens;
      current.usdCost += estimate.usdCost;
      byEngine.set(run.engine, current);
    }

    return {
      totalTokens,
      totalUsdCost,
      byEngine: Array.from(byEngine.entries())
        .map(([engine, value]) => ({ engine, ...value }))
        .sort((left, right) => right.usdCost - left.usdCost || right.tokens - left.tokens),
      unpricedEngines: Array.from(unpricedEngines.values()),
    };
  }, [mission.agents, runs]);
  const hasActiveRuns = mission.runs.some((run) => run.status === "running" || run.status === "planning");

  // Fast poll (3s) while runs are active, slow poll (8s) otherwise so new runs still appear
  useEffect(() => {
    const interval = window.setInterval(() => {
      void mission.silentRefreshRuns();
    }, hasActiveRuns ? 3_000 : 8_000);

    return () => window.clearInterval(interval);
  }, [hasActiveRuns]);

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 grid grid-cols-4 gap-4">
          <RunStatCard icon={<ActivityIcon className="size-4" />} label="Total Runs" value={String(totalRuns)} change={`${runningRuns} active`} />
          <RunStatCard icon={<ZapIcon className="size-4" />} label="Success Rate" value={successRate} subtitle="backend backed" good />
          <RunStatCard icon={<ClockIcon className="size-4" />} label="Avg Duration" value={runs[0] ? formatDuration(runs[0]) : "—"} />
          <RunStatCard icon={<CpuIcon className="size-4" />} label="Active Engines" value={String(new Set(mission.runs.map((run) => run.engine)).size)} subtitle="configured" />
        </div>

        <div className="mb-4 rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[#918f90]">Trigger Run</div>
          <div className="grid grid-cols-[220px_1fr_auto] gap-3">
            <Select value={agentId} onValueChange={(value) => { setAgentId(value ?? ""); if (runFormError) setRunFormError(""); }}>
              <SelectTrigger className="border-white/[0.06] bg-[#0f0f10] text-[12px] text-white">
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Select agent</SelectItem>
                {mission.agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                if (runFormError) {
                  setRunFormError("");
                }
              }}
              placeholder="Enter run prompt..."
              className="rounded-lg border border-white/[0.06] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[#918f90]"
            />
            <button
              onClick={async () => {
                if (!agentId) {
                  setRunFormError("Select an agent before starting a run.");
                  return;
                }
                if (!trimmedPrompt) {
                  setRunFormError("Enter a prompt before starting a run.");
                  return;
                }
                setRunFormError("");
                const run = await mission.createRun({ agent_id: agentId, prompt: trimmedPrompt });
                if (run) {
                  setExpandedId(run.id);
                  setPrompt("");
                  setStreamStatus(run.status === "running" ? "Streaming..." : "");
                  void mission.streamSelectedRun(run.id, (nextRun) => {
                    setStreamStatus(nextRun.status === "failed" ? "Run failed" : nextRun.status === "complete" ? "Run complete" : "Streaming...");
                  });
                }
              }}
              disabled={!canTriggerRun}
              className={cn(
                "rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[13px] font-medium text-white transition-opacity",
                canTriggerRun ? "opacity-100" : "cursor-not-allowed opacity-50",
              )}
            >
              {mission.busyKey === "run:create" ? "Starting..." : "Run Agent"}
            </button>
          </div>
          {runFormError || mission.error ? <div className="mt-3 text-[12px] text-red-400">{runFormError || mission.error}</div> : null}
        </div>

        <div className="mb-4 flex items-center gap-3">
          <FilterSelect label="Agent" value={agentFilter} onChange={setAgentFilter} options={["", ...mission.agents.map((agent) => agent.id)]} lookup={Object.fromEntries(mission.agents.map((agent) => [agent.id, agent.name]))} />
          <FilterSelect label="Engine" value={engineFilter} onChange={setEngineFilter} options={["", ...Array.from(new Set(mission.runs.map((run) => run.engine)))]} />
          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={["", "complete", "failed", "running", "planning"]} />
          {streamStatus ? <span className="text-[12px] text-[#918f90]">{streamStatus}</span> : null}
        </div>

        <div className="overflow-hidden rounded-xl border border-white/[0.06]">
          <div className="grid grid-cols-[170px_1.5fr_1.2fr_1fr_1fr_80px_40px] gap-4 border-b border-white/[0.06] bg-[#1c1b1c] px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Time</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Agent</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Mission/Issue</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Engine</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Status</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Duration</span>
            <span />
          </div>

          <div className="divide-y divide-white/[0.04]">
            {runs.map((run) => (
              <div key={run.id}>
                <button
                  onClick={async () => {
                    setExpandedId(expandedId === run.id ? null : run.id);
                    if (expandedId !== run.id) {
                      const fresh = await mission.loadRun(run.id);
                      if (fresh?.status === "running") {
                        setStreamStatus("Streaming...");
                        void mission.streamSelectedRun(run.id, (nextRun) => {
                          setStreamStatus(nextRun.status === "complete" ? "Run complete" : nextRun.status === "failed" ? "Run failed" : "Streaming...");
                        });
                      }
                    }
                  }}
                  className="grid w-full grid-cols-[170px_1.5fr_1.2fr_1fr_1fr_80px_40px] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <span className="font-mono text-[12px] text-[#918f90]">{formatDateTime(run.started_at, mission.settingsMap.user_timezone)}</span>
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: run.agent_color ? `linear-gradient(135deg, ${run.agent_color}cc, ${run.agent_color})` : "linear-gradient(135deg, #39147e, #2e1065)" }}
                    >
                      {run.agent_emoji ?? "A"}
                    </div>
                    <span className="text-[13px] font-medium text-white">{run.agent_name ?? run.engine}</span>
                  </div>
                  <span className="text-[13px] text-[#c8c4d7]">{run.issue_title || run.mission_title || "Ad hoc"}</span>
                  <span className="text-[13px] text-[#918f90]">{run.engine}</span>
                  <span className={cn("inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_BADGE[run.status] ?? STATUS_BADGE.planning)}>
                    {run.status}
                  </span>
                  <span className="font-mono text-[12px] text-[#c8c4d7]">{formatDuration(run)}</span>
                  <div className="flex justify-end text-[#918f90]">
                    {expandedId === run.id ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
                  </div>
                </button>

                {expandedId === run.id ? (
                  <div className="border-t border-white/[0.04] bg-[#0f0f10]">
                    <div className="max-h-[400px] overflow-y-auto px-6 py-3">
                      <div className="space-y-2">
                        {run.github_branch || run.github_pr_url ? (
                          <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                            {run.github_branch ? (
                              <span className="flex items-center gap-1.5 text-[12px] text-[#c8c4d7]">
                                <GitBranchIcon className="size-3 text-[#918f90]" />
                                <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px]">{run.github_branch}</code>
                              </span>
                            ) : null}
                            {run.github_pr_url ? (
                              <a href={run.github_pr_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] text-[#5e4ae3] hover:text-[#c6bfff]">
                                <GitPullRequestIcon className="size-3" />
                                Pull Request
                                <ExternalLinkIcon className="size-3" />
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                        {run.parent_run_id ? (
                          <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                            <LayersIcon className="size-3 text-[#918f90]" />
                            <span className="text-[12px] text-[#918f90]">Child step{run.plan_step_id ? `: ${run.plan_step_id}` : ""}</span>
                            <button
                              onClick={() => setExpandedId(run.parent_run_id)}
                              className="text-[12px] text-[#5e4ae3] hover:text-[#c6bfff]"
                            >
                              View parent run
                            </button>
                          </div>
                        ) : null}
                        {run.execution_plan ? (
                          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                            <div className="mb-2 flex items-center gap-2">
                              <LayersIcon className="size-3 text-[#5e4ae3]" />
                              <span className="text-[12px] font-medium text-white">Execution Plan</span>
                              {run.execution_plan.summary ? <span className="text-[11px] text-[#918f90]">— {run.execution_plan.summary}</span> : null}
                            </div>
                            <div className="space-y-1">
                              {run.execution_plan.plan.map((step) => {
                                const childRun = mission.runs.find((r) => r.parent_run_id === run.id && r.plan_step_id === step.id);
                                return (
                                  <div key={step.id} className="flex items-center gap-3 text-[12px]">
                                    <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-[#918f90]">{step.id}</code>
                                    <span className="text-[#c8c4d7]">{step.agent}</span>
                                    <span className="flex-1 truncate text-[#918f90]">{step.task}</span>
                                    {childRun ? (
                                      <button
                                        onClick={() => setExpandedId(childRun.id)}
                                        className={cn(
                                          "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                                          STATUS_BADGE[childRun.status] ?? STATUS_BADGE.planning,
                                        )}
                                      >
                                        {childRun.status}
                                      </button>
                                    ) : (
                                      <span className="rounded-full border border-white/[0.06] px-2 py-0.5 text-[10px] text-[#918f90]">pending</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 font-mono text-[11px] text-[#918f90]">prompt</span>
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase bg-white/[0.04] text-[#918f90]">task</span>
                          <span className="text-[12px] text-[#c8c4d7]">{run.prompt}</span>
                        </div>
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 font-mono text-[11px] text-[#918f90]">output</span>
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase bg-cyan-500/10 text-cyan-400">stream</span>
                          <pre className="whitespace-pre-wrap text-[12px] text-[#c8c4d7]">{mission.selectedRun?.id === run.id ? mission.selectedRun.output : run.output || "No output yet."}</pre>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end border-t border-white/[0.04] px-6 py-2">
                      <button
                        onClick={async () => {
                          const confirmed = window.confirm("Delete this run? This action cannot be undone.");
                          if (!confirmed) return;
                          const ok = await mission.removeRun(run.id);
                          if (ok) {
                            setExpandedId(null);
                          }
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-400 transition-colors hover:border-red-500/40 hover:bg-red-500/20"
                      >
                        <Trash2Icon className="size-3.5" />
                        Delete Run
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="w-[300px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
        <h3 className="mb-4 text-[14px] font-semibold text-white">Engine Performance</h3>

        <div className="mb-5 rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Real-time Throughput</div>
          <div className="text-2xl font-semibold text-white">{runningRuns} <span className="text-[13px] text-[#918f90]">live runs</span></div>
          <div className="mt-3 flex h-10 items-end gap-0.5">
            {mission.runs.slice(0, 20).map((run) => (
              <div key={run.id} className="flex-1 rounded-sm bg-[#5e4ae3]/60" style={{ height: `${Math.min(100, ((run.duration_ms ?? 1000) / 1000) * 10)}%` }} />
            ))}
          </div>
        </div>

        <div className="mb-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Engine Load</div>
          <div className="space-y-3">
            {Array.from(new Set(mission.runs.map((run) => run.engine))).map((engine) => {
              const count = mission.runs.filter((run) => run.engine === engine).length;
              const percent = totalRuns > 0 ? Math.round((count / totalRuns) * 100) : 0;
              return (
                <div key={engine}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="text-[#c8c4d7]">{engine}</span>
                    <span className="text-[#918f90]">{percent}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-[#5e4ae3]" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Estimated Usage</div>
          <div className="text-2xl font-semibold text-white">{formatTokenCount(usageSummary.totalTokens)} <span className="text-[13px] text-[#918f90]">tokens</span></div>
          <div className="mt-1 text-[13px] text-[#c8c4d7]">{formatMoneyFromUsd(usageSummary.totalUsdCost, mission.settingsMap)} estimated spend</div>
          <div className="mt-3 space-y-2">
            {usageSummary.byEngine.map((entry) => (
              <div key={entry.engine} className="flex items-center justify-between text-[12px]">
                <span className="text-[#c8c4d7]">{entry.engine}</span>
                <span className="text-[#918f90]">
                  {formatTokenCount(entry.tokens)} • {formatMoneyFromUsd(entry.usdCost, mission.settingsMap)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[#918f90]">Estimated from prompt/output text length. Currency and FX are configurable in Settings.</p>
          {usageSummary.unpricedEngines.length > 0 ? (
            <p className="mt-1 text-[11px] text-[#918f90]">Spend excludes engines without a rate profile: {usageSummary.unpricedEngines.join(", ")}.</p>
          ) : null}
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
      {change ? <div className="mt-0.5 text-[11px] text-emerald-400">{change}</div> : null}
      {subtitle ? <div className={cn("mt-0.5 text-[11px]", good ? "text-emerald-400" : "text-[#918f90]")}>{subtitle}</div> : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  lookup,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  lookup?: Record<string, string>;
}) {
  return (
    <div className="flex items-center gap-2">
      <FilterIcon className="size-3 text-[#918f90]" />
      <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger size="sm" className="border-white/[0.06] bg-[#1c1b1c] text-[12px] text-[#c8c4d7]">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{label}</SelectItem>
          {options.filter(Boolean).map((option) => (
            <SelectItem key={option} value={option}>
              {lookup?.[option] ?? option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
