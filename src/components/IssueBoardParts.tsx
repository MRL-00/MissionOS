import { useState, type Dispatch, type SetStateAction } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LoaderIcon,
  MaximizeIcon,
  MessageSquareIcon,
  MinimizeIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ReplyIcon,
  ShareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type { AgentRecord, IssueCommentRecord, IssueRecord, RunRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { Select as UISelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function formatTicketId(issue: IssueRecord, prefix?: string) {
  if (issue.issue_number != null) {
    return `${prefix || "EPIC"}-${String(issue.issue_number).padStart(3, "0")}`;
  }
  return issue.id.slice(0, 8).toUpperCase();
}

export interface IssueCreateDraft {
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee_agent_id: string;
  mission_id: string;
  github_repo: string;
}

export interface IssueEditDraft extends IssueCreateDraft {
  labels: string;
}

export interface RepoOption {
  full_name: string;
  default_branch: string;
}

export const ISSUE_COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "Todo" },
  { id: "in_progress", label: "In Progress" },
  { id: "in_review", label: "In Review" },
  { id: "done", label: "Done" },
];

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  ISSUE_COLUMNS.map((column) => [column.id, column.label]),
);

const PRIORITY_INDICATORS: Record<string, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-400",
  none: "border-l-transparent",
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-400 border-red-500/20",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  medium: "bg-yellow-500/15 text-yellow-300 border-yellow-500/20",
  low: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

const STATUS_BADGE: Record<string, string> = {
  backlog: "bg-white/[0.06] text-[#918f90] border-white/[0.08]",
  todo: "bg-white/[0.08] text-[#c8c4d7] border-white/[0.1]",
  in_progress: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  in_review: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  done: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

function normalizeSelectValue(value: string | null) {
  return value ?? "";
}

function formatStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

export function IssueFiltersBar({
  mission,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  missionFilter,
  onMissionFilterChange,
  boardMode,
  onToggleBoardMode,
  onOpenCreate,
}: {
  mission: MissionControlState;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (value: string) => void;
  assigneeFilter: string;
  onAssigneeFilterChange: (value: string) => void;
  missionFilter: string;
  onMissionFilterChange: (value: string) => void;
  boardMode: boolean;
  onToggleBoardMode: () => void;
  onOpenCreate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search issues..."
        className="h-9 w-64 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 text-[13px] text-white outline-none placeholder:text-[#918f90]"
      />
      <Filter
        value={statusFilter}
        onChange={onStatusFilterChange}
        options={["", ...ISSUE_COLUMNS.map((entry) => entry.id)]}
        label="Status"
        lookup={STATUS_LABELS}
      />
      <Filter value={priorityFilter} onChange={onPriorityFilterChange} options={["", "urgent", "high", "medium", "low"]} label="Priority" />
      <Filter
        value={assigneeFilter}
        onChange={onAssigneeFilterChange}
        options={["", ...mission.agents.map((entry) => entry.id)]}
        label="Assignee"
        lookup={Object.fromEntries(mission.agents.map((entry) => [entry.id, entry.name]))}
      />
      <Filter
        value={missionFilter}
        onChange={onMissionFilterChange}
        options={["", ...mission.missions.map((entry) => entry.id)]}
        label="Mission"
        lookup={Object.fromEntries(mission.missions.map((entry) => [entry.id, entry.title]))}
      />
      <button
        onClick={onToggleBoardMode}
        className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
      >
        {boardMode ? "Switch to List" : "Switch to Board"}
      </button>
      <button
        onClick={onOpenCreate}
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
        const linkedMission = mission.missions.find((entry) => entry.id === missionFilter);
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
  );
}

export function IssueCreateModal({
  open,
  mission,
  draft,
  setDraft,
  createRepoQuery,
  setCreateRepoQuery,
  createRepoOptions,
  onSearchRepos,
  getInheritedRepo,
  onClose,
  onCreate,
}: {
  open: boolean;
  mission: MissionControlState;
  draft: IssueCreateDraft;
  setDraft: Dispatch<SetStateAction<IssueCreateDraft>>;
  createRepoQuery: string;
  setCreateRepoQuery: (value: string) => void;
  createRepoOptions: RepoOption[];
  onSearchRepos: (query: string) => void;
  getInheritedRepo: (missionId: string | null) => string | null;
  onClose: () => void;
  onCreate: () => Promise<void>;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="text-[14px] font-semibold text-white">New Issue</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white">
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <Field label="Title" value={draft.title} onChange={(value) => setDraft({ ...draft, title: value })} />
          <div className="grid grid-cols-2 gap-3">
            <FormSelect
              label="Status"
              value={draft.status}
              onChange={(value) => setDraft({ ...draft, status: value })}
              options={ISSUE_COLUMNS.map((entry) => entry.id)}
              lookup={STATUS_LABELS}
            />
            <FormSelect label="Priority" value={draft.priority} onChange={(value) => setDraft({ ...draft, priority: value })} options={["urgent", "high", "medium", "low"]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormSelect
              label="Assignee"
              value={draft.assignee_agent_id}
              onChange={(value) => setDraft({ ...draft, assignee_agent_id: value })}
              options={["", ...mission.agents.map((entry) => entry.id)]}
              lookup={Object.fromEntries(mission.agents.map((entry) => [entry.id, entry.name]))}
            />
            <FormSelect
              label="Mission"
              value={draft.mission_id}
              onChange={(value) => setDraft({ ...draft, mission_id: value })}
              options={["", ...mission.missions.map((entry) => entry.id)]}
              lookup={Object.fromEntries(mission.missions.map((entry) => [entry.id, entry.title]))}
            />
          </div>
          <RepoSearchField
            label="GitHub Repository"
            value={draft.github_repo}
            query={createRepoQuery}
            options={createRepoOptions}
            inheritedRepo={getInheritedRepo(draft.mission_id || null)}
            hasGitHubPat={!!mission.settingsMap.github_pat}
            onQueryChange={setCreateRepoQuery}
            onSearch={onSearchRepos}
            onSelect={(repo) => {
              setDraft({ ...draft, github_repo: repo });
              setCreateRepoQuery(repo);
            }}
            onClear={() => {
              setDraft({ ...draft, github_repo: "" });
              setCreateRepoQuery("");
            }}
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
          <button className="rounded-lg border border-white/[0.08] px-4 py-1.5 text-[12px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white" onClick={onClose}>
            Cancel
          </button>
          <button
            onClick={() => void onCreate()}
            className="rounded-lg bg-[#39147e] px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-[#2e1065]/25 transition-all hover:bg-[#7c3aed]"
          >
            Create Issue
          </button>
        </div>
      </div>
    </div>
  );
}

export function IssueEditModal({
  mission,
  editingIssue,
  editFullScreen,
  setEditFullScreen,
  editDraft,
  setEditDraft,
  editRepoQuery,
  setEditRepoQuery,
  editRepoOptions,
  onSearchRepos,
  getInheritedRepo,
  confirmDelete,
  setConfirmDelete,
  comments,
  newComment,
  onNewCommentChange,
  onPostComment,
  onDeleteComment,
  onReplyComment,
  timeZone,
  onClose,
  onDelete,
  onSave,
}: {
  mission: MissionControlState;
  editingIssue: IssueRecord | null;
  editFullScreen: boolean;
  setEditFullScreen: Dispatch<SetStateAction<boolean>>;
  editDraft: IssueEditDraft;
  setEditDraft: Dispatch<SetStateAction<IssueEditDraft>>;
  editRepoQuery: string;
  setEditRepoQuery: (value: string) => void;
  editRepoOptions: RepoOption[];
  onSearchRepos: (query: string) => void;
  getInheritedRepo: (missionId: string | null) => string | null;
  confirmDelete: boolean;
  setConfirmDelete: Dispatch<SetStateAction<boolean>>;
  comments: IssueCommentRecord[];
  newComment: string;
  onNewCommentChange: (value: string) => void;
  onPostComment: () => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onReplyComment: (comment: IssueCommentRecord) => void;
  timeZone?: string | undefined;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onSave: () => Promise<void>;
}) {
  if (!editingIssue) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50 transition-all duration-200",
          editFullScreen ? "fixed inset-4 z-50 max-h-none w-auto max-w-none" : "max-h-[85vh] w-full max-w-2xl",
        )}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[14px] font-semibold text-white">Edit Issue</h2>
            <span className="text-[11px] font-medium text-[#585658]">{formatTicketId(editingIssue, mission?.settingsMap?.issue_prefix)}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEditFullScreen((value) => !value)}
              className="rounded-lg p-1.5 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white"
              title={editFullScreen ? "Minimize" : "Full screen"}
            >
              {editFullScreen ? <MinimizeIcon className="size-3.5" /> : <MaximizeIcon className="size-3.5" />}
            </button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white">
              <XIcon className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-4">
            <div>
              <input
                value={editDraft.title}
                onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })}
                className="w-full border-none bg-transparent text-[18px] font-semibold text-white outline-none placeholder:text-[#585658]"
                placeholder="Issue title..."
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Description</label>
              <textarea
                value={editDraft.description}
                onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })}
                className={cn(
                  "w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] leading-relaxed text-white outline-none placeholder:text-[#585658] focus:border-[#5e4ae3]/50",
                  editFullScreen ? "h-48" : "h-28",
                )}
                placeholder="Describe the issue..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormSelect
                label="Status"
                value={editDraft.status}
                onChange={(value) => setEditDraft({ ...editDraft, status: value })}
                options={ISSUE_COLUMNS.map((entry) => entry.id)}
                lookup={STATUS_LABELS}
              />
              <FormSelect label="Priority" value={editDraft.priority} onChange={(value) => setEditDraft({ ...editDraft, priority: value })} options={["urgent", "high", "medium", "low"]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormSelect
                label="Assignee"
                value={editDraft.assignee_agent_id}
                onChange={(value) => setEditDraft({ ...editDraft, assignee_agent_id: value })}
                options={["", ...mission.agents.map((entry) => entry.id)]}
                lookup={Object.fromEntries(mission.agents.map((entry) => [entry.id, entry.name]))}
              />
              <FormSelect
                label="Mission"
                value={editDraft.mission_id}
                onChange={(value) => setEditDraft({ ...editDraft, mission_id: value })}
                options={["", ...mission.missions.map((entry) => entry.id)]}
                lookup={Object.fromEntries(mission.missions.map((entry) => [entry.id, entry.title]))}
              />
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
              onSearch={onSearchRepos}
              onSelect={(repo) => {
                setEditDraft({ ...editDraft, github_repo: repo });
                setEditRepoQuery(repo);
              }}
              onClear={() => {
                setEditDraft({ ...editDraft, github_repo: "" });
                setEditRepoQuery("");
              }}
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

            {editFullScreen ? (
              <div className="mt-6 border-t border-white/[0.06] pt-5">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">
                  Comments {comments.length > 0 ? `(${comments.length})` : ""}
                </div>
                <div className="space-y-2">
                  {comments.map((comment) => (
                    <div key={comment.id} className="group rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] text-[#918f90]">
                          {comment.author_emoji} {comment.author_name || "Unknown"} • {formatDateTime(comment.created_at, timeZone)}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => onReplyComment(comment)}
                            className="rounded p-1 text-[#918f90] hover:bg-white/[0.06] hover:text-white"
                            title="Reply"
                          >
                            <ReplyIcon className="size-3" />
                          </button>
                          <button
                            onClick={() => void onDeleteComment(comment.id)}
                            className="rounded p-1 text-[#918f90] hover:bg-red-500/10 hover:text-red-400"
                            title="Delete comment"
                          >
                            <Trash2Icon className="size-3" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-[12px] text-[#c8c4d7]">{comment.body}</div>
                    </div>
                  ))}
                </div>
                <textarea
                  value={newComment}
                  onChange={(event) => onNewCommentChange(event.target.value)}
                  placeholder="Add a comment..."
                  className="mt-3 h-20 w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[#585658] focus:border-[#5e4ae3]/50"
                />
                <button
                  onClick={() => void onPostComment()}
                  disabled={!newComment.trim()}
                  className="mt-2 flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <MessageSquareIcon className="size-3.5" />
                  Post Comment
                </button>
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
                  onClick={() => void onDelete()}
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
            <button className="rounded-lg border border-white/[0.08] px-4 py-1.5 text-[12px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white" onClick={onClose}>
              Cancel
            </button>
            <button
              onClick={() => void onSave()}
              className="rounded-lg bg-[#39147e] px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-[#2e1065]/25 transition-all hover:bg-[#7c3aed]"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function IssueBoardView({
  mission,
  filteredIssues,
  selectedIssueId,
  onSelectIssue,
  onEditIssue,
}: {
  mission: MissionControlState;
  filteredIssues: IssueRecord[];
  selectedIssueId: string | null;
  onSelectIssue: (id: string) => void;
  onEditIssue: (issue: IssueRecord) => void;
}) {
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  return (
    <div className="flex flex-1 gap-4 overflow-x-auto p-6">
      {ISSUE_COLUMNS.map((column) => {
        const issues = filteredIssues.filter((issue) => issue.status === column.id);
        return (
          <div
            key={column.id}
            className={cn(
              "flex min-w-[180px] flex-1 flex-col rounded-lg bg-white/[0.03] p-3 transition-colors",
              dragOverColumn === column.id && "bg-[#5e4ae3]/10 ring-1 ring-[#5e4ae3]/40",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              if (dragOverColumn !== column.id) setDragOverColumn(column.id);
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragOverColumn(column.id);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragOverColumn(null);
              }
            }}
            onDrop={(event) => {
              setDragOverColumn(null);
              const issueId = event.dataTransfer.getData("text/plain");
              const issue = mission.issues.find((entry) => entry.id === issueId);
              if (!issue) {
                return;
              }
              void mission.updateIssue(issue.id, { ...issue, status: column.id, labels: issue.labels });
            }}
          >
            <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-3">
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
                  onClick={() => onSelectIssue(issue.id)}
                  onDoubleClick={() => onEditIssue(issue)}
                  className={cn(
                    "rounded-lg border border-white/[0.06] border-l-2 bg-[#1c1b1c] p-3 text-left transition-all",
                    !issue.mission_color && (PRIORITY_INDICATORS[issue.priority] ?? PRIORITY_INDICATORS.none),
                    selectedIssueId === issue.id && "ring-1 ring-[#5e4ae3]/50",
                  )}
                  style={issue.mission_color ? { borderLeftColor: issue.mission_color } : undefined}
                >
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-[#918f90]">{formatTicketId(issue, mission?.settingsMap?.issue_prefix)}</span>
                    {issue.source === "github" || issue.github_number ? (
                      <span className="rounded bg-[#1c1b1c] px-1 py-0.5 text-[9px] font-medium text-[#918f90]">GH#{issue.github_number}</span>
                    ) : null}
                    {issue.github_pr_url ? (
                      <a href={issue.github_pr_url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="text-[#5e4ae3] hover:text-[#c6bfff]">
                        <GitPullRequestIcon className="size-3" />
                      </a>
                    ) : null}
                  </div>
                  <div className="text-[13px] font-medium leading-snug text-white">{issue.title}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <PriorityBadge priority={issue.priority} />
                    <StatusBadge status={issue.status} />
                    {issue.labels.map((label) => (
                      <span key={label} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#918f90]">
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    {issue.mission_title ? (
                      <span className="truncate text-[11px] text-[#918f90]">{issue.mission_title}</span>
                    ) : <span />}
                    {issue.assignee_emoji ? (
                      <div
                        className="flex size-5 items-center justify-center rounded-full bg-gradient-to-br from-[#39147e] to-[#2e1065] text-[9px] font-semibold text-white"
                        title={issue.assignee_name ?? undefined}
                      >
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
  );
}

export function IssueListView({
  filteredIssues,
  selectedIssueId,
  onSelectIssue,
  onEditIssue,
  timeZone,
}: {
  filteredIssues: IssueRecord[];
  selectedIssueId: string | null;
  onSelectIssue: (id: string) => void;
  onEditIssue: (issue: IssueRecord) => void;
  timeZone?: string | undefined;
}) {
  return (
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
              onClick={() => onSelectIssue(issue.id)}
              onDoubleClick={() => onEditIssue(issue)}
              className={cn(
                "grid w-full grid-cols-[100px_2fr_120px_140px_1fr_140px] gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]",
                selectedIssueId === issue.id && "bg-white/[0.03] ring-1 ring-[#5e4ae3]/40",
              )}
            >
              <span><PriorityBadge priority={issue.priority} /></span>
              <span className="text-[13px] font-medium text-white">{issue.title}</span>
              <span><StatusBadge status={issue.status} /></span>
              <span className="text-[12px] text-[#c8c4d7]">{issue.assignee_name || "Unassigned"}</span>
              <span className="text-[12px] text-[#918f90]">{issue.mission_title || "None"}</span>
              <span className="text-[12px] text-[#918f90]">{formatDate(issue.created_at, timeZone)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function IssueDetailsPanel({
  selectedIssue,
  comments,
  newComment,
  onNewCommentChange,
  onEditIssue,
  onClose,
  onPostComment,
  onDeleteComment,
  onReplyComment,
  onToggleStatus,
  issuePrefix,
  agents,
  issueRuns,
  isRunning,
  onRunIssue,
  timeZone,
}: {
  selectedIssue: IssueRecord | null;
  comments: IssueCommentRecord[];
  newComment: string;
  onNewCommentChange: (value: string) => void;
  onEditIssue: (issue: IssueRecord) => void;
  onClose: () => void;
  onPostComment: () => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onReplyComment: (comment: IssueCommentRecord) => void;
  onToggleStatus: () => void;
  issuePrefix?: string | undefined;
  agents?: AgentRecord[];
  issueRuns?: RunRecord[];
  isRunning?: boolean;
  onRunIssue?: (agentId: string) => void;
  timeZone?: string | undefined;
}) {
  if (!selectedIssue) {
    return null;
  }

  return (
    <div className="w-[360px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] font-medium text-[#918f90]">{formatTicketId(selectedIssue, issuePrefix)}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEditIssue(selectedIssue)}
            className="rounded-lg p-1 text-[#918f90] hover:bg-white/[0.06] hover:text-white"
            title="Edit issue"
          >
            <PencilIcon className="size-3.5" />
          </button>
          <button onClick={onClose} className="rounded-lg p-1 text-[#918f90] hover:bg-white/[0.06] hover:text-white">
            <XIcon className="size-4" />
          </button>
        </div>
      </div>
      <button
        onClick={() => onEditIssue(selectedIssue)}
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

      {onRunIssue && agents && agents.length > 0 ? (
        <IssueRunButton
          issue={selectedIssue}
          agents={agents}
          isRunning={isRunning ?? false}
          onRun={onRunIssue}
        />
      ) : null}

      {issueRuns && issueRuns.length > 0 ? (
        <IssueRunsSection runs={issueRuns} />
      ) : null}

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
        <div className="text-[12px] text-[#918f90]">Created: {formatDateTime(selectedIssue.created_at, timeZone)}</div>
        <div className="text-[12px] text-[#918f90]">Updated: {formatDateTime(selectedIssue.updated_at, timeZone)}</div>
      </div>

      <div className="mb-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Comments</div>
        <div className="space-y-2">
          {comments.map((comment) => (
            <div key={comment.id} className="group rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-[#918f90]">
                  {comment.author_emoji} {comment.author_name || "Unknown"} • {formatDateTime(comment.created_at, timeZone)}
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => onReplyComment(comment)}
                    className="rounded p-0.5 text-[#918f90] hover:bg-white/[0.06] hover:text-white"
                    title="Reply"
                  >
                    <ReplyIcon className="size-3" />
                  </button>
                  <button
                    onClick={() => void onDeleteComment(comment.id)}
                    className="rounded p-0.5 text-[#918f90] hover:bg-red-500/10 hover:text-red-400"
                    title="Delete comment"
                  >
                    <Trash2Icon className="size-3" />
                  </button>
                </div>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-[12px] text-[#c8c4d7]">{comment.body}</div>
            </div>
          ))}
        </div>
        <textarea
          value={newComment}
          onChange={(event) => onNewCommentChange(event.target.value)}
          placeholder="Add a comment..."
          className="mt-3 h-24 w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => void onPostComment()}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] py-2.5 text-[13px] font-medium text-white"
        >
          <MessageSquareIcon className="size-3.5" />
          Post Comment
        </button>
        <button
          onClick={onToggleStatus}
          className="flex items-center justify-center rounded-lg border border-white/[0.08] p-2.5 text-[#918f90] transition-colors hover:bg-white/[0.04]"
        >
          <ShareIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function IssueRunButton({
  issue,
  agents,
  isRunning,
  onRun,
}: {
  issue: IssueRecord;
  agents: AgentRecord[];
  isRunning: boolean;
  onRun: (agentId: string) => void;
}) {
  const [pickedAgentId, setPickedAgentId] = useState("");
  const assignedAgent = agents.find((a) => a.id === issue.assignee_agent_id);
  const activeAgents = agents.filter((a) => a.active);

  return (
    <div className="mb-5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Actions</div>
      {assignedAgent ? (
        <button
          type="button"
          disabled={isRunning}
          onClick={() => onRun(assignedAgent.id)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isRunning ? <LoaderIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
          {isRunning ? "Running..." : `Run with ${assignedAgent.name}`}
        </button>
      ) : (
        <div className="mt-2 flex gap-2">
          <select
            value={pickedAgentId}
            onChange={(event) => setPickedAgentId(event.target.value)}
            className="flex-1 rounded-lg border border-white/[0.08] bg-[#0f0f10] px-2 py-2 text-[12px] text-white outline-none"
          >
            <option value="">Select agent...</option>
            {activeAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={isRunning || !pickedAgentId}
            onClick={() => pickedAgentId && onRun(pickedAgentId)}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isRunning ? <LoaderIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
            Run
          </button>
        </div>
      )}
    </div>
  );
}

const RUN_STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500/20 text-blue-400",
  complete: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
  planning: "bg-amber-500/20 text-amber-400",
};

function IssueRunsSection({ runs }: { runs: RunRecord[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="mb-5 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Runs</div>
      {runs.map((run) => {
        const isExpanded = expandedId === run.id;
        const durationStr = run.duration_ms != null ? `${Math.round(run.duration_ms / 1000)}s` : "...";
        return (
          <div key={run.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : run.id)}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDownIcon className="size-3 text-[#918f90]" /> : <ChevronRightIcon className="size-3 text-[#918f90]" />}
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", RUN_STATUS_COLORS[run.status] ?? "bg-white/10 text-white/60")}>
                  {run.status}
                </span>
                <span className="text-[11px] text-[#c8c4d7]">{run.agent_emoji} {run.agent_name}</span>
              </div>
              <span className="text-[10px] text-[#918f90]">{durationStr}</span>
            </button>
            {run.github_pr_url ? (
              <a
                href={run.github_pr_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 flex items-center gap-1 text-[11px] text-[#5e4ae3] hover:text-[#c6bfff]"
              >
                <GitPullRequestIcon className="size-3" />
                Pull Request
                <ExternalLinkIcon className="size-2.5" />
              </a>
            ) : null}
            {isExpanded && run.output ? (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-[#918f90]">
                {run.output.length > 1000 ? `${run.output.slice(0, 1000)}...` : run.output}
              </pre>
            ) : null}
          </div>
        );
      })}
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
  options: RepoOption[];
  inheritedRepo: string | null;
  hasGitHubPat: boolean;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
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
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (hasGitHubPat) {
                onSearch(query);
              } else if (query.includes("/")) {
                onSelect(query);
              }
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
      {formatStatusLabel(status)}
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
    <UISelect value={value} onValueChange={(nextValue) => onChange(normalizeSelectValue(nextValue))}>
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

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
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
      <UISelect value={value} onValueChange={(nextValue) => onChange(normalizeSelectValue(nextValue))}>
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
