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
import { missionHasActiveRuns } from "@/mission/missionStatus";

interface MissionsDashboardProps {
  mission: MissionControlState;
}

const MISSION_TEAM_PRESETS = ["Engineering", "Marketing", "Sales", "Finance"];

export function MissionsDashboard({ mission }: MissionsDashboardProps) {
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [teamFilter, setTeamFilter] = useState("all");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [teamName, setTeamName] = useState("Engineering");
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
  const [editTeamName, setEditTeamName] = useState("");
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
    setEditTeamName(sel.team_name || "General");
    setEditColor(sel.color || "");
    setEditGithubRepo(sel.github_repo || "");
    setEditGithubBranch(sel.github_default_branch || "main");
    setEditRepoQuery(sel.github_repo || "");
    setEditing(true);
  }, [mission.missions, selectedMissionId]);

  const cancelEditing = useCallback(() => setEditing(false), []);

  const saveEditing = useCallback(async () => {
    if (!selectedMissionId) return;
    if (editStatus === "complete" && missionHasActiveRuns(selectedMissionId, mission.runs)) return;
    const ok = await mission.updateMission(selectedMissionId, {
      title: editTitle,
      description: editDescription || null,
      status: editStatus,
      team_name: editTeamName || "General",
      color: editColor || null,
      github_repo: editGithubRepo || null,
      github_default_branch: editGithubBranch || "main",
    });
    if (ok) setEditing(false);
  }, [selectedMissionId, editTitle, editDescription, editStatus, editTeamName, editColor, editGithubRepo, editGithubBranch, mission]);

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

  const teamOptions = useMemo(() => {
    const teams = new Set([...MISSION_TEAM_PRESETS, ...mission.missions.map((entry) => entry.team_name || "General")]);
    return Array.from(teams).sort((a, b) => a.localeCompare(b));
  }, [mission.missions]);
  const filteredMissions = useMemo(
    () => mission.missions.filter((entry) => teamFilter === "all" || (entry.team_name || "General") === teamFilter),
    [mission.missions, teamFilter],
  );
  const selected = useMemo(
    () => filteredMissions.find((entry) => entry.id === selectedMissionId) ?? filteredMissions[0] ?? null,
    [filteredMissions, selectedMissionId],
  );
  useEffect(() => {
    const firstMission = filteredMissions[0];
    if (firstMission && !filteredMissions.some((entry) => entry.id === selectedMissionId)) {
      setSelectedMissionId(firstMission.id);
    } else if (!firstMission && selectedMissionId) {
      setSelectedMissionId(null);
    }
  }, [filteredMissions, selectedMissionId]);

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

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setTeamFilter("all")}
            className={teamFilter === "all" ? "rounded-lg bg-white/[0.1] px-3 py-1.5 text-[12px] text-white" : "rounded-lg border border-white/[0.08] px-3 py-1.5 text-[12px] text-[#918f90] hover:text-white"}
          >
            All teams
          </button>
          {teamOptions.map((team) => (
            <button
              key={team}
              onClick={() => setTeamFilter(team)}
              className={teamFilter === team ? "rounded-lg bg-white/[0.1] px-3 py-1.5 text-[12px] text-white" : "rounded-lg border border-white/[0.08] px-3 py-1.5 text-[12px] text-[#918f90] hover:text-white"}
            >
              {team}
            </button>
          ))}
        </div>

        <MissionGrid mission={mission} missions={filteredMissions} selectedMissionId={selectedMissionId} onSelectMission={setSelectedMissionId} onOpenCreate={() => setDraftOpen(true)} />
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
        editTeamName={editTeamName}
        setEditTeamName={setEditTeamName}
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
        teamName={teamName}
        setTeamName={setTeamName}
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
        suggestedTeamNames={MISSION_TEAM_PRESETS}
        onClose={() => setDraftOpen(false)}
        onCreate={async () => {
          const result = await mission.createMission({
            title,
            description,
            team_name: teamName || "General",
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
            setTeamName("Engineering");
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
