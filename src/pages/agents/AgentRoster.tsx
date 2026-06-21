import { useMemo, useState } from "react";
import { FilterIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon, WifiIcon, XIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { AgentWizard } from "@/pages/onboarding/AgentWizard";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dateFormat";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AgentRosterProps {
  mission: MissionControlState;
}

type StatusFilter = "all" | "Running" | "Active" | "Idle" | "Offline";

const STATUS_DOT: Record<string, string> = {
  Running: "bg-emerald-400",
  Active: "bg-blue-400",
  Idle: "bg-yellow-400",
  Offline: "bg-red-400",
};

const ENGINE_BADGE: Record<string, string> = {
  OpenClaw: "border-[#5e4ae3]/30 bg-[#39147e]/10 text-[#c6bfff]",
  Claude: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Codex: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  Hermes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  Cursor: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  Pi: "border-pink-500/30 bg-pink-500/10 text-pink-300",
};

export function AgentRoster({ mission }: AgentRosterProps) {
  const [engineFilter, setEngineFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editAgentId, setEditAgentId] = useState<string | null>(null);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const contextAgent = contextMenuId ? mission.agents.find((agent) => agent.id === contextMenuId) : null;

  const agents = useMemo(() => {
    return mission.derivedAgents.filter((agent) => {
      if (engineFilter !== "all" && agent.engineLabel !== engineFilter) return false;
      if (statusFilter !== "all" && agent.statusLabel !== statusFilter) return false;
      if (search && !agent.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [engineFilter, mission.derivedAgents, search, statusFilter]);
  const engineOptions = useMemo(
    () => ["all", ...Array.from(new Set(mission.derivedAgents.map((agent) => agent.engineLabel))).sort((left, right) => left.localeCompare(right))],
    [mission.derivedAgents],
  );

  const agentDeleteBlocker = useMemo(() => {
    if (!contextMenuId) {
      return null;
    }
    const assignedMission = mission.missions.some((missionRecord) =>
      missionRecord.lead_agent_id === contextMenuId || missionRecord.assigned_agents.some((agent) => agent.id === contextMenuId),
    );
    if (assignedMission) {
      return "Reassign this agent from missions before deleting it.";
    }
    if (mission.issues.some((issue) => issue.assignee_agent_id === contextMenuId)) {
      return "Reassign this agent's issues before deleting it.";
    }
    if (mission.runs.some((run) => run.agent_id === contextMenuId)) {
      return "Remove this agent's runs before deleting it.";
    }
    if (mission.agentMessages.some((message) => message.from_agent_id === contextMenuId || message.to_agent_id === contextMenuId)) {
      return "Remove this agent's messages before deleting it.";
    }
    if (mission.schedules.some((schedule) => schedule.agent_id === contextMenuId)) {
      return "Remove this agent's schedules before deleting it.";
    }
    return null;
  }, [contextMenuId, mission.agentMessages, mission.issues, mission.missions, mission.runs, mission.schedules]);

  return (
    <div className="flex h-full flex-col p-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Agent Roster</h1>
          <p className="mt-0.5 text-[12px] text-[#585658]">{mission.agents.length} agents registered</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[#39147e] px-4 py-2 text-[12px] font-semibold text-white shadow-lg shadow-[#2e1065]/25 transition-all hover:bg-[#7c3aed]"
        >
          <PlusIcon className="size-3.5" />
          Add Agent
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-8 w-56 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3">
          <SearchIcon className="size-3.5 text-[#585658]" />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#585658]"
          />
        </div>
        <FilterDropdown label="Engine" value={engineFilter} options={engineOptions} onChange={setEngineFilter} />
        <FilterDropdown label="Status" value={statusFilter} options={["all", "Running", "Active", "Idle", "Offline"]} onChange={(value) => setStatusFilter(value as StatusFilter)} />
        <span className="ml-auto text-[11px] text-[#585658]">
          {agents.length === mission.agents.length ? `${agents.length} agents` : `${agents.length} of ${mission.agents.length}`}
        </span>
      </div>

      {/* Table */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/[0.06]">
        <div className="grid grid-cols-[2.5fr_1.5fr_1fr_1fr_1fr_auto] items-center gap-4 border-b border-white/[0.06] bg-[#1c1b1c] px-5 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Agent</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Role</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Engine</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Status</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Last Run</span>
          <span className="w-8" />
        </div>
        <div className="min-h-0 flex-1 divide-y divide-white/[0.04] overflow-y-auto">
          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-[13px] text-[#585658]">No agents found</div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-3 text-[12px] font-medium text-[#5e4ae3] transition-colors hover:text-[#8b7bf7]"
              >
                Create your first agent
              </button>
            </div>
          ) : null}
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="group relative grid grid-cols-[2.5fr_1.5fr_1fr_1fr_1fr_auto] items-center gap-4 px-5 py-3 transition-colors hover:bg-white/[0.02]"
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex size-8 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                  style={{ background: `linear-gradient(135deg, ${agent.color}cc, ${agent.color})` }}
                >
                  {agent.avatarText}
                </div>
                <div>
                  <div className="text-[13px] font-medium text-white">{agent.name}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[#585658]">{agent.id.slice(0, 8).toUpperCase()}</span>
                    {agent.skills.length > 0 ? (
                      <span className="text-[10px] text-[#585658]">
                        &middot; {agent.skills.length} skill{agent.skills.length !== 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <span className="text-[12px] text-[#918f90]">{agent.role || "Unassigned"}</span>
              <span className={cn("inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-medium", ENGINE_BADGE[agent.engineLabel] ?? ENGINE_BADGE.OpenClaw)}>
                {agent.engineLabel}
              </span>
              <div className="flex items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full", STATUS_DOT[agent.statusLabel])} />
                <span className="text-[12px] text-[#918f90]">{agent.statusLabel}</span>
              </div>
              <span className="text-[11px] text-[#585658]">
                {agent.lastRunLabel ? formatDate(agent.lastRunLabel, mission.settingsMap.user_timezone) : "Never"}
              </span>
              <button
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenuPosition({ top: rect.bottom + 4, left: rect.right - 160 });
                  setContextMenuId(contextMenuId === agent.id ? null : agent.id);
                }}
                aria-label={`Open ${agent.name} actions`}
                className="rounded-lg p-1.5 text-[#585658] opacity-0 transition-all group-hover:opacity-100 hover:bg-white/[0.06] hover:text-white"
              >
                <MoreHorizontalIcon className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Context Menu (rendered outside table to avoid overflow clipping) */}
      {contextMenuId ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenuId(null)} />
          <div
            className="fixed z-50 w-40 overflow-hidden rounded-lg border border-white/[0.08] bg-[#1c1b1c] shadow-xl"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <button
              onClick={() => {
                setEditAgentId(contextMenuId);
                setContextMenuId(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <PencilIcon className="size-3.5" />
              Edit Agent
            </button>
            <button
              onClick={async () => {
                const result = await mission.testAgentConnection(contextMenuId);
                if (result) {
                  setContextMenuId(null);
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <WifiIcon className="size-3.5" />
              Test Connection
            </button>
            <button
              onClick={async () => {
                if (agentDeleteBlocker) {
                  return;
                }
                await mission.removeAgent(contextMenuId);
                setContextMenuId(null);
              }}
              disabled={Boolean(agentDeleteBlocker)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-red-400 transition-colors hover:bg-red-500/10",
                agentDeleteBlocker && "cursor-not-allowed opacity-45",
              )}
            >
              <Trash2Icon className="size-3.5" />
              Delete Agent
            </button>
            {agentDeleteBlocker ? (
              <div className="border-t border-white/[0.06] px-3 py-2 text-[11px] leading-snug text-[#918f90]">
                {agentDeleteBlocker}
              </div>
            ) : contextAgent ? (
              <div className="border-t border-white/[0.06] px-3 py-2 text-[11px] leading-snug text-[#918f90]">
                Deletes {contextAgent.name} permanently.
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Create Agent Modal */}
      {showCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
              <h2 className="text-[14px] font-semibold text-white">New Agent</h2>
              <button onClick={() => setShowCreateModal(false)} className="rounded-lg p-1 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white">
                <XIcon className="size-4" />
              </button>
            </div>
            <AgentWizard
              mission={mission}
              onComplete={() => setShowCreateModal(false)}
              onCancel={() => setShowCreateModal(false)}
              submitLabel="Create Agent"
            />
          </div>
        </div>
      ) : null}

      {/* Edit Agent Modal */}
      {editAgentId ? (() => {
        const agentToEdit = mission.agents.find((a) => a.id === editAgentId);
        if (!agentToEdit) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
                <h2 className="text-[14px] font-semibold text-white">Edit Agent</h2>
                <button onClick={() => setEditAgentId(null)} className="rounded-lg p-1 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white">
                  <XIcon className="size-4" />
                </button>
              </div>
              <AgentWizard
                mission={mission}
                onComplete={() => setEditAgentId(null)}
                onCancel={() => setEditAgentId(null)}
                submitLabel="Save Changes"
                initialAgent={agentToEdit}
              />
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}

function FilterDropdown({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <FilterIcon className="size-3 text-[#585658]" />
      <Select value={value} onValueChange={(v) => onChange(v ?? "all")}>
        <SelectTrigger size="sm" className="border-white/[0.06] bg-[#1c1b1c] text-[11px] text-[#918f90]">
          <SelectValue placeholder={`All ${label}s`}>{value === "all" ? `All ${label}s` : value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option === "all" ? `All ${label}s` : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
