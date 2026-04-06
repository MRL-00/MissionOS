import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  AgentMessageRecord,
  AgentRecord,
  AuthUser,
  BootstrapState,
  DocFileRecord,
  EngineDefinition,
  IssueCommentRecord,
  IssueRecord,
  MissionRecord,
  ProjectRecord,
  RelationshipRecord,
  RunRecord,
  ScheduleRecord,
  SearchResults,
} from "../appTypes";
import {
  assignMissionAgent,
  AUTH_TOKEN_STORAGE_KEY,
  changePassword,
  createAgent,
  createAgentMessage,
  createIssue,
  createIssueComment,
  createMission,
  createProject,
  createSchedule,
  createRelationship,
  createRun,
  deleteRun,
  deleteSchedule,
  deleteAgent,
  deleteIssue,
  deleteIssueComment,
  deleteMission,
  deleteRelationship,
  fetchAgentMessages,
  fetchAgents,
  fetchCurrentUser,
  fetchDocContent,
  fetchDocsTree,
  fetchEngines,
  fetchIssueComments,
  fetchIssues,
  fetchMissions,
  fetchProject,
  fetchRelationships,
  fetchRun,
  fetchRuns,
  fetchSchedules,
  fetchSettings,
  getBootstrap,
  getStoredAuthToken,
  loginAccount,
  registerAccount,
  removeMissionAgent,
  resetProject,
  runSchedule,
  savePositions,
  saveSettings,
  searchAll,
  setStoredAuthToken,
  startMission,
  streamRun,
  submitFeedback,
  syncLinearIssues,
  testAgentConnection,
  testEngineConnection,
  testLinearConnection,
  testGitHubConnection,
  fetchGitHubRepos,
  syncGitHubIssues,
  updateAgent,
  updateIssue,
  updateMission,
  updateSchedule,
  updateProfile,
} from "../api";

export type MissionView =
  | "setup"
  | "login"
  | "project-setup"
  | "missions"
  | "agents"
  | "orgchart"
  | "issues"
  | "runs"
  | "schedules"
  | "onboarding"
  | "settings"
  | "docs"
  | "help"
  | "search";

type ConnectionState = "connecting" | "connected" | "offline";

const VIEW_PATHS: Record<MissionView, string> = {
  setup: "/setup",
  login: "/login",
  "project-setup": "/setup/project",
  missions: "/",
  agents: "/agents",
  orgchart: "/org-chart",
  issues: "/issues",
  runs: "/runs",
  schedules: "/schedules",
  onboarding: "/onboarding",
  settings: "/settings",
  docs: "/docs",
  help: "/help",
  search: "/search",
};

const PATH_VIEWS = new Map<string, MissionView>(Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as MissionView]));

const MAIN_VIEWS: MissionView[] = ["missions", "agents", "orgchart", "issues", "runs", "schedules", "settings", "docs", "help", "search"];

function isMissionView(value: string): value is MissionView {
  return [
    "setup",
    "login",
    "project-setup",
    "missions",
    "agents",
    "orgchart",
    "issues",
    "runs",
    "schedules",
    "onboarding",
    "settings",
    "docs",
    "help",
    "search",
  ].includes(value);
}

function initialView(): MissionView {
  if (typeof window === "undefined") {
    return "missions";
  }

  return PATH_VIEWS.get(window.location.pathname) ?? "missions";
}

function replacePath(view: MissionView, search?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const nextUrl = `${VIEW_PATHS[view]}${search ? `?${search}` : ""}`;
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (currentUrl !== nextUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function pushPath(view: MissionView, search?: string) {
  if (typeof window === "undefined") {
    return;
  }

  const nextUrl = `${VIEW_PATHS[view]}${search ? `?${search}` : ""}`;
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (currentUrl !== nextUrl) {
    window.history.pushState(null, "", nextUrl);
  }
}

function normalizeStatus(status: string, active: boolean) {
  if (!active) {
    return "Offline";
  }
  if (status === "running") {
    return "Running";
  }
  if (status === "active") {
    return "Active";
  }
  return "Idle";
}

function engineLabel(engine: string) {
  switch (engine) {
    case "claude-code":
      return "Claude";
    case "codex":
      return "Codex";
    case "openclaw":
      return "OpenClaw";
    case "hermes":
      return "Hermes";
    case "pi":
      return "Pi";
    case "cursor":
      return "Cursor";
    default:
      return engine;
  }
}

function parseSearchParams() {
  if (typeof window === "undefined") {
    return { q: "", docPath: "getting-started.md" };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q") ?? "",
    docPath: params.get("path") ?? "getting-started.md",
  };
}

export function useMissionControl() {
  const [activeView, setActiveViewRaw] = useState<MissionView>(initialView);
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [engines, setEngines] = useState<EngineDefinition[]>([]);
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [relationships, setRelationships] = useState<RelationshipRecord[]>([]);
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [selectedIssueComments, setSelectedIssueComments] = useState<IssueCommentRecord[]>([]);
  const [issueRuns, setIssueRuns] = useState<RunRecord[]>([]);
  const [agentMessages, setAgentMessages] = useState<AgentMessageRecord[]>([]);
  const [docs, setDocs] = useState<DocFileRecord[]>([]);
  const [docContent, setDocContent] = useState("");
  const [{ q: searchQuery, docPath }, setQueryState] = useState(parseSearchParams);
  const [searchResults, setSearchResults] = useState<SearchResults>({
    agents: [],
    missions: [],
    issues: [],
    runs: [],
    comments: [],
  });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hydratingRef = useRef(false);

  function mergeRunIntoCollection(collection: RunRecord[], nextRun: RunRecord) {
    const index = collection.findIndex((run) => run.id === nextRun.id);
    if (index === -1) {
      return collection;
    }
    const next = [...collection];
    next[index] = { ...next[index], ...nextRun };
    return next;
  }

  function syncRunState(nextRun: RunRecord) {
    setRuns((current) => mergeRunIntoCollection(current, nextRun));
    setIssueRuns((current) => mergeRunIntoCollection(current, nextRun));
    setSelectedRun((current) => (current?.id === nextRun.id ? { ...current, ...nextRun } : current));
  }

  const setActiveView = (view: MissionView, options?: { search?: string }) => {
    setActiveViewRaw(view);
    pushPath(view, options?.search);
    if (view === "search") {
      const nextQuery = new URLSearchParams(options?.search ?? "");
      setQueryState((current) => ({
        ...current,
        q: nextQuery.get("q") ?? "",
      }));
    }
    if (view === "docs") {
      const nextQuery = new URLSearchParams(options?.search ?? "");
      setQueryState((current) => ({
        ...current,
        docPath: nextQuery.get("path") ?? current.docPath,
      }));
    }
  };

  const applyGuard = useEffectEvent((nextBootstrap: BootstrapState | null, nextToken: string | null, nextUser: AuthUser | null) => {
    if (!nextBootstrap) {
      return;
    }

    let nextView: MissionView | null = null;

    if (!nextBootstrap.hasAccount) {
      nextView = "setup";
    } else if (!nextToken || !nextUser) {
      nextView = "login";
    } else if (!nextBootstrap.hasProject) {
      nextView = "project-setup";
    } else if (!nextBootstrap.hasAgents) {
      nextView = "onboarding";
    } else if (!MAIN_VIEWS.includes(activeView)) {
      nextView = "missions";
    }

    if (nextView) {
      setActiveViewRaw(nextView);
      replacePath(nextView);
    }
  });

  const loadWorkspace = useEffectEvent(async (authToken: string) => {
    const [
      projectResponse,
      engineResponse,
      settingsResponse,
      agentResponse,
      relationshipResponse,
      missionResponse,
      issueResponse,
      runResponse,
      scheduleResponse,
      docsResponse,
    ] = await Promise.all([
      fetchProject(authToken),
      fetchEngines(authToken),
      fetchSettings(authToken),
      fetchAgents(authToken),
      fetchRelationships(authToken),
      fetchMissions(authToken),
      fetchIssues(authToken),
      fetchRuns(authToken),
      fetchSchedules(authToken),
      fetchDocsTree(authToken).catch(() => ({ files: [] as DocFileRecord[] })),
    ]);

    setProject(projectResponse.project);
    setEngines(engineResponse.engines);
    setSettingsMap(settingsResponse.settingsMap);
    setAgents(agentResponse.agents);
    setRelationships(relationshipResponse.relationships);
    setMissions(missionResponse.missions);
    setIssues(issueResponse.issues);
    setRuns(runResponse.runs);
    setSchedules(scheduleResponse.schedules);
    setDocs(docsResponse.files);
    setSelectedAgentId((current) => current ?? agentResponse.agents[0]?.id ?? null);
    setSelectedMissionId((current) => current ?? missionResponse.missions[0]?.id ?? null);
  });

  const hydrate = useEffectEvent(async () => {
    hydratingRef.current = true;
    setLoading(true);
    setConnectionState("connecting");
    try {
      const nextBootstrap = await getBootstrap();
      setBootstrap(nextBootstrap);

      const storedToken = getStoredAuthToken();
      let nextUser: AuthUser | null = null;

      if (storedToken) {
        try {
          const response = await fetchCurrentUser(storedToken);
          nextUser = response.user;
          setToken(storedToken);
          setUser(response.user);
          await loadWorkspace(storedToken);
        } catch {
          setStoredAuthToken(null);
          setToken(null);
          setUser(null);
        }
      } else {
        setToken(null);
        setUser(null);
      }

      applyGuard(nextBootstrap, storedToken, nextUser);
      setConnectionState("connected");
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load MissionOS.");
      setConnectionState("offline");
    } finally {
      hydratingRef.current = false;
      setLoading(false);
    }
  });

  useEffect(() => {
    void hydrate();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const nextView = PATH_VIEWS.get(window.location.pathname);
      if (nextView && isMissionView(nextView)) {
        setActiveViewRaw(nextView);
      }
      setQueryState(parseSearchParams());
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Skip reactive guard while hydrate() is in-flight — hydrate calls applyGuard
  // explicitly after all data is loaded.  Without this check the effect races with
  // hydrate's async fetches (e.g. bootstrap arrives before user → premature redirect).
  useEffect(() => {
    if (hydratingRef.current) {
      return;
    }
    applyGuard(bootstrap, token, user);
  }, [activeView, applyGuard, bootstrap, token, user]);

  useEffect(() => {
    if (activeView !== "docs" || !token) {
      return;
    }
    void fetchDocContent(token, docPath)
      .then((response) => setDocContent(response.content))
      .catch(() => setDocContent(""));
  }, [activeView, docPath, token]);

  useEffect(() => {
    if (activeView !== "search" || !token || !searchQuery) {
      return;
    }
    void searchAll(token, searchQuery)
      .then(setSearchResults)
      .catch(() => {
        setSearchResults({ agents: [], missions: [], issues: [], runs: [], comments: [] });
      });
  }, [activeView, searchQuery, token]);

  useEffect(() => {
    if (activeView !== "orgchart" || !token) {
      return;
    }
    const missionId = missions.find((mission) => mission.status === "active")?.id ?? selectedMissionId ?? undefined;

    const poll = () => {
      void fetchAgentMessages(token, missionId)
        .then((response) => setAgentMessages(response.messages))
        .catch(() => undefined);
      void silentRefreshAgents();
      void silentRefreshRelationships();
      void silentRefreshRuns();
    };

    poll(); // initial fetch
    const interval = window.setInterval(poll, 3_000);
    return () => window.clearInterval(interval);
  }, [activeView, missions, selectedMissionId, token]);

  async function runBusyAction<T>(key: string, action: () => Promise<T>): Promise<T | null> {
    setBusyKey(key);
    setError(null);
    try {
      return await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MissionOS action failed.");
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  async function refreshWorkspace(): Promise<void> {
    if (!token) {
      return;
    }
    await runBusyAction("workspace:refresh", () => loadWorkspace(token));
  }

  async function register(input: { username: string; password: string; displayName: string }) {
    const result = await runBusyAction("auth:register", () => registerAccount(input));
    if (!result) {
      return false;
    }
    setStoredAuthToken(result.token);
    setToken(result.token);
    setUser(result.user);
    await hydrate();
    return true;
  }

  async function login(input: { username: string; password: string }) {
    const result = await runBusyAction("auth:login", () => loginAccount(input));
    if (!result) {
      return false;
    }
    setStoredAuthToken(result.token);
    setToken(result.token);
    setUser(result.user);
    await hydrate();
    return true;
  }

  function logout() {
    setStoredAuthToken(null);
    setToken(null);
    setUser(null);
    setProject(null);
    setSettingsMap({});
    setAgents([]);
    setRelationships([]);
    setMissions([]);
    setIssues([]);
    setRuns([]);
    setSchedules([]);
    setSelectedRun(null);
    setSelectedIssueComments([]);
    setAgentMessages([]);
    setDocs([]);
    setDocContent("");
    setSearchResults({ agents: [], missions: [], issues: [], runs: [], comments: [] });
    setBootstrap((current) => current ?? { hasAccount: true, hasProject: false, hasAgents: false });
    setActiveViewRaw("login");
    replacePath("login");
  }

  async function saveProfile(input: { displayName: string; avatarEmoji: string }) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("profile:update", () => updateProfile(token, input));
    if (!result) {
      return false;
    }
    setUser(result.user);
    return true;
  }

  async function updatePassword(input: { currentPassword: string; newPassword: string }) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("profile:password", () => changePassword(token, input));
    return Boolean(result?.ok);
  }

  async function saveProject(input: { name: string; description: string }) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("project:create", () => createProject(token, input));
    if (!result) {
      return false;
    }
    setProject(result.project);
    await hydrate();
    return true;
  }

  async function wipeProject(projectName: string) {
    if (!token || project?.name !== projectName) {
      setError("Project name does not match.");
      return false;
    }
    const result = await runBusyAction("project:reset", () => resetProject(token));
    if (!result) {
      return false;
    }
    logout();
    setBootstrap(result.bootstrap);
    setActiveViewRaw("setup");
    replacePath("setup");
    return true;
  }

  async function createAgentRecord(input: Record<string, unknown>) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("agent:create", () => createAgent(token, input));
    if (!result) {
      return false;
    }
    await hydrate();
    return true;
  }

  async function editAgentRecord(agentId: string, input: Record<string, unknown>) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`agent:${agentId}:update`, () => updateAgent(token, agentId, input));
    if (!result) {
      return false;
    }
    await refreshWorkspace();
    return true;
  }

  async function removeAgentRecord(agentId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`agent:${agentId}:delete`, () => deleteAgent(token, agentId));
    if (!result) {
      return false;
    }
    await hydrate();
    return true;
  }

  async function verifyAgentConnection(agentId: string) {
    if (!token) {
      return null;
    }
    return runBusyAction(`agent:${agentId}:test`, () => testAgentConnection(token, agentId));
  }

  async function createMissionRecord(input: Record<string, unknown>) {
    if (!token) {
      return null;
    }
    const result = await runBusyAction("mission:create", () => createMission(token, input));
    if (!result) {
      return null;
    }
    await refreshWorkspace();
    return result.mission;
  }

  async function saveMissionRecord(missionId: string, input: Record<string, unknown>) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`mission:${missionId}:update`, () => updateMission(token, missionId, input));
    if (!result) {
      return false;
    }
    await refreshWorkspace();
    return true;
  }

  async function removeMissionRecord(missionId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`mission:${missionId}:delete`, () => deleteMission(token, missionId));
    if (!result) {
      return false;
    }
    await refreshWorkspace();
    return true;
  }

  async function addMissionAgent(missionId: string, agentId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`mission:${missionId}:assign:${agentId}`, () => assignMissionAgent(token, missionId, agentId));
    if (!result) {
      return false;
    }
    await refreshWorkspace();
    return true;
  }

  async function dropMissionAgent(missionId: string, agentId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`mission:${missionId}:remove:${agentId}`, () => removeMissionAgent(token, missionId, agentId));
    if (!result) {
      return false;
    }
    await refreshWorkspace();
    return true;
  }

  async function launchMission(missionId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`mission:${missionId}:start`, () => startMission(token, missionId));
    if (!result) {
      return false;
    }
    await refreshWorkspace();
    return true;
  }

  async function refreshIssues(filters?: Record<string, string | undefined>) {
    if (!token) {
      return;
    }
    const result = await runBusyAction("issues:refresh", () => fetchIssues(token, filters));
    if (result) {
      setIssues(result.issues);
    }
  }

  async function createIssueRecord(input: Record<string, unknown>) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("issue:create", () => createIssue(token, input));
    if (!result) {
      return false;
    }
    await refreshWorkspace();
    return true;
  }

  async function saveIssueRecord(issueId: string, input: Record<string, unknown>) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`issue:${issueId}:update`, () => updateIssue(token, issueId, input));
    if (!result) {
      return false;
    }
    setIssues((current) => current.map((issue) => (issue.id === issueId ? result.issue : issue)));
    return true;
  }

  async function removeIssueRecord(issueId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`issue:${issueId}:delete`, () => deleteIssue(token, issueId));
    if (!result) {
      return false;
    }
    await refreshWorkspace();
    return true;
  }

  async function loadIssueComments(issueId: string) {
    if (!token) {
      return [];
    }
    const result = await runBusyAction(`issue:${issueId}:comments`, () => fetchIssueComments(token, issueId));
    if (!result) {
      return [];
    }
    setSelectedIssueComments(result.comments);
    return result.comments;
  }

  async function addIssueCommentRecord(issueId: string, input: { body: string; parentId?: string }) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`issue:${issueId}:comment:create`, () => createIssueComment(token, issueId, input));
    if (!result) {
      return false;
    }
    await loadIssueComments(issueId);
    return true;
  }

  async function removeIssueCommentRecord(issueId: string, commentId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`issue:${issueId}:comment:delete`, () => deleteIssueComment(token, issueId, commentId));
    if (!result) {
      return false;
    }
    await loadIssueComments(issueId);
    return true;
  }

  async function loadIssueRuns(issueId: string) {
    if (!token) {
      return [];
    }
    const result = await runBusyAction(`issue:${issueId}:runs`, () => fetchRuns(token, { issue_id: issueId }));
    if (!result) {
      return [];
    }
    setIssueRuns(result.runs);
    return result.runs;
  }

  async function runIssue(issueId: string, agentId: string) {
    const issue = issues.find((i) => i.id === issueId);
    if (!issue || !token) {
      return null;
    }
    const lines = [`Resolve the following issue:`, ``, `Title: ${issue.title}`];
    if (issue.description) {
      lines.push(``, `Description: ${issue.description}`);
    }
    lines.push(``, `Priority: ${issue.priority}`);
    if (issue.labels.length > 0) {
      lines.push(`Labels: ${issue.labels.join(", ")}`);
    }
    const prompt = lines.join("\n");
    const input: { agent_id: string; prompt: string; mission_id?: string; issue_id?: string } = {
      agent_id: agentId,
      prompt,
      issue_id: issueId,
    };
    if (issue.mission_id) {
      input.mission_id = issue.mission_id;
    }
    const result = await createRunRecord(input);
    if (result) {
      await loadIssueRuns(issueId);
    }
    return result;
  }

  async function syncLinear() {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("issues:sync-linear", () => syncLinearIssues(token));
    if (!result) {
      return false;
    }
    setIssues(result.issues);
    return true;
  }

  async function refreshRuns(filters?: Record<string, string | undefined>) {
    if (!token) {
      return;
    }
    const result = await runBusyAction("runs:refresh", () => fetchRuns(token, filters));
    if (result) {
      setRuns(result.runs);
    }
  }

  /** Silent refresh — does NOT set busyKey so the UI won't flicker */
  async function silentRefreshRuns() {
    if (!token) return;
    try {
      const result = await fetchRuns(token);
      setRuns(result.runs);
    } catch {
      /* swallow — background poll failure is fine */
    }
  }

  async function silentRefreshAgents() {
    if (!token) return;
    try {
      const result = await fetchAgents(token);
      setAgents(result.agents);
    } catch { /* swallow */ }
  }

  async function silentRefreshRelationships() {
    if (!token) return;
    try {
      const result = await fetchRelationships(token);
      setRelationships(result.relationships);
    } catch { /* swallow */ }
  }

  async function refreshSchedules() {
    if (!token) {
      return;
    }
    const result = await runBusyAction("schedules:refresh", () => fetchSchedules(token));
    if (result) {
      setSchedules(result.schedules);
    }
  }

  async function createScheduleRecord(input: {
    name: string;
    agent_id: string;
    prompt: string;
    cron_expression: string;
    enabled: boolean;
    max_runs?: number | null;
  }) {
    if (!token) {
      return null;
    }
    const result = await runBusyAction("schedule:create", () => createSchedule(token, input));
    if (!result) {
      return null;
    }
    await refreshSchedules();
    return result.schedule;
  }

  async function saveScheduleRecord(scheduleId: string, input: {
    name: string;
    agent_id: string;
    prompt: string;
    cron_expression: string;
    enabled: boolean;
    max_runs?: number | null;
  }) {
    if (!token) {
      return null;
    }
    const result = await runBusyAction(`schedule:${scheduleId}:update`, () => updateSchedule(token, scheduleId, input));
    if (!result) {
      return null;
    }
    await refreshSchedules();
    return result.schedule;
  }

  async function removeScheduleRecord(scheduleId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`schedule:${scheduleId}:delete`, () => deleteSchedule(token, scheduleId));
    if (!result) {
      return false;
    }
    await refreshSchedules();
    return true;
  }

  async function runScheduleRecord(scheduleId: string) {
    if (!token) {
      return null;
    }
    const result = await runBusyAction(`schedule:${scheduleId}:run`, () => runSchedule(token, scheduleId));
    if (!result) {
      return null;
    }
    setSelectedRun(result.run);
    await Promise.all([refreshSchedules(), refreshRuns()]);
    return result.run;
  }

  async function createRunRecord(input: { agent_id: string; prompt: string; mission_id?: string; issue_id?: string }) {
    if (!token) {
      return null;
    }
    const result = await runBusyAction("run:create", () => createRun(token, input));
    if (!result) {
      return null;
    }
    setSelectedRun(result.run);
    await refreshRuns();
    return result.run;
  }

  async function removeRunRecord(runId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`run:${runId}:delete`, () => deleteRun(token, runId));
    if (!result) {
      return false;
    }
    await refreshRuns();
    return true;
  }

  async function loadRun(runId: string) {
    if (!token) {
      return null;
    }
    const result = await runBusyAction(`run:${runId}`, () => fetchRun(token, runId));
    if (!result) {
      return null;
    }
    setSelectedRun(result.run);
    syncRunState(result.run);
    return result.run;
  }

  async function streamSelectedRun(runId: string, onUpdate?: (run: RunRecord) => void) {
    if (!token) {
      return false;
    }
    const base = await loadRun(runId);
    if (!base) {
      return false;
    }
    if (base.status !== "running") {
      queueMicrotask(() => onUpdate?.(base));
      return true;
    }
    await streamRun(token, runId, (event) => {
      let nextRun: RunRecord | null = null;
      setSelectedRun((current) => {
        if (!current || current.id !== runId) {
          return current;
        }
        nextRun = {
          ...current,
          output: event.output ?? current.output,
          status:
            event.type === "complete"
              ? "complete"
              : event.type === "error"
                ? "failed"
                : current.status,
        };
        return nextRun;
      });
      if (nextRun) {
        syncRunState(nextRun);
        queueMicrotask(() => onUpdate?.(nextRun as RunRecord));
      }
    });
    await refreshRuns();
    return true;
  }

  async function refreshOrgMessages(missionId?: string) {
    if (!token) {
      return;
    }
    const result = await runBusyAction("messages:refresh", () => fetchAgentMessages(token, missionId));
    if (result) {
      setAgentMessages(result.messages);
    }
  }

  async function sendAgentMessageRecord(fromAgentId: string, toAgentId: string, message: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("message:send", () => createAgentMessage(token, { from_agent_id: fromAgentId, to_agent_id: toAgentId, message }));
    if (result) {
      setAgentMessages((current) => [result.agent_message, ...current]);
      return true;
    }
    return false;
  }

  async function persistPositions(positions: Array<{ agent_id: string; x: number; y: number }>) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("positions:save", () => savePositions(token, positions));
    if (!result) {
      return false;
    }
    setAgents((current) =>
      current.map((agent) => {
        const next = positions.find((item) => item.agent_id === agent.id);
        return next ? { ...agent, position: { x: next.x, y: next.y } } : agent;
      }),
    );
    return true;
  }

  async function addRelationshipRecord(parentId: string, childId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`relationship:${parentId}:${childId}:create`, () =>
      createRelationship(token, { parent_id: parentId, child_id: childId }),
    );
    if (!result) {
      return false;
    }
    setRelationships((current) => [...current, result.relationship]);
    return true;
  }

  async function removeRelationshipRecord(relationshipId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction(`relationship:${relationshipId}:delete`, () => deleteRelationship(token, relationshipId));
    if (!result) {
      return false;
    }
    setRelationships((current) => current.filter((relationship) => relationship.id !== relationshipId));
    return true;
  }

  async function updateSettingsMap(input: Record<string, string>) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("settings:update", () =>
      saveSettings(
        token,
        Object.entries(input).map(([key, value]) => ({ key, value })),
      ),
    );
    if (!result) {
      return false;
    }
    setSettingsMap(result.settingsMap);
    return true;
  }

  async function verifyLinearConnection() {
    if (!token) {
      return null;
    }
    return runBusyAction("linear:test", () => testLinearConnection(token));
  }

  async function verifyGitHubConnection() {
    if (!token) {
      return null;
    }
    return runBusyAction("github:test", () => testGitHubConnection(token));
  }

  async function loadGitHubRepos(query?: string) {
    if (!token) {
      return [];
    }
    const result = await runBusyAction("github:repos", () => fetchGitHubRepos(token, query));
    return result?.repos ?? [];
  }

  async function syncGitHub(missionId: string) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("issues:sync-github", () => syncGitHubIssues(token, missionId));
    if (!result) {
      return false;
    }
    setIssues(result.issues);
    return true;
  }

  async function verifyEngineConnection(engineId: string, config: Record<string, unknown>) {
    if (!token) {
      return null;
    }
    return runBusyAction(`engine:${engineId}:test`, () => testEngineConnection(token, engineId, config));
  }

  async function openDoc(path: string) {
    setQueryState((current) => ({ ...current, docPath: path }));
    setActiveView("docs", { search: `path=${encodeURIComponent(path)}` });
    if (!token) {
      return;
    }
    const result = await runBusyAction(`doc:${path}`, () => fetchDocContent(token, path));
    if (result) {
      setDocContent(result.content);
    }
  }

  async function performSearch(query: string) {
    setQueryState((current) => ({ ...current, q: query }));
    setActiveView("search", { search: `q=${encodeURIComponent(query)}` });
    if (!token || !query) {
      setSearchResults({ agents: [], missions: [], issues: [], runs: [], comments: [] });
      return;
    }
    const result = await runBusyAction(`search:${query}`, () => searchAll(token, query));
    if (result) {
      setSearchResults(result);
    }
  }

  async function sendFeedback(input: { type: string; message: string }) {
    if (!token) {
      return false;
    }
    const result = await runBusyAction("feedback:create", () => submitFeedback(token, input));
    return Boolean(result);
  }

  const derivedAgents = useMemo(
    () =>
      agents.map((agent) => {
        const recentRun = runs.find((run) => run.agent_id === agent.id);
        const status = normalizeStatus(recentRun?.status ?? "idle", agent.active);
        return {
          ...agent,
          engineLabel: engineLabel(agent.engine),
          statusLabel: status,
          lastRunLabel: recentRun ? recentRun.started_at : null,
          avatarText: agent.emoji && /\p{Emoji_Presentation}/u.test(agent.emoji) ? agent.emoji : agent.name.charAt(0).toUpperCase(),
        };
      }),
    [agents, runs],
  );

  return {
    activeView,
    setActiveView,
    bootstrap,
    token,
    user,
    project,
    engines,
    settingsMap,
    agents,
    derivedAgents,
    relationships,
    missions,
    issues,
    runs,
    schedules,
    selectedRun,
    selectedIssueComments,
    issueRuns,
    agentMessages,
    docs,
    docContent,
    searchQuery,
    setSearchQuery: (query: string) => setQueryState((current) => ({ ...current, q: query })),
    searchResults,
    docPath,
    selectedAgentId,
    setSelectedAgentId,
    selectedMissionId,
    setSelectedMissionId,
    connectionState,
    busyKey,
    error,
    loading,
    register,
    login,
    logout,
    saveProfile,
    updatePassword,
    saveProject,
    wipeProject,
    refreshWorkspace,
    createAgent: createAgentRecord,
    editAgent: editAgentRecord,
    removeAgent: removeAgentRecord,
    testAgentConnection: verifyAgentConnection,
    createMission: createMissionRecord,
    updateMission: saveMissionRecord,
    removeMission: removeMissionRecord,
    assignMissionAgent: addMissionAgent,
    removeMissionAgent: dropMissionAgent,
    startMission: launchMission,
    refreshIssues,
    createIssue: createIssueRecord,
    updateIssue: saveIssueRecord,
    removeIssue: removeIssueRecord,
    loadIssueComments,
    addIssueComment: addIssueCommentRecord,
    removeIssueComment: removeIssueCommentRecord,
    loadIssueRuns,
    runIssue,
    syncLinear,
    syncGitHub,
    testGitHubConnection: verifyGitHubConnection,
    loadGitHubRepos,
    refreshRuns,
    silentRefreshRuns,
    silentRefreshAgents,
    silentRefreshRelationships,
    refreshSchedules,
    createSchedule: createScheduleRecord,
    updateSchedule: saveScheduleRecord,
    removeSchedule: removeScheduleRecord,
    runSchedule: runScheduleRecord,
    createRun: createRunRecord,
    removeRun: removeRunRecord,
    loadRun,
    streamSelectedRun,
    refreshOrgMessages,
    sendAgentMessage: sendAgentMessageRecord,
    persistPositions,
    addRelationship: addRelationshipRecord,
    removeRelationship: removeRelationshipRecord,
    updateSettingsMap,
    testLinearConnection: verifyLinearConnection,
    testEngineConnection: verifyEngineConnection,
    openDoc,
    performSearch,
    sendFeedback,
  };
}

export type MissionControlState = ReturnType<typeof useMissionControl>;
