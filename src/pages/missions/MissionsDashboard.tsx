import { useEffect, useMemo, useState, useCallback } from "react";
import { ActivityIcon, ClockIcon, PlusIcon, TrendingUpIcon, UsersIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import {
  CreateMissionModal,
  MissionDetailPanel,
  MissionGrid,
  StatCard,
  type MissionRepoOption,
} from "@/components/MissionsDashboardParts";

interface MissionsDashboardProps {
  mission: MissionControlState;
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
  const [repoQuery, setRepoQuery] = useState("");

  // Inline edit state for side panel
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editGithubRepo, setEditGithubRepo] = useState("");
  const [editGithubBranch, setEditGithubBranch] = useState("main");
  const [editRepoQuery, setEditRepoQuery] = useState("");
  const [editColor, setEditColor] = useState("");

  const startEditing = useCallback(() => {
    const sel = mission.missions.find((m) => m.id === selectedMissionId);
    if (!sel) return;
    setEditTitle(sel.title);
    setEditDescription(sel.description || "");
    setEditStatus(sel.status);
    setEditColor(sel.color || "");
    setEditGithubRepo(sel.github_repo || "");
    setEditGithubBranch(sel.github_default_branch || "main");
    setEditRepoQuery(sel.github_repo || "");
    setEditing(true);
  }, [mission.missions, selectedMissionId]);

  const cancelEditing = useCallback(() => setEditing(false), []);

  const saveEditing = useCallback(async () => {
    if (!selectedMissionId) return;
    const ok = await mission.updateMission(selectedMissionId, {
      title: editTitle,
      description: editDescription || null,
      status: editStatus,
      color: editColor || null,
      github_repo: editGithubRepo || null,
      github_default_branch: editGithubBranch || "main",
    });
    if (ok) setEditing(false);
  }, [selectedMissionId, editTitle, editDescription, editStatus, editColor, editGithubRepo, editGithubBranch, mission]);

  // Auto-load repos when PAT is available
  const [allRepos, setAllRepos] = useState<MissionRepoOption[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [editRepoDropdownOpen, setEditRepoDropdownOpen] = useState(false);

  const loadAllRepos = useCallback(async () => {
    if (!mission.settingsMap.github_pat || reposLoaded) return;
    const repos = await mission.loadGitHubRepos(undefined);
    setAllRepos(repos.map((r) => ({ full_name: r.full_name, default_branch: r.default_branch })));
    setReposLoaded(true);
  }, [mission, reposLoaded]);

  useEffect(() => {
    if (mission.settingsMap.github_pat) {
      void loadAllRepos();
    }
  }, [mission.settingsMap.github_pat, loadAllRepos]);

  const filteredRepos = useMemo(() => {
    if (!repoQuery.trim()) return allRepos;
    const q = repoQuery.toLowerCase();
    return allRepos.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [allRepos, repoQuery]);

  const filteredEditRepos = useMemo(() => {
    if (!editRepoQuery.trim()) return allRepos;
    const q = editRepoQuery.toLowerCase();
    return allRepos.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [allRepos, editRepoQuery]);

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

        <MissionGrid mission={mission} selectedMissionId={selectedMissionId} onSelectMission={setSelectedMissionId} onOpenCreate={() => setDraftOpen(true)} />
      </div>

      <MissionDetailPanel
        mission={mission}
        selected={selected}
        editing={editing}
        startEditing={startEditing}
        cancelEditing={cancelEditing}
        saveEditing={saveEditing}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        editDescription={editDescription}
        setEditDescription={setEditDescription}
        editStatus={editStatus}
        setEditStatus={setEditStatus}
        editColor={editColor}
        setEditColor={setEditColor}
        editGithubRepo={editGithubRepo}
        setEditGithubRepo={setEditGithubRepo}
        setEditGithubBranch={setEditGithubBranch}
        editRepoQuery={editRepoQuery}
        setEditRepoQuery={setEditRepoQuery}
        editRepoDropdownOpen={editRepoDropdownOpen}
        setEditRepoDropdownOpen={setEditRepoDropdownOpen}
        filteredEditRepos={filteredEditRepos}
        reposLoaded={reposLoaded}
      />

      {!draftOpen ? (
        <button
          onClick={() => setDraftOpen(true)}
          className="fixed bottom-6 right-6 z-20 flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-[#39147e] to-[#2e1065] shadow-lg shadow-[#2e1065]/25 transition-transform hover:scale-105"
        >
          <PlusIcon className="size-5 text-white" />
        </button>
      ) : null}

      <CreateMissionModal
        open={draftOpen}
        mission={mission}
        title={title}
        setTitle={setTitle}
        description={description}
        setDescription={setDescription}
        leadAgentId={leadAgentId}
        setLeadAgentId={setLeadAgentId}
        selectedAgentIds={selectedAgentIds}
        setSelectedAgentIds={setSelectedAgentIds}
        githubRepo={githubRepo}
        setGithubRepo={setGithubRepo}
        setGithubDefaultBranch={setGithubDefaultBranch}
        repoQuery={repoQuery}
        setRepoQuery={setRepoQuery}
        repoDropdownOpen={repoDropdownOpen}
        setRepoDropdownOpen={setRepoDropdownOpen}
        filteredRepos={filteredRepos}
        reposLoaded={reposLoaded}
        onClose={() => setDraftOpen(false)}
        onCreate={async () => {
          const result = await mission.createMission({
            title,
            description,
            lead_agent_id: leadAgentId || null,
            github_repo: githubRepo || null,
            github_default_branch: githubDefaultBranch || "main",
          });
          if (result) {
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
            setDraftOpen(false);
          }
        }}
      />
    </div>
  );
}
