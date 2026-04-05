import { useEffect, useMemo, useState, useCallback } from "react";
import { ActivityIcon, CheckIcon, ChevronRightIcon, ClockIcon, GitBranchIcon, PencilIcon, PlusIcon, TrendingUpIcon, UsersIcon, XIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface MissionsDashboardProps {
  mission: MissionControlState;
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

export function MissionsDashboard({ mission }: MissionsDashboardProps) {
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [leadAgentId, setLeadAgentId] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [githubRepo, setGithubRepo] = useState("");
  const [githubDefaultBranch, setGithubDefaultBranch] = useState("main");
  const [repoOptions, setRepoOptions] = useState<Array<{ full_name: string; default_branch: string }>>([]);
  const [repoQuery, setRepoQuery] = useState("");

  // Inline edit state for side panel
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editGithubRepo, setEditGithubRepo] = useState("");
  const [editGithubBranch, setEditGithubBranch] = useState("main");
  const [editRepoQuery, setEditRepoQuery] = useState("");
  const [editRepoOptions, setEditRepoOptions] = useState<Array<{ full_name: string; default_branch: string }>>([]);

  const startEditing = useCallback(() => {
    const sel = mission.missions.find((m) => m.id === selectedMissionId);
    if (!sel) return;
    setEditTitle(sel.title);
    setEditDescription(sel.description || "");
    setEditStatus(sel.status);
    setEditGithubRepo(sel.github_repo || "");
    setEditGithubBranch(sel.github_default_branch || "main");
    setEditRepoQuery(sel.github_repo || "");
    setEditRepoOptions([]);
    setEditing(true);
  }, [mission.missions, selectedMissionId]);

  const cancelEditing = useCallback(() => setEditing(false), []);

  const saveEditing = useCallback(async () => {
    if (!selectedMissionId) return;
    const ok = await mission.updateMission(selectedMissionId, {
      title: editTitle,
      description: editDescription || null,
      status: editStatus,
      github_repo: editGithubRepo || null,
      github_default_branch: editGithubBranch || "main",
    });
    if (ok) setEditing(false);
  }, [selectedMissionId, editTitle, editDescription, editStatus, editGithubRepo, editGithubBranch, mission]);

  const searchRepos = useCallback(
    async (query: string) => {
      const repos = await mission.loadGitHubRepos(query || undefined);
      setRepoOptions(repos.map((r) => ({ full_name: r.full_name, default_branch: r.default_branch })));
    },
    [mission],
  );

  const searchEditRepos = useCallback(
    async (query: string) => {
      const repos = await mission.loadGitHubRepos(query || undefined);
      setEditRepoOptions(repos.map((r) => ({ full_name: r.full_name, default_branch: r.default_branch })));
    },
    [mission],
  );

  useEffect(() => {
    setSelectedMissionId((current) => current ?? mission.missions[0]?.id ?? null);
  }, [mission.missions]);

  const selected = useMemo(
    () => mission.missions.find((entry) => entry.id === selectedMissionId) ?? mission.missions[0] ?? null,
    [mission.missions, selectedMissionId],
  );

  const activeCount = mission.missions.filter((entry) => entry.status === "active").length;
  const issueCount = mission.issues.length;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 grid grid-cols-4 gap-4">
          <StatCard icon={<ActivityIcon className="size-4" />} label="Active Missions" value={activeCount} accent />
          <StatCard icon={<UsersIcon className="size-4" />} label="Total Agents" value={mission.agents.length} subtitle={`${mission.missions.length} staffed missions`} />
          <StatCard icon={<TrendingUpIcon className="size-4" />} label="Open Issues" value={issueCount} />
          <StatCard icon={<ClockIcon className="size-4" />} label="Runs Logged" value={mission.runs.length} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          {mission.missions.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setSelectedMissionId(entry.id)}
              className={cn(
                "rounded-xl border p-4 text-left transition-all",
                selected?.id === entry.id
                  ? "border-[#5e4ae3]/50 bg-[#39147e]/[0.06]"
                  : "border-white/[0.06] bg-[#1c1b1c] hover:border-white/[0.1]",
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", STATUS_COLORS[entry.status] ?? STATUS_COLORS.planning)}>
                  {entry.status}
                </span>
                <span className="text-[12px] text-[#918f90]">{formatRelative(entry.last_active_at)}</span>
              </div>
              <h3 className="text-[14px] font-semibold text-white">{entry.title}</h3>
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
                {entry.assigned_agents.length > 4 && <span className="ml-1 text-[11px] text-[#918f90]">+{entry.assigned_agents.length - 4}</span>}
              </div>
            </button>
          ))}

          <button
            onClick={() => setDraftOpen(true)}
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-transparent p-4 text-[#918f90] transition-colors hover:border-[#5e4ae3]/40 hover:text-[#c6bfff]"
          >
            <PlusIcon className="mb-2 size-6" />
            <span className="text-[13px] font-medium">New Mission</span>
          </button>
        </div>
      </div>

      {selected ? (
        <div className="w-[340px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
          {editing ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#585658]">Editing Mission</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => void saveEditing()} className="rounded-lg p-1.5 text-emerald-400 hover:bg-emerald-500/10" title="Save">
                    <CheckIcon className="size-3.5" />
                  </button>
                  <button onClick={cancelEditing} className="rounded-lg p-1.5 text-[#918f90] hover:bg-white/[0.06] hover:text-white" title="Cancel">
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              </div>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mb-3 w-full border-none bg-transparent text-[15px] font-semibold text-white outline-none placeholder:text-[#585658]"
                placeholder="Mission title..."
              />
              <div className="mb-4">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Status</label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["planning", "active", "paused", "complete"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mb-4">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="h-24 w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none focus:border-[#5e4ae3]/50"
                  placeholder="Mission description..."
                />
              </div>
              <div className="mb-4">
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">GitHub Repository</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editRepoQuery}
                      onChange={(e) => setEditRepoQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (mission.settingsMap.github_pat) { void searchEditRepos(editRepoQuery); }
                          else if (editRepoQuery.includes("/")) { setEditGithubRepo(editRepoQuery); }
                        }
                      }}
                      placeholder={mission.settingsMap.github_pat ? "Search repos..." : "owner/repo (e.g. acme/my-app)"}
                      className="flex-1 rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
                    />
                    {mission.settingsMap.github_pat ? (
                      <button type="button" onClick={() => void searchEditRepos(editRepoQuery)} className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]">
                        Search
                      </button>
                    ) : editRepoQuery.includes("/") && editRepoQuery !== editGithubRepo ? (
                      <button type="button" onClick={() => setEditGithubRepo(editRepoQuery)} className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]">
                        Set
                      </button>
                    ) : null}
                  </div>
                  {editRepoOptions.length > 0 ? (
                    <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#0f0f10]">
                      {editRepoOptions.map((repo) => (
                        <button
                          key={repo.full_name}
                          type="button"
                          onClick={() => { setEditGithubRepo(repo.full_name); setEditGithubBranch(repo.default_branch); setEditRepoOptions([]); setEditRepoQuery(repo.full_name); }}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.03]",
                            editGithubRepo === repo.full_name ? "bg-[#39147e]/[0.08] text-white" : "text-[#c8c4d7]",
                          )}
                        >
                          <GitBranchIcon className="size-3.5 text-[#918f90]" />
                          {repo.full_name}
                          <span className="ml-auto text-[10px] text-[#585658]">{repo.default_branch}</span>
                        </button>
                      ))}
                    </div>
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
              <button
                onClick={() => void saveEditing()}
                className="w-full rounded-lg bg-[#39147e] px-4 py-2 text-[13px] font-medium text-white transition-all hover:bg-[#7c3aed]"
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
                  className="flex-1 rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[13px] font-medium text-white"
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
      ) : null}

      {!draftOpen ? (
        <button
          onClick={() => setDraftOpen(true)}
          className="fixed bottom-6 right-6 z-20 flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-[#39147e] to-[#2e1065] shadow-lg shadow-[#2e1065]/25 transition-transform hover:scale-105"
        >
          <PlusIcon className="size-5 text-white" />
        </button>
      ) : null}

      {draftOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
              <h2 className="text-[14px] font-semibold text-white">New Mission</h2>
              <button onClick={() => setDraftOpen(false)} className="rounded-lg p-1 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white">
                <XIcon className="size-4" />
              </button>
            </div>
            <div className="p-5">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Title" value={title} onChange={setTitle} placeholder="Ship MissionOS backend" />
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Lead Agent</label>
                    <Select
                      value={leadAgentId}
                      onValueChange={(raw) => {
                        const value = raw ?? "";
                        setLeadAgentId(value);
                        if (value) {
                          setSelectedAgentIds((prev) => new Set(prev).add(value));
                        }
                      }}
                    >
                      <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                        <SelectValue placeholder="Select lead agent" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Select lead agent</SelectItem>
                        {mission.agents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            {agent.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={repoQuery}
                        onChange={(event) => setRepoQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            if (mission.settingsMap.github_pat) { void searchRepos(repoQuery); }
                            else if (repoQuery.includes("/")) { setGithubRepo(repoQuery); }
                          }
                        }}
                        placeholder={mission.settingsMap.github_pat ? "Search repos..." : "owner/repo (e.g. acme/my-app)"}
                        className="flex-1 rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
                      />
                      {mission.settingsMap.github_pat ? (
                        <button
                          type="button"
                          onClick={() => void searchRepos(repoQuery)}
                          className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                        >
                          Search
                        </button>
                      ) : repoQuery.includes("/") && repoQuery !== githubRepo ? (
                        <button
                          type="button"
                          onClick={() => setGithubRepo(repoQuery)}
                          className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                        >
                          Set
                        </button>
                      ) : null}
                    </div>
                    {repoOptions.length > 0 ? (
                      <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#0f0f10]">
                        {repoOptions.map((repo) => (
                          <button
                            key={repo.full_name}
                            type="button"
                            onClick={() => {
                              setGithubRepo(repo.full_name);
                              setGithubDefaultBranch(repo.default_branch);
                              setRepoOptions([]);
                              setRepoQuery(repo.full_name);
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
                        ))}
                      </div>
                    ) : null}
                    {githubRepo ? (
                      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-emerald-400">
                        <GitBranchIcon className="size-3" />
                        {githubRepo}
                        <button type="button" onClick={() => { setGithubRepo(""); setRepoQuery(""); }} className="ml-1 text-[#918f90] hover:text-white">
                          <XIcon className="size-3" />
                        </button>
                      </div>
                    ) : null}
                  </div>

                {mission.agents.length > 0 ? (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">
                      Assign Agents
                      {selectedAgentIds.size > 0 ? <span className="ml-1.5 normal-case tracking-normal text-[#585658]">({selectedAgentIds.size} selected)</span> : null}
                    </label>
                    <div className="max-h-36 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#0f0f10]">
                      {mission.derivedAgents.map((agent) => {
                        const isSelected = selectedAgentIds.has(agent.id);
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => {
                              setSelectedAgentIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(agent.id)) next.delete(agent.id);
                                else next.add(agent.id);
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
                onClick={() => setDraftOpen(false)}
                className="rounded-lg border border-white/[0.08] px-4 py-2 text-[12px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const result = await mission.createMission({
                    title,
                    description,
                    lead_agent_id: leadAgentId || null,
                    github_repo: githubRepo || null,
                    github_default_branch: githubDefaultBranch || "main",
                  });
                  if (result) {
                    // Assign additional agents beyond the lead
                    for (const agentId of selectedAgentIds) {
                      if (agentId !== leadAgentId) {
                        await mission.assignMissionAgent(result.id, agentId);
                      }
                    }
                    setTitle("");
                    setDescription("");
                    setLeadAgentId("");
                    setSelectedAgentIds(new Set());
                    setGithubRepo("");
                    setGithubDefaultBranch("main");
                    setRepoQuery("");
                    setRepoOptions([]);
                    setDraftOpen(false);
                  }
                }}
                className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[12px] font-medium text-white"
              >
                Create Mission
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ icon, label, value, subtitle, accent }: { icon: React.ReactNode; label: string; value: string | number; subtitle?: string; accent?: boolean }) {
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

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
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
