import type { Dispatch, ReactNode, SetStateAction } from "react";
import { CheckIcon, ChevronRightIcon, GitBranchIcon, PencilIcon, PlusIcon, UsersIcon, XIcon } from "lucide-react";
import type { MissionRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { missionHasActiveRuns } from "@/mission/missionStatus";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface MissionRepoOption {
  full_name: string;
  default_branch: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-[#39147e]/20 text-[#c6bfff] border-[#5e4ae3]/30",
  planning: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  complete: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  paused: "bg-white/[0.08] text-[#c8c4d7] border-white/[0.12]",
};

const PROGRESS_COLORS: Record<string, string> = {
  active: "bg-[#39147e]",
  planning: "bg-yellow-500",
  complete: "bg-emerald-500",
  paused: "bg-white/[0.18]",
};

const MISSION_COLORS = [
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Yellow" },
  { value: "#22c55e", label: "Green" },
  { value: "#06b6d4", label: "Cyan" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#ec4899", label: "Pink" },
];

function normalizeSelectValue(value: string | null) {
  return value ?? "";
}

function agentSelectLabel(agentId: string, mission: MissionControlState) {
  return mission.agents.find((agent) => agent.id === agentId)?.name ?? "Select lead agent";
}

function missionReadyAgents(mission: MissionControlState) {
  const supportedEngineIds = new Set(mission.engines.map((engine) => engine.id));
  return mission.agents.filter((agent) => agent.active && supportedEngineIds.has(agent.engine));
}

function missionAgentHasActiveRuns(mission: MissionControlState, missionId: string, agentId: string) {
  return mission.runs.some(
    (run) => run.mission_id === missionId && run.agent_id === agentId && (run.status === "running" || run.status === "planning"),
  );
}

function formatRelative(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return value;
  }
  const deltaMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (deltaMinutes < 60) {
    return `${deltaMinutes || 1} min ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  return `${Math.floor(deltaHours / 24)}d ago`;
}

export function StatCard({
  icon,
  label,
  value,
  subtitle,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  accent?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-4", accent ? "border-[#5e4ae3]/30 bg-[#39147e]/[0.06]" : "border-white/[0.06] bg-[#1c1b1c]")}>
      <div className="mb-2 flex items-center gap-2 text-[#918f90]">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-white">{value}</div>
      {subtitle ? <div className="mt-0.5 text-[11px] text-[#918f90]">{subtitle}</div> : null}
    </div>
  );
}

export function MissionGrid({
  mission,
  missions,
  selectedMissionId,
  onSelectMission,
  onOpenCreate,
}: {
  mission: MissionControlState;
  missions?: MissionRecord[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  onOpenCreate: () => void;
}) {
  const entries = missions ?? mission.missions;
  const selectedMission = entries.find((entry) => entry.id === selectedMissionId) ?? entries[0] ?? null;

  return (
    <div className="grid grid-cols-3 gap-4">
      {entries.map((entry) => (
        <button
          key={entry.id}
          onClick={() => onSelectMission(entry.id)}
          className={cn(
            "rounded-xl border border-l-2 p-4 text-left transition-all",
            selectedMission?.id === entry.id
              ? "border-white/[0.06] bg-[#1c1b1c] ring-1 ring-[#5e4ae3]/50"
              : "border-white/[0.06] bg-[#1c1b1c] hover:border-white/[0.1]",
          )}
          style={entry.color ? { borderLeftColor: entry.color } : undefined}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", STATUS_COLORS[entry.status] ?? STATUS_COLORS.planning)}>
              {entry.status}
            </span>
            <span className="text-[12px] text-[#918f90]">{formatRelative(entry.last_active_at)}</span>
          </div>
          <h3 className="text-[14px] font-semibold text-white">{entry.title}</h3>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-[#c8c4d7]">
            <UsersIcon className="size-3" />
            <span>{entry.team_name}</span>
          </div>
          <p className="mt-1 text-[12px] text-[#918f90]">{entry.description || "No description yet."}</p>
          {entry.github_repo ? (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[#918f90]">
              <GitBranchIcon className="size-3" />
              <span>{entry.github_repo}</span>
            </div>
          ) : null}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-[#918f90]">Progress</span>
              <span className="text-white">{entry.progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn("h-full rounded-full transition-all", PROGRESS_COLORS[entry.status] ?? PROGRESS_COLORS.planning)}
                style={{ width: `${entry.progress}%` }}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1">
            {entry.assigned_agents.slice(0, 4).map((agent, index) => (
              <div
                key={agent.id}
                className="flex size-6 items-center justify-center rounded-full text-[11px] ring-2 ring-[#1c1b1c]"
                style={{ marginLeft: index > 0 ? -6 : 0, backgroundColor: `${agent.color}44`, color: "#fff" }}
                title={agent.name}
              >
                {agent.emoji}
              </div>
            ))}
            {entry.assigned_agents.length > 4 ? <span className="ml-1 text-[11px] text-[#918f90]">+{entry.assigned_agents.length - 4}</span> : null}
          </div>
        </button>
      ))}

      <button
        onClick={onOpenCreate}
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-transparent p-4 text-[#918f90] transition-colors hover:border-[#5e4ae3]/40 hover:text-[#c6bfff]"
      >
        <PlusIcon className="mb-2 size-6" />
        <span className="text-[13px] font-medium">New Mission</span>
      </button>
    </div>
  );
}

export function MissionDetailPanel({
  mission,
  selected,
  editing,
  startEditing,
  cancelEditing,
  saveEditing,
  editTitle,
  setEditTitle,
  editDescription,
  setEditDescription,
  editStatus,
  setEditStatus,
  editTeamName,
  setEditTeamName,
  editColor,
  setEditColor,
  editGithubRepo,
  setEditGithubRepo,
  setEditGithubBranch,
  editRepoQuery,
  setEditRepoQuery,
  editRepoDropdownOpen,
  setEditRepoDropdownOpen,
  filteredEditRepos,
  reposLoaded,
}: {
  mission: MissionControlState;
  selected: MissionRecord | null;
  editing: boolean;
  startEditing: () => void;
  cancelEditing: () => void;
  saveEditing: () => Promise<void>;
  editTitle: string;
  setEditTitle: (value: string) => void;
  editDescription: string;
  setEditDescription: (value: string) => void;
  editStatus: string;
  setEditStatus: (value: string) => void;
  editTeamName: string;
  setEditTeamName: (value: string) => void;
  editColor: string;
  setEditColor: (value: string) => void;
  editGithubRepo: string;
  setEditGithubRepo: (value: string) => void;
  setEditGithubBranch: (value: string) => void;
  editRepoQuery: string;
  setEditRepoQuery: (value: string) => void;
  editRepoDropdownOpen: boolean;
  setEditRepoDropdownOpen: Dispatch<SetStateAction<boolean>>;
  filteredEditRepos: MissionRepoOption[];
  reposLoaded: boolean;
}) {
  if (!selected) {
    return null;
  }

  const canStartMission = selected.status !== "active" && selected.status !== "complete";
  const hasActiveRuns = missionHasActiveRuns(selected.id, mission.runs);
  const completionBlocked = editStatus === "complete" && hasActiveRuns;
  const assignedAgentIds = new Set(selected.assigned_agents.map((agent) => agent.id));
  const availableAgents = missionReadyAgents(mission).filter((agent) => !assignedAgentIds.has(agent.id));

  return (
    <div className="w-[340px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
      {editing ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#585658]">Editing Mission</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void saveEditing()}
                disabled={completionBlocked}
                className={cn(
                  "rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-500/10",
                  completionBlocked && "cursor-not-allowed opacity-45",
                )}
                title="Save"
              >
                <CheckIcon className="size-3.5" />
              </button>
              <button onClick={cancelEditing} className="rounded-lg p-1.5 text-[#918f90] hover:bg-white/[0.06] hover:text-white" title="Cancel">
                <XIcon className="size-3.5" />
              </button>
            </div>
          </div>
          <input
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            className="mb-3 w-full border-none bg-transparent text-[15px] font-semibold text-white outline-none placeholder:text-[#585658]"
            placeholder="Mission title..."
          />
          <div className="mb-4">
            <Field label="Team" value={editTeamName} onChange={setEditTeamName} placeholder="Engineering, Marketing, Sales..." />
          </div>
          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Status</label>
            <Select value={editStatus} onValueChange={(value) => setEditStatus(normalizeSelectValue(value))}>
              <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["planning", "active", "paused", "complete"].map((status) => (
                  <SelectItem key={status} value={status} disabled={status === "complete" && hasActiveRuns}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveRuns ? (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-300">
                Finish active runs before marking this mission complete.
              </p>
            ) : null}
          </div>
          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Color</label>
            <div className="flex flex-wrap gap-1.5">
              {MISSION_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setEditColor(editColor === c.value ? "" : c.value)}
                  className={cn(
                    "size-6 rounded-full border-2 transition-all",
                    editColor === c.value ? "border-white scale-110" : "border-transparent hover:border-white/30",
                  )}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          </div>
          <div className="mb-4">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Agents</div>
            <div className="space-y-2">
              {selected.assigned_agents.map((agent) => {
                const hasAgentActiveRuns = missionAgentHasActiveRuns(mission, selected.id, agent.id);
                return (
                  <div key={agent.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <div className="flex size-7 items-center justify-center rounded-full text-[12px]" style={{ backgroundColor: `${agent.color}44` }}>
                      {agent.emoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-white">{agent.name}</div>
                      <div className="truncate text-[11px] text-[#918f90]">{agent.role || "Unassigned role"}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!hasAgentActiveRuns) {
                          void mission.removeMissionAgent(selected.id, agent.id);
                        }
                      }}
                      disabled={hasAgentActiveRuns}
                      className={cn(
                        "rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-[#c8c4d7] transition-colors hover:bg-white/[0.04]",
                        hasAgentActiveRuns && "cursor-not-allowed opacity-45",
                      )}
                      aria-label={`Remove ${agent.name} from mission`}
                      title={hasAgentActiveRuns ? "Finish active runs before removing this agent." : "Remove agent"}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {selected.assigned_agents.length === 0 ? (
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[12px] text-[#918f90]">No agents assigned.</div>
              ) : null}
            </div>
            {availableAgents.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {availableAgents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => void mission.assignMissionAgent(selected.id, agent.id)}
                    className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-[#c8c4d7] transition-colors hover:bg-white/[0.04] hover:text-white"
                  >
                    Add {agent.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Description</label>
            <textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              className="h-24 w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none focus:border-[#5e4ae3]/50"
              placeholder="Mission description..."
            />
          </div>
          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">GitHub Repository</label>
            {mission.settingsMap.github_pat ? (
              <div className="relative">
                <div
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2"
                  onClick={() => setEditRepoDropdownOpen((value) => !value)}
                >
                  {editGithubRepo ? (
                    <div className="flex flex-1 items-center gap-1.5">
                      <GitBranchIcon className="size-3.5 text-emerald-400" />
                      <span className="text-[13px] text-white">{editGithubRepo}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditGithubRepo("");
                          setEditRepoQuery("");
                        }}
                        className="ml-auto text-[#918f90] hover:text-white"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <span className="flex-1 text-[13px] text-[#585658]">Select a repository...</span>
                  )}
                  <ChevronRightIcon className={cn("size-3.5 text-[#585658] transition-transform", editRepoDropdownOpen && "rotate-90")} />
                </div>
                {editRepoDropdownOpen ? (
                  <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0f0f10] shadow-xl">
                    <div className="border-b border-white/[0.06] p-2">
                      <input
                        type="text"
                        value={editRepoQuery}
                        onChange={(event) => setEditRepoQuery(event.target.value)}
                        placeholder="Filter repos..."
                        className="w-full rounded-md border border-white/[0.08] bg-[#131314] px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-[#585658] focus:border-[#5e4ae3]/50"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {filteredEditRepos.length > 0 ? filteredEditRepos.map((repo) => (
                        <button
                          key={repo.full_name}
                          type="button"
                          onClick={() => {
                            setEditGithubRepo(repo.full_name);
                            setEditGithubBranch(repo.default_branch);
                            setEditRepoQuery("");
                            setEditRepoDropdownOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.03]",
                            editGithubRepo === repo.full_name ? "bg-[#39147e]/[0.08] text-white" : "text-[#c8c4d7]",
                          )}
                        >
                          <GitBranchIcon className="size-3.5 text-[#918f90]" />
                          {repo.full_name}
                          <span className="ml-auto text-[10px] text-[#585658]">{repo.default_branch}</span>
                        </button>
                      )) : (
                        <div className="px-3 py-3 text-center text-[12px] text-[#585658]">
                          {reposLoaded ? "No matching repos" : "Loading repos..."}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editRepoQuery}
                  onChange={(event) => setEditRepoQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && editRepoQuery.includes("/")) {
                      event.preventDefault();
                      setEditGithubRepo(editRepoQuery);
                    }
                  }}
                  placeholder="owner/repo (e.g. acme/my-app)"
                  className="flex-1 rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
                />
                {editRepoQuery.includes("/") && editRepoQuery !== editGithubRepo ? (
                  <button type="button" onClick={() => setEditGithubRepo(editRepoQuery)} className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]">
                    Set
                  </button>
                ) : null}
                {editGithubRepo ? (
                  <div className="mt-2 flex items-center gap-1.5 text-[12px] text-emerald-400">
                    <GitBranchIcon className="size-3" />
                    {editGithubRepo}
                    <button type="button" onClick={() => { setEditGithubRepo(""); setEditRepoQuery(""); }} className="ml-1 text-[#918f90] hover:text-white">
                      <XIcon className="size-3" />
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <button
            onClick={() => void saveEditing()}
            disabled={completionBlocked}
            className={cn(
              "w-full rounded-lg bg-[#39147e] px-4 py-2 text-[13px] font-medium text-white transition-all hover:bg-[#7c3aed]",
              completionBlocked && "cursor-not-allowed opacity-45 hover:bg-[#39147e]",
            )}
          >
            Save Changes
          </button>
        </>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-white">{selected.title}</h2>
            <div className="flex items-center gap-2">
              <button onClick={startEditing} className="rounded-lg p-1 text-[#918f90] hover:bg-white/[0.06] hover:text-white" title="Edit mission">
                <PencilIcon className="size-3.5" />
              </button>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", STATUS_COLORS[selected.status] ?? STATUS_COLORS.planning)}>
                {selected.status}
              </span>
            </div>
          </div>
          <p className="mb-5 text-[13px] leading-relaxed text-[#918f90]">{selected.description || "No mission description yet."}</p>
          <div className="mb-5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Team</div>
            <div className="flex items-center gap-1.5 text-[13px] text-white">
              <UsersIcon className="size-3.5 text-[#918f90]" />
              {selected.team_name}
            </div>
          </div>
          {selected.github_repo ? (
            <div className="mb-5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">GitHub Repository</div>
              <div className="flex items-center gap-1.5 text-[13px] text-white">
                <GitBranchIcon className="size-3.5 text-[#918f90]" />
                {selected.github_repo}
                <span className="ml-auto rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#918f90]">{selected.github_default_branch}</span>
              </div>
            </div>
          ) : !selected.github_repo ? (
            <button
              onClick={startEditing}
              className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.1] px-3 py-2.5 text-[12px] text-[#918f90] transition-colors hover:border-[#5e4ae3]/40 hover:text-[#c6bfff]"
            >
              <GitBranchIcon className="size-3.5" />
              Link GitHub Repository
            </button>
          ) : null}

          <div className="mb-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Progress</div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn("h-full rounded-full", PROGRESS_COLORS[selected.status] ?? PROGRESS_COLORS.planning)}
                style={{ width: `${selected.progress}%` }}
              />
            </div>
            <div className="mt-1 text-right text-[12px] text-white">{selected.progress}%</div>
          </div>

          <div className="mb-5">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Milestones</div>
            <div className="space-y-2.5">
              <MilestoneItem label={`Issues complete: ${selected.issue_counts.complete}`} status={selected.issue_counts.complete > 0 ? "completed" : "pending"} />
              <MilestoneItem label={`Issues remaining: ${Math.max(selected.issue_counts.total - selected.issue_counts.complete, 0)}`} status={selected.status === "active" ? "active" : "pending"} />
              <MilestoneItem label={`Lead agent: ${selected.lead_agent_name || "Unassigned"}`} status={selected.lead_agent_id ? "completed" : "pending"} />
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Assigned Agents</div>
            <div className="space-y-2">
              {selected.assigned_agents.map((agent) => (
                <div key={agent.id} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <div className="flex size-7 items-center justify-center rounded-full text-[12px]" style={{ backgroundColor: `${agent.color}44` }}>
                    {agent.emoji}
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-white">{agent.name}</div>
                    <div className="text-[11px] text-[#918f90]">{agent.role || "Unassigned role"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void mission.startMission(selected.id)}
              disabled={!canStartMission}
              className={cn(
                "flex-1 rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[13px] font-medium text-white",
                !canStartMission && "cursor-not-allowed opacity-45",
              )}
            >
              Start Mission
            </button>
            <button
              onClick={() => mission.setActiveView("issues")}
              className="rounded-lg border border-white/[0.08] px-4 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
            >
              View Issues
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function CreateMissionModal({
  open,
  mission,
  title,
  setTitle,
  description,
  setDescription,
  teamName,
  setTeamName,
  leadAgentId,
  setLeadAgentId,
  selectedAgentIds,
  setSelectedAgentIds,
  githubRepo,
  setGithubRepo,
  setGithubDefaultBranch,
  repoQuery,
  setRepoQuery,
  repoDropdownOpen,
  setRepoDropdownOpen,
  filteredRepos,
  reposLoaded,
  suggestedTeamNames,
  onClose,
  onCreate,
}: {
  open: boolean;
  mission: MissionControlState;
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  teamName: string;
  setTeamName: (value: string) => void;
  leadAgentId: string;
  setLeadAgentId: (value: string) => void;
  selectedAgentIds: Set<string>;
  setSelectedAgentIds: Dispatch<SetStateAction<Set<string>>>;
  githubRepo: string;
  setGithubRepo: (value: string) => void;
  setGithubDefaultBranch: (value: string) => void;
  repoQuery: string;
  setRepoQuery: (value: string) => void;
  repoDropdownOpen: boolean;
  setRepoDropdownOpen: Dispatch<SetStateAction<boolean>>;
  filteredRepos: MissionRepoOption[];
  reposLoaded: boolean;
  suggestedTeamNames: string[];
  onClose: () => void;
  onCreate: () => Promise<void>;
}) {
  if (!open) {
    return null;
  }
  const readyAgents = missionReadyAgents(mission);
  const readyAgentIds = new Set(readyAgents.map((agent) => agent.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <h2 className="text-[14px] font-semibold text-white">New Mission</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white">
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="p-5">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Title" value={title} onChange={setTitle} placeholder="Ship MissionOS backend" />
              <div>
                <Field label="Team" value={teamName} onChange={setTeamName} placeholder="Engineering" />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {suggestedTeamNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setTeamName(name)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px] transition-colors",
                        teamName === name
                          ? "border-[#5e4ae3]/60 bg-[#39147e]/20 text-white"
                          : "border-white/[0.08] text-[#918f90] hover:bg-white/[0.04] hover:text-white",
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Lead Agent</label>
              <Select
                value={leadAgentId}
                onValueChange={(rawValue) => {
                  const value = normalizeSelectValue(rawValue);
                  setLeadAgentId(value);
                  if (value) {
                    setSelectedAgentIds((previous) => new Set(previous).add(value));
                  }
                }}
              >
                <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                  <SelectValue placeholder="Select lead agent">{agentSelectLabel(leadAgentId, mission)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Select lead agent</SelectItem>
                  {readyAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Description</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="h-20 w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">GitHub Repository</label>
              {mission.settingsMap.github_pat ? (
                <div className="relative">
                  <div
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2"
                    onClick={() => setRepoDropdownOpen((value) => !value)}
                  >
                    {githubRepo ? (
                      <div className="flex flex-1 items-center gap-1.5">
                        <GitBranchIcon className="size-3.5 text-emerald-400" />
                        <span className="text-[13px] text-white">{githubRepo}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setGithubRepo("");
                            setRepoQuery("");
                          }}
                          className="ml-auto text-[#918f90] hover:text-white"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <span className="flex-1 text-[13px] text-[#585658]">Select a repository...</span>
                    )}
                    <ChevronRightIcon className={cn("size-3.5 text-[#585658] transition-transform", repoDropdownOpen && "rotate-90")} />
                  </div>
                  {repoDropdownOpen ? (
                    <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-lg border border-white/[0.08] bg-[#0f0f10] shadow-xl">
                      <div className="border-b border-white/[0.06] p-2">
                        <input
                          type="text"
                          value={repoQuery}
                          onChange={(event) => setRepoQuery(event.target.value)}
                          placeholder="Filter repos..."
                          className="w-full rounded-md border border-white/[0.08] bg-[#131314] px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-[#585658] focus:border-[#5e4ae3]/50"
                          autoFocus
                        />
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {filteredRepos.length > 0 ? filteredRepos.map((repo) => (
                          <button
                            key={repo.full_name}
                            type="button"
                            onClick={() => {
                              setGithubRepo(repo.full_name);
                              setGithubDefaultBranch(repo.default_branch);
                              setRepoQuery("");
                              setRepoDropdownOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.03]",
                              githubRepo === repo.full_name ? "bg-[#39147e]/[0.08] text-white" : "text-[#c8c4d7]",
                            )}
                          >
                            <GitBranchIcon className="size-3.5 text-[#918f90]" />
                            {repo.full_name}
                            <span className="ml-auto text-[10px] text-[#585658]">{repo.default_branch}</span>
                          </button>
                        )) : (
                          <div className="px-3 py-3 text-center text-[12px] text-[#585658]">
                            {reposLoaded ? "No matching repos" : "Loading repos..."}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={repoQuery}
                    onChange={(event) => setRepoQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && repoQuery.includes("/")) {
                        event.preventDefault();
                        setGithubRepo(repoQuery);
                      }
                    }}
                    placeholder="owner/repo (e.g. acme/my-app)"
                    className="flex-1 rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
                  />
                  {repoQuery.includes("/") && repoQuery !== githubRepo ? (
                    <button
                      type="button"
                      onClick={() => setGithubRepo(repoQuery)}
                      className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                    >
                      Set
                    </button>
                  ) : null}
                </div>
              )}
              {githubRepo && !mission.settingsMap.github_pat ? (
                <div className="mt-2 flex items-center gap-1.5 text-[12px] text-emerald-400">
                  <GitBranchIcon className="size-3" />
                  {githubRepo}
                  <button type="button" onClick={() => { setGithubRepo(""); setRepoQuery(""); }} className="ml-1 text-[#918f90] hover:text-white">
                    <XIcon className="size-3" />
                  </button>
                </div>
              ) : null}
            </div>

            {readyAgents.length > 0 ? (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">
                  Assign Agents
                  {selectedAgentIds.size > 0 ? <span className="ml-1.5 normal-case tracking-normal text-[#585658]">({selectedAgentIds.size} selected)</span> : null}
                </label>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#0f0f10]">
                  {mission.derivedAgents.filter((agent) => readyAgentIds.has(agent.id)).map((agent) => {
                    const isSelected = selectedAgentIds.has(agent.id);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          setSelectedAgentIds((previous) => {
                            const next = new Set(previous);
                            if (next.has(agent.id)) {
                              next.delete(agent.id);
                            } else {
                              next.add(agent.id);
                            }
                            return next;
                          });
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                          isSelected ? "bg-[#39147e]/[0.08]" : "hover:bg-white/[0.03]",
                        )}
                      >
                        <div
                          className={cn(
                            "flex size-4 items-center justify-center rounded border text-[10px]",
                            isSelected ? "border-[#5e4ae3] bg-[#39147e] text-white" : "border-white/[0.15]",
                          )}
                        >
                          {isSelected ? "✓" : ""}
                        </div>
                        <div
                          className="flex size-6 items-center justify-center rounded-full text-[10px]"
                          style={{ backgroundColor: `${agent.color}44`, color: "#fff" }}
                        >
                          {agent.avatarText}
                        </div>
                        <span className="text-[12px] text-white">{agent.name}</span>
                        <span className="ml-auto text-[10px] text-[#585658]">{agent.engineLabel}</span>
                        {agent.id === leadAgentId ? <span className="rounded bg-[#39147e]/20 px-1.5 py-0.5 text-[9px] font-medium text-[#c6bfff]">Lead</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/[0.08] px-4 py-2 text-[12px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            onClick={() => void onCreate()}
            className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[12px] font-medium text-white"
          >
            Create Mission
          </button>
        </div>
      </div>
    </div>
  );
}

function MilestoneItem({ label, status }: { label: string; status: "completed" | "active" | "pending" }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "size-2.5 rounded-full",
          status === "completed" ? "bg-emerald-400" : status === "active" ? "bg-[#39147e]" : "bg-white/[0.1]",
        )}
      />
      <span className={cn("text-[13px]", status === "completed" ? "text-[#918f90] line-through" : status === "active" ? "text-white" : "text-[#918f90]")}>
        {label}
      </span>
      {status === "active" ? <ChevronRightIcon className="ml-auto size-3.5 text-[#5e4ae3]" /> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
      />
    </div>
  );
}
