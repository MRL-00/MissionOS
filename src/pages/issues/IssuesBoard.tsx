import { useCallback, useEffect, useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import type { IssueRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import {
  IssueBoardView,
  IssueCreateModal,
  IssueDetailsPanel,
  IssueEditModal,
  IssueFiltersBar,
  IssueListView,
  type IssueCreateDraft,
  type IssueEditDraft,
  type RepoOption,
} from "@/components/IssueBoardParts";

interface IssuesBoardProps {
  mission: MissionControlState;
}

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
  const [editDraft, setEditDraft] = useState<IssueEditDraft>({ title: "", description: "", status: "backlog", priority: "medium", assignee_agent_id: "", mission_id: "", labels: "", github_repo: "" });
  const [editRepoQuery, setEditRepoQuery] = useState("");
  const [editRepoOptions, setEditRepoOptions] = useState<RepoOption[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Create modal state
  const [draft, setDraft] = useState<IssueCreateDraft>({ title: "", description: "", status: "backlog", priority: "medium", assignee_agent_id: "", mission_id: "", github_repo: "" });
  const [createRepoQuery, setCreateRepoQuery] = useState("");
  const [createRepoOptions, setCreateRepoOptions] = useState<RepoOption[]>([]);

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

  const handleCreateIssue = useCallback(async () => {
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
  }, [draft, mission]);

  const handleDeleteIssue = useCallback(async () => {
    if (!editingIssue) {
      return;
    }

    await mission.removeIssue(editingIssue.id);
    closeEditModal();
    setSelectedIssueId(null);
  }, [closeEditModal, editingIssue, mission]);

  const handleSaveEditIssue = useCallback(async () => {
    if (!editingIssue) {
      return;
    }

    const labels = editDraft.labels.split(",").map((label) => label.trim()).filter(Boolean);
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

    if (ok) {
      closeEditModal();
    }
  }, [closeEditModal, editDraft, editingIssue, mission]);

  const handlePostComment = useCallback(async () => {
    if (!selectedIssue || !newComment.trim()) {
      return;
    }

    const ok = await mission.addIssueComment(selectedIssue.id, { body: newComment });
    if (ok) {
      setNewComment("");
    }
  }, [mission, newComment, selectedIssue]);

  const handleToggleIssueStatus = useCallback(() => {
    if (!selectedIssue) {
      return;
    }

    void mission.updateIssue(selectedIssue.id, {
      ...selectedIssue,
      status: selectedIssue.status === "done" ? "todo" : "done",
      labels: selectedIssue.labels,
    });
  }, [mission, selectedIssue]);

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col">
        <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0f0f10] px-6 py-4">
          <IssueFiltersBar
            mission={mission}
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            assigneeFilter={assigneeFilter}
            onAssigneeFilterChange={setAssigneeFilter}
            missionFilter={missionFilter}
            onMissionFilterChange={setMissionFilter}
            boardMode={boardMode}
            onToggleBoardMode={() => setBoardMode((current) => !current)}
            onOpenCreate={() => setDraftOpen(true)}
          />
        </div>

        <IssueCreateModal
          open={draftOpen}
          mission={mission}
          draft={draft}
          setDraft={setDraft}
          createRepoQuery={createRepoQuery}
          setCreateRepoQuery={setCreateRepoQuery}
          createRepoOptions={createRepoOptions}
          onSearchRepos={(query) => void searchRepos(query, "create")}
          getInheritedRepo={getInheritedRepo}
          onClose={() => setDraftOpen(false)}
          onCreate={handleCreateIssue}
        />
        <IssueEditModal
          mission={mission}
          editingIssue={editingIssue}
          editFullScreen={editFullScreen}
          setEditFullScreen={setEditFullScreen}
          editDraft={editDraft}
          setEditDraft={setEditDraft}
          editRepoQuery={editRepoQuery}
          setEditRepoQuery={setEditRepoQuery}
          editRepoOptions={editRepoOptions}
          onSearchRepos={(query) => void searchRepos(query, "edit")}
          getInheritedRepo={getInheritedRepo}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          onClose={closeEditModal}
          onDelete={handleDeleteIssue}
          onSave={handleSaveEditIssue}
        />

        {boardMode ? (
          <IssueBoardView
            mission={mission}
            filteredIssues={filteredIssues}
            selectedIssueId={selectedIssue?.id ?? selectedIssueId}
            onSelectIssue={setSelectedIssueId}
            onEditIssue={openEditModal}
          />
        ) : (
          <IssueListView
            filteredIssues={filteredIssues}
            selectedIssueId={selectedIssue?.id ?? selectedIssueId}
            onSelectIssue={setSelectedIssueId}
            onEditIssue={openEditModal}
          />
        )}
      </div>

      <IssueDetailsPanel
        selectedIssue={selectedIssue}
        comments={mission.selectedIssueComments}
        newComment={newComment}
        onNewCommentChange={setNewComment}
        onEditIssue={openEditModal}
        onClose={() => setSelectedIssueId(null)}
        onPostComment={handlePostComment}
        onToggleStatus={handleToggleIssueStatus}
        issuePrefix={mission.settingsMap.issue_prefix}
      />

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
