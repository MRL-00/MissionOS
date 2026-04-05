import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLinkIcon, GitBranchIcon, GitPullRequestIcon, MaximizeIcon, MessageSquareIcon, MinimizeIcon, PencilIcon, PlusIcon, RefreshCwIcon, ShareIcon, Trash2Icon, XIcon } from "lucide-react";
import type { IssueRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";
import { Select as UISelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface IssuesBoardProps {
  mission: MissionControlState;
}

const COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "Todo" },
  { id: "in progress", label: "In Progress" },
  { id: "in review", label: "In Review" },
  { id: "done", label: "Done" },
];

const PRIORITY_INDICATORS: Record<string, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-400",
  none: "border-l-transparent",
};

export function IssuesBoard({ mission }: IssuesBoardProps) {
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [boardMode, setBoardMode] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [missionFilter, setMissionFilter] = useState("");
  const [newComment, setNewComment] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);

  // Edit modal state
  const [editingIssue, setEditingIssue] = useState<IssueRecord | null>(null);
  const [editFullScreen, setEditFullScreen] = useState(false);
  const [editDraft, setEditDraft] = useState({ title: "", description: "", status: "backlog", priority: "medium", assignee_agent_id: "", mission_id: "", labels: "", github_repo: "" });
  const [editRepoQuery, setEditRepoQuery] = useState("");
  const [editRepoOptions, setEditRepoOptions] = useState<Array<{ full_name: string; default_branch: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Create modal state
  const [draft, setDraft] = useState({ title: "", description: "", status: "backlog", priority: "medium", assignee_agent_id: "", mission_id: "", github_repo: "" });
  const [createRepoQuery, setCreateRepoQuery] = useState("");
  const [createRepoOptions, setCreateRepoOptions] = useState<Array<{ full_name: string; default_branch: string }>>([]);

  const openEditModal = useCallback((issue: IssueRecord) => {
    setEditingIssue(issue);
    setEditDraft({
      title: issue.title,
      description: issue.description || "",
      status: issue.status,
      priority: issue.priority,
      assignee_agent_id: issue.assignee_agent_id || "",
      mission_id: issue.mission_id || "",
      labels: issue.labels.join(", "),
      github_repo: issue.github_repo || "",
    });
    setEditRepoQuery(issue.github_repo || "");
    setEditRepoOptions([]);
    setEditFullScreen(false);
    setConfirmDelete(false);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditingIssue(null);
    setConfirmDelete(false);
  }, []);

  const searchRepos = useCallback(
    async (query: string, target: "edit" | "create") => {
      const repos = await mission.loadGitHubRepos(query || undefined);
      const mapped = repos.map((r) => ({ full_name: r.full_name, default_branch: r.default_branch }));
      if (target === "edit") setEditRepoOptions(mapped);
      else setCreateRepoOptions(mapped);
    },
    [mission],
  );

  useEffect(() => {
    setSelectedIssueId((current) => current ?? mission.issues[0]?.id ?? null);
  }, [mission.issues]);

  const filteredIssues = useMemo(
    () =>
      mission.issues.filter((issue) => {
        if (search && !`${issue.title} ${issue.description ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
        if (statusFilter && issue.status !== statusFilter) return false;
        if (priorityFilter && issue.priority !== priorityFilter) return false;
        if (assigneeFilter && issue.assignee_agent_id !== assigneeFilter) return false;
        if (missionFilter && issue.mission_id !== missionFilter) return false;
        return true;
      }),
    [assigneeFilter, mission.issues, missionFilter, priorityFilter, search, statusFilter],
  );

  const selectedIssue = filteredIssues.find((issue) => issue.id === selectedIssueId) ?? mission.issues.find((issue) => issue.id === selectedIssueId) ?? null;

  useEffect(() => {
    if (selectedIssue) {
      void mission.loadIssueComments(selectedIssue.id);
    }
  }, [selectedIssue?.id]);

  const getInheritedRepo = useCallback(
    (missionId: string | null) => {
      if (!missionId) return null;
      return mission.missions.find((m) => m.id === missionId)?.github_repo ?? null;
    },
    [mission.missions],
  );

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col">
        <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0f0f10] px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search issues..."
              className="h-9 w-64 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 text-[13px] text-white outline-none placeholder:text-[#918f90]"
            />
            <Filter value={statusFilter} onChange={setStatusFilter} options={["", ...COLUMNS.map((entry) => entry.id)]} label="Status" />
            <Filter value={priorityFilter} onChange={setPriorityFilter} options={["", "urgent", "high", "medium", "low"]} label="Priority" />
            <Filter value={assigneeFilter} onChange={setAssigneeFilter} options={["", ...mission.agents.map((entry) => entry.id)]} label="Assignee" lookup={Object.fromEntries(mission.agents.map((entry) => [entry.id, entry.name]))} />
            <Filter value={missionFilter} onChange={setMissionFilter} options={["", ...mission.missions.map((entry) => entry.id)]} label="Mission" lookup={Object.fromEntries(mission.missions.map((entry) => [entry.id, entry.title]))} />
            <button
              onClick={() => setBoardMode((current) => !current)}
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
            >
              {boardMode ? "Switch to List" : "Switch to Board"}
            </button>
            <button
              onClick={() => setDraftOpen((current) => !current)}
              className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            >
              New Issue
            </button>
            {mission.settingsMap.linear_api_key ? (
              <button
                onClick={() => void mission.syncLinear()}
                className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
              >
                Sync with Linear
              </button>
            ) : null}
            {mission.settingsMap.github_pat && missionFilter ? (() => {
              const linkedMission = mission.missions.find((m) => m.id === missionFilter);
              return linkedMission?.github_repo ? (
                <button
                  onClick={() => void mission.syncGitHub(missionFilter)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                >
                  <RefreshCwIcon className="size-3" />
                  Sync GitHub Issues
                </button>
              ) : null;
            })() : null}
          </div>
        </div>

        {/* New Issue Modal */}
        {draftOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
                <h2 className="text-[14px] font-semibold text-white">New Issue</h2>
                <button onClick={() => setDraftOpen(false)} className="rounded-lg p-1 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white">
                  <XIcon className="size-4" />
                </button>
              </div>
              <div className="space-y-4 px-5 py-5">
                <Field label="Title" value={draft.title} onChange={(value) => setDraft({ ...draft, title: value })} />
                <div className="grid grid-cols-2 gap-3">
                  <FormSelect label="Status" value={draft.status} onChange={(value) => setDraft({ ...draft, status: value })} options={COLUMNS.map((entry) => entry.id)} />
                  <FormSelect label="Priority" value={draft.priority} onChange={(value) => setDraft({ ...draft, priority: value })} options={["urgent", "high", "medium", "low"]} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormSelect label="Assignee" value={draft.assignee_agent_id} onChange={(value) => setDraft({ ...draft, assignee_agent_id: value })} options={["", ...mission.agents.map((entry) => entry.id)]} lookup={Object.fromEntries(mission.agents.map((entry) => [entry.id, entry.name]))} />
                  <FormSelect label="Mission" value={draft.mission_id} onChange={(value) => setDraft({ ...draft, mission_id: value })} options={["", ...mission.missions.map((entry) => entry.id)]} lookup={Object.fromEntries(mission.missions.map((entry) => [entry.id, entry.title]))} />
                </div>
                <RepoSearchField
                    label="GitHub Repository"
                    value={draft.github_repo}
                    query={createRepoQuery}
                    options={createRepoOptions}
                    inheritedRepo={getInheritedRepo(draft.mission_id || null)}
                    hasGitHubPat={!!mission.settingsMap.github_pat}
                    onQueryChange={setCreateRepoQuery}
                    onSearch={(q) => void searchRepos(q, "create")}
                    onSelect={(repo) => { setDraft({ ...draft, github_repo: repo }); setCreateRepoQuery(repo); setCreateRepoOptions([]); }}
                    onClear={() => { setDraft({ ...draft, github_repo: "" }); setCreateRepoQuery(""); }}
                  />
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Description</label>
                  <textarea
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    className="h-28 w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[#585658] focus:border-[#5e4ae3]/50"
                    placeholder="Describe the issue..."
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
                <button className="rounded-lg border border-white/[0.08] px-4 py-1.5 text-[12px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white" onClick={() => setDraftOpen(false)}>
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const ok = await mission.createIssue({
                      ...draft,
                      assignee_agent_id: draft.assignee_agent_id || null,
                      mission_id: draft.mission_id || null,
                      github_repo: draft.github_repo || null,
                      labels: [],
                    });
                    if (ok) {
                      setDraft({ title: "", description: "", status: "backlog", priority: "medium", assignee_agent_id: "", mission_id: "", github_repo: "" });
                      setCreateRepoQuery("");
                      setCreateRepoOptions([]);
                      setDraftOpen(false);
                    }
                  }}
                  className="rounded-lg bg-[#39147e] px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-[#2e1065]/25 transition-all hover:bg-[#7c3aed]"
                >
                  Create Issue
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Edit Issue Modal */}
        {editingIssue ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
              className={cn(
                "flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50 transition-all duration-200",
                editFullScreen ? "fixed inset-4 z-50 max-h-none w-auto max-w-none" : "w-full max-w-2xl max-h-[85vh]",
              )}
            >
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <h2 className="text-[14px] font-semibold text-white">Edit Issue</h2>
                  <span className="text-[11px] font-medium text-[#585658]">{editingIssue.id.slice(0, 8).toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditFullScreen((v) => !v)}
                    className="rounded-lg p-1.5 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white"
                    title={editFullScreen ? "Minimize" : "Full screen"}
                  >
                    {editFullScreen ? <MinimizeIcon className="size-3.5" /> : <MaximizeIcon className="size-3.5" />}
                  </button>
                  <button onClick={closeEditModal} className="rounded-lg p-1.5 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white">
                    <XIcon className="size-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-5">
                <div className="space-y-4">
                  <div>
                    <input
                      value={editDraft.title}
                      onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                      className="w-full border-none bg-transparent text-[18px] font-semibold text-white outline-none placeholder:text-[#585658]"
                      placeholder="Issue title..."
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Description</label>
                    <textarea
                      value={editDraft.description}
                      onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                      className={cn(
                        "w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] leading-relaxed text-white outline-none placeholder:text-[#585658] focus:border-[#5e4ae3]/50",
                        editFullScreen ? "h-48" : "h-28",
                      )}
                      placeholder="Describe the issue..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormSelect label="Status" value={editDraft.status} onChange={(value) => setEditDraft({ ...editDraft, status: value })} options={COLUMNS.map((entry) => entry.id)} />
                    <FormSelect label="Priority" value={editDraft.priority} onChange={(value) => setEditDraft({ ...editDraft, priority: value })} options={["urgent", "high", "medium", "low"]} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormSelect label="Assignee" value={editDraft.assignee_agent_id} onChange={(value) => setEditDraft({ ...editDraft, assignee_agent_id: value })} options={["", ...mission.agents.map((entry) => entry.id)]} lookup={Object.fromEntries(mission.agents.map((entry) => [entry.id, entry.name]))} />
                    <FormSelect label="Mission" value={editDraft.mission_id} onChange={(value) => setEditDraft({ ...editDraft, mission_id: value })} options={["", ...mission.missions.map((entry) => entry.id)]} lookup={Object.fromEntries(mission.missions.map((entry) => [entry.id, entry.title]))} />
                  </div>
                  <Field label="Labels" value={editDraft.labels} onChange={(value) => setEditDraft({ ...editDraft, labels: value })} placeholder="bug, frontend, urgent (comma-separated)" />
                  <RepoSearchField
                      label="GitHub Repository"
                      value={editDraft.github_repo}
                      query={editRepoQuery}
                      options={editRepoOptions}
                      inheritedRepo={getInheritedRepo(editDraft.mission_id || null)}
                      hasGitHubPat={!!mission.settingsMap.github_pat}
                      onQueryChange={setEditRepoQuery}
                      onSearch={(q) => void searchRepos(q, "edit")}
                      onSelect={(repo) => { setEditDraft({ ...editDraft, github_repo: repo }); setEditRepoQuery(repo); setEditRepoOptions([]); }}
                      onClear={() => { setEditDraft({ ...editDraft, github_repo: "" }); setEditRepoQuery(""); }}
                    />

                  {(editingIssue.github_pr_url || editingIssue.github_branch) ? (
                    <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">GitHub Metadata</div>
                      {editingIssue.github_branch ? (
                        <div className="flex items-center gap-1.5 text-[12px] text-[#c8c4d7]">
                          <GitBranchIcon className="size-3 text-[#918f90]" />
                          <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px]">{editingIssue.github_branch}</code>
                        </div>
                      ) : null}
                      {editingIssue.github_pr_url ? (
                        <a href={editingIssue.github_pr_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[12px] text-[#5e4ae3] hover:text-[#c6bfff]">
                          <GitPullRequestIcon className="size-3" />
                          PR #{editingIssue.github_pr_number}
                          <ExternalLinkIcon className="size-3" />
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3.5">
                <div>
                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-red-400">Delete this issue?</span>
                      <button
                        onClick={async () => {
                          await mission.removeIssue(editingIssue.id);
                          closeEditModal();
                          setSelectedIssueId(null);
                        }}
                        className="rounded-lg bg-red-500/20 px-3 py-1 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/30"
                      >
                        Confirm
                      </button>
                      <button onClick={() => setConfirmDelete(false)} className="text-[12px] text-[#918f90] hover:text-white">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-[#918f90] transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2Icon className="size-3" />
                      Delete
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button className="rounded-lg border border-white/[0.08] px-4 py-1.5 text-[12px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white" onClick={closeEditModal}>
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const labels = editDraft.labels.split(",").map((l) => l.trim()).filter(Boolean);
                      const ok = await mission.updateIssue(editingIssue.id, {
                        title: editDraft.title,
                        description: editDraft.description || null,
                        status: editDraft.status,
                        priority: editDraft.priority,
                        assignee_agent_id: editDraft.assignee_agent_id || null,
                        mission_id: editDraft.mission_id || null,
                        github_repo: editDraft.github_repo || null,
                        labels,
                      });
                      if (ok) closeEditModal();
                    }}
                    className="rounded-lg bg-[#39147e] px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-[#2e1065]/25 transition-all hover:bg-[#7c3aed]"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {boardMode ? (
          <div className="flex flex-1 gap-4 overflow-x-auto p-6">
            {COLUMNS.map((column) => {
              const issues = filteredIssues.filter((issue) => issue.status === column.id);
              return (
                <div
                  key={column.id}
                  className="flex w-[260px] shrink-0 flex-col"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const issueId = event.dataTransfer.getData("text/plain");
                    const issue = mission.issues.find((entry) => entry.id === issueId);
                    if (!issue) {
                      return;
                    }
                    void mission.updateIssue(issue.id, { ...issue, status: column.id, labels: issue.labels });
                  }}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-white">{column.label}</span>
                      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[#918f90]">{issues.length}</span>
                    </div>
                    <button className="rounded p-0.5 text-[#918f90] hover:text-white">
                      <PlusIcon className="size-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    {issues.map((issue) => (
                      <button
                        key={issue.id}
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData("text/plain", issue.id)}
                        onClick={() => setSelectedIssueId(issue.id)}
                        onDoubleClick={() => openEditModal(issue)}
                        className={cn(
                          "rounded-lg border-l-2 border border-white/[0.06] bg-[#1c1b1c] p-3 text-left transition-all",
                          PRIORITY_INDICATORS[issue.priority] ?? PRIORITY_INDICATORS.none,
                          selectedIssue?.id === issue.id && "border-[#5e4ae3]/50 bg-[#39147e]/[0.06] shadow-[0_0_0_1px_rgba(94,74,227,0.3)]",
                        )}
                      >
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-[#918f90]">{issue.id.slice(0, 8).toUpperCase()}</span>
                          {issue.source === "github" || issue.github_number ? (
                            <span className="rounded bg-[#1c1b1c] px-1 py-0.5 text-[9px] font-medium text-[#918f90]">GH#{issue.github_number}</span>
                          ) : null}
                          {issue.github_pr_url ? (
                            <a href={issue.github_pr_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[#5e4ae3] hover:text-[#c6bfff]">
                              <GitPullRequestIcon className="size-3" />
                            </a>
                          ) : null}
                        </div>
                        <div className="text-[13px] font-medium leading-snug text-white">{issue.title}</div>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex gap-1">
                            {issue.labels.map((label) => (
                              <span key={label} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#918f90]">
                                {label}
                              </span>
                            ))}
                          </div>
                          {issue.assignee_emoji ? (
                            <div className="flex size-5 items-center justify-center rounded-full bg-gradient-to-br from-[#39147e] to-[#2e1065] text-[9px] font-semibold text-white">
                              {issue.assignee_emoji}
                            </div>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="overflow-hidden rounded-xl border border-white/[0.06]">
              <div className="grid grid-cols-[100px_2fr_120px_140px_1fr_140px] gap-4 border-b border-white/[0.06] bg-[#1c1b1c] px-4 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Priority</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Title</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Status</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Assignee</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Mission</span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Created</span>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {filteredIssues.map((issue) => (
                  <button
                    key={issue.id}
                    onClick={() => setSelectedIssueId(issue.id)}
                    onDoubleClick={() => openEditModal(issue)}
                    className={cn(
                      "grid w-full grid-cols-[100px_2fr_120px_140px_1fr_140px] gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]",
                      selectedIssue?.id === issue.id && "bg-[#39147e]/[0.06]",
                    )}
                  >
                    <span><PriorityBadge priority={issue.priority} /></span>
                    <span className="text-[13px] font-medium text-white">{issue.title}</span>
                    <span><StatusBadge status={issue.status} /></span>
                    <span className="text-[12px] text-[#c8c4d7]">{issue.assignee_name || "Unassigned"}</span>
                    <span className="text-[12px] text-[#918f90]">{issue.mission_title || "None"}</span>
                    <span className="text-[12px] text-[#918f90]">{new Date(issue.created_at).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedIssue ? (
        <div className="w-[360px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#918f90]">{selectedIssue.id.slice(0, 8).toUpperCase()}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => openEditModal(selectedIssue)}
                className="rounded-lg p-1 text-[#918f90] hover:bg-white/[0.06] hover:text-white"
                title="Edit issue"
              >
                <PencilIcon className="size-3.5" />
              </button>
              <button onClick={() => setSelectedIssueId(null)} className="rounded-lg p-1 text-[#918f90] hover:bg-white/[0.06] hover:text-white">
                <XIcon className="size-4" />
              </button>
            </div>
          </div>
          <button
            onClick={() => openEditModal(selectedIssue)}
            className="mb-4 text-left text-[16px] font-semibold text-white transition-colors hover:text-[#c6bfff]"
          >
            {selectedIssue.title}
          </button>

          <div className="mb-5 text-[13px] leading-relaxed text-[#918f90]">
            {selectedIssue.description || "No description for this issue yet."}
          </div>

          <div className="mb-5 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Properties</div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[#918f90]">Status</span>
              <StatusBadge status={selectedIssue.status} />
            </div>
            <PropertyRow label="Assignee" value={selectedIssue.assignee_name || "Unassigned"} />
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[#918f90]">Priority</span>
              <PriorityBadge priority={selectedIssue.priority} />
            </div>
            <PropertyRow label="Labels" value={selectedIssue.labels.join(", ") || "None"} />
          </div>

          {(selectedIssue.github_repo || selectedIssue.github_pr_url || selectedIssue.github_branch) ? (
            <div className="mb-5 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">GitHub</div>
              {selectedIssue.github_repo ? (
                <div className="flex items-center gap-1.5 text-[12px] text-[#c8c4d7]">
                  <GitBranchIcon className="size-3" />
                  {selectedIssue.github_repo}
                  {selectedIssue.github_number ? <span className="text-[#918f90]">#{selectedIssue.github_number}</span> : null}
                </div>
              ) : null}
              {selectedIssue.github_branch ? (
                <div className="flex items-center gap-1.5 text-[12px] text-[#c8c4d7]">
                  <GitBranchIcon className="size-3 text-[#918f90]" />
                  <code className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px]">{selectedIssue.github_branch}</code>
                </div>
              ) : null}
              {selectedIssue.github_pr_url ? (
                <a href={selectedIssue.github_pr_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[12px] text-[#5e4ae3] hover:text-[#c6bfff]">
                  <GitPullRequestIcon className="size-3" />
                  PR #{selectedIssue.github_pr_number}
                  <ExternalLinkIcon className="size-3" />
                </a>
              ) : null}
            </div>
          ) : null}

          <div className="mb-5 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Metadata</div>
            <div className="text-[12px] text-[#918f90]">Created: {new Date(selectedIssue.created_at).toLocaleString()}</div>
            <div className="text-[12px] text-[#918f90]">Updated: {new Date(selectedIssue.updated_at).toLocaleString()}</div>
          </div>

          <div className="mb-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Comments</div>
            <div className="space-y-2">
              {mission.selectedIssueComments.map((comment) => (
                <div key={comment.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <div className="text-[11px] text-[#918f90]">
                    {comment.author_emoji} {comment.author_name || "Unknown"} • {new Date(comment.created_at).toLocaleString()}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-[12px] text-[#c8c4d7]">{comment.body}</div>
                </div>
              ))}
            </div>
            <textarea
              value={newComment}
              onChange={(event) => setNewComment(event.target.value)}
              placeholder="Add a comment..."
              className="mt-3 h-24 w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (!newComment.trim()) {
                  return;
                }
                const ok = await mission.addIssueComment(selectedIssue.id, { body: newComment });
                if (ok) {
                  setNewComment("");
                }
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] py-2.5 text-[13px] font-medium text-white"
            >
              <MessageSquareIcon className="size-3.5" />
              Post Comment
            </button>
            <button
              onClick={() => void mission.updateIssue(selectedIssue.id, { ...selectedIssue, status: selectedIssue.status === "done" ? "todo" : "done", labels: selectedIssue.labels })}
              className="flex items-center justify-center rounded-lg border border-white/[0.08] p-2.5 text-[#918f90] transition-colors hover:bg-white/[0.04]"
            >
              <ShareIcon className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {!draftOpen && !editingIssue ? (
        <button
          onClick={() => setDraftOpen(true)}
          className="fixed bottom-6 right-6 z-20 flex size-12 items-center justify-center rounded-full bg-[#39147e] shadow-lg shadow-[#2e1065]/25 transition-transform hover:scale-105"
        >
          <PlusIcon className="size-5 text-white" />
        </button>
      ) : null}
    </div>
  );
}

function RepoSearchField({
  label,
  value,
  query,
  options,
  inheritedRepo,
  hasGitHubPat,
  onQueryChange,
  onSearch,
  onSelect,
  onClear,
}: {
  label: string;
  value: string;
  query: string;
  options: Array<{ full_name: string; default_branch: string }>;
  inheritedRepo: string | null;
  hasGitHubPat: boolean;
  onQueryChange: (q: string) => void;
  onSearch: (q: string) => void;
  onSelect: (repo: string) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">
        {label}
        {inheritedRepo && !value ? (
          <span className="ml-1.5 normal-case tracking-normal text-[#585658]">(inherited: {inheritedRepo})</span>
        ) : null}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (hasGitHubPat) { onSearch(query); }
              else if (query.includes("/")) { onSelect(query); }
            }
          }}
          placeholder={hasGitHubPat ? "Search repos..." : "owner/repo (e.g. acme/my-app)"}
          className="flex-1 rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
        />
        {hasGitHubPat ? (
          <button type="button" onClick={() => onSearch(query)} className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]">
            Search
          </button>
        ) : query.includes("/") && query !== value ? (
          <button type="button" onClick={() => onSelect(query)} className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]">
            Set
          </button>
        ) : null}
      </div>
      {options.length > 0 ? (
        <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#0f0f10]">
          {options.map((repo) => (
            <button
              key={repo.full_name}
              type="button"
              onClick={() => onSelect(repo.full_name)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-white/[0.03]",
                value === repo.full_name ? "bg-[#39147e]/[0.08] text-white" : "text-[#c8c4d7]",
              )}
            >
              <GitBranchIcon className="size-3.5 text-[#918f90]" />
              {repo.full_name}
              <span className="ml-auto text-[10px] text-[#585658]">{repo.default_branch}</span>
            </button>
          ))}
        </div>
      ) : null}
      {value ? (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-emerald-400">
          <GitBranchIcon className="size-3" />
          {value}
          <button type="button" onClick={onClear} className="ml-1 text-[#918f90] hover:text-white">
            <XIcon className="size-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-400 border-red-500/20",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  medium: "bg-yellow-500/15 text-yellow-300 border-yellow-500/20",
  low: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

const STATUS_BADGE: Record<string, string> = {
  backlog: "bg-white/[0.06] text-[#918f90] border-white/[0.08]",
  todo: "bg-white/[0.08] text-[#c8c4d7] border-white/[0.1]",
  "in progress": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "in review": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  done: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", PRIORITY_BADGE[priority] ?? PRIORITY_BADGE.medium)}>
      {priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_BADGE[status] ?? STATUS_BADGE.backlog)}>
      {status}
    </span>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-[#918f90]">{label}</span>
      <span className="text-[12px] capitalize text-[#c8c4d7]">{value}</span>
    </div>
  );
}

function Filter({
  value,
  onChange,
  options,
  label,
  lookup,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label: string;
  lookup?: Record<string, string>;
}) {
  return (
    <UISelect value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-9 border-white/[0.06] bg-white/[0.03] text-[12px] text-[#c8c4d7]">
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
    </UISelect>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">{label}</label>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none" />
    </div>
  );
}

function FormSelect({
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
  const displayValue = value ? (lookup?.[value] ?? value) || "None" : "None";
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">{label}</label>
      <UISelect value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
          <SelectValue placeholder="None">{displayValue}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {(lookup?.[option] ?? option) || "None"}
            </SelectItem>
          ))}
        </SelectContent>
      </UISelect>
    </div>
  );
}
