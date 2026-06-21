import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentRecord, IssueRecord, MissionRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { IssuesBoard } from "./IssuesBoard";

function makeMission(overrides: Partial<MissionRecord>): MissionRecord {
  const id = overrides.id ?? "mission-1";
  return {
    id,
    title: "Mission",
    description: null,
    status: "active",
    team_name: "Finance",
    color: null,
    lead_agent_id: null,
    lead_agent_name: null,
    lead_agent_emoji: null,
    linear_project_id: null,
    github_repo: null,
    github_default_branch: "main",
    created_at: "2026-05-06T00:00:00.000Z",
    updated_at: "2026-05-06T00:00:00.000Z",
    assigned_agents: [],
    issue_counts: { total: 0, complete: 0 },
    progress: 0,
    last_active_at: "2026-05-06T00:00:00.000Z",
    ...overrides,
  };
}

function makeIssue(overrides: Partial<IssueRecord>): IssueRecord {
  return {
    id: "issue-1",
    issue_number: 1,
    title: "Issue",
    description: null,
    status: "todo",
    priority: "medium",
    assignee_agent_id: null,
    mission_id: null,
    labels: [],
    source: "native",
    linear_id: null,
    github_id: null,
    github_number: null,
    github_repo: null,
    github_branch: null,
    github_pr_number: null,
    github_pr_url: null,
    estimation: null,
    created_at: "2026-05-06T00:00:00.000Z",
    updated_at: "2026-05-06T00:00:00.000Z",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-ready",
    name: "Ready Agent",
    role: "Engineer",
    emoji: "R",
    color: "#7c3aed",
    engine: "codex",
    skills: [],
    tools: [],
    connection_type: "cli",
    connection_config: {},
    soul_md: null,
    agents_md: null,
    external_config: false,
    active: true,
    created_at: "2026-05-06T00:00:00.000Z",
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    selectedMissionId: "finance",
    engines: [{ id: "codex", label: "Codex", description: "", connectionType: "cli", fields: [] }],
    missions: [
      makeMission({ id: "engineering", title: "Engineering Mission", team_name: "Engineering" }),
      makeMission({ id: "finance", title: "Finance Mission", team_name: "Finance" }),
    ],
    issues: [
      makeIssue({ id: "engineering-issue", title: "Engineering issue", mission_id: "engineering", mission_title: "Engineering Mission" }),
      makeIssue({ id: "finance-issue", title: "Finance issue", mission_id: "finance", mission_title: "Finance Mission" }),
    ],
    agents: [],
    runs: [],
    issueRuns: [],
    selectedIssueComments: [],
    settingsMap: {},
    loadGitHubRepos: vi.fn(async () => []),
    loadIssueComments: vi.fn(async () => []),
    loadIssueRuns: vi.fn(async () => []),
    silentRefreshIssues: vi.fn(async () => undefined),
    createIssue: vi.fn(async () => true),
    updateIssue: vi.fn(async () => true),
    removeIssue: vi.fn(async () => ({ ok: true })),
    addIssueComment: vi.fn(async () => true),
    removeIssueComment: vi.fn(async () => true),
    runIssue: vi.fn(async () => null),
    streamSelectedRun: vi.fn(async () => undefined),
    refreshIssues: vi.fn(async () => undefined),
    refreshRuns: vi.fn(async () => undefined),
    syncLinear: vi.fn(async () => true),
    syncGitHub: vi.fn(async () => true),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("IssuesBoard", () => {
  it("defaults issue scope and new issue mission to the selected mission", async () => {
    render(<IssuesBoard mission={makeMissionControl()} />);

    await waitFor(() => {
      expect(screen.getAllByText("Finance issue").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Engineering issue")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New Issue" }));

    expect(screen.getAllByText("Finance Mission").length).toBeGreaterThan(1);
  });

  it("only offers active supported agents for issue runs", async () => {
    const readyAgent = makeAgent({ id: "agent-ready", name: "Ready Agent", engine: "codex", active: true });
    render(
      <IssuesBoard
        mission={makeMissionControl({
          missions: [
            makeMission({ id: "finance", title: "Finance Mission", team_name: "Finance", assigned_agents: [readyAgent] }),
          ],
          issues: [makeIssue({ id: "finance-issue", title: "Finance issue", mission_id: "finance", mission_title: "Finance Mission" })],
          agents: [
            readyAgent,
            makeAgent({ id: "agent-inactive", name: "Inactive Agent", engine: "codex", active: false }),
            makeAgent({ id: "agent-legacy", name: "Legacy Agent", engine: "legacy-engine", active: true }),
          ],
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Finance issue").length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("option", { name: "Select agent..." })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "R Ready Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "I Inactive Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "L Legacy Agent" })).not.toBeInTheDocument();
  });
});
