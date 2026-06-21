import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentRecord, IssueRecord, MissionRecord, RunRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { IssueBoardView, IssueCreateModal, IssueEditModal, issueAssigneeForMission, type IssueCreateDraft, type IssueEditDraft } from "./IssueBoardParts";

function makeIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: "issue-1",
    issue_number: 1,
    title: "Follow up",
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

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    agent_id: null,
    mission_id: null,
    issue_id: "issue-1",
    schedule_id: null,
    engine: "codex",
    status: "running",
    prompt: "Work on issue",
    output: "",
    tool_calls: [],
    started_at: "2026-05-06T00:00:00.000Z",
    finished_at: null,
    duration_ms: null,
    working_directory: null,
    github_branch: null,
    github_pr_url: null,
    parent_run_id: null,
    plan_step_id: null,
    execution_plan: null,
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

function makeMission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "mission-1",
    title: "Finance Mission",
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

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    agents: [],
    engines: [{ id: "codex", label: "Codex", description: "", connectionType: "cli", fields: [] }],
    missions: [],
    runs: [makeRun()],
    settingsMap: {},
    ...overrides,
  } as unknown as MissionControlState;
}

function makeEditDraft(issue: IssueRecord): IssueEditDraft {
  return {
    title: issue.title,
    description: issue.description ?? "",
    status: issue.status,
    priority: issue.priority,
    assignee_agent_id: issue.assignee_agent_id ?? "",
    mission_id: issue.mission_id ?? "",
    github_repo: issue.github_repo ?? "",
    estimation: issue.estimation ?? "",
    labels: issue.labels.join(", "),
  };
}

function makeCreateDraft(overrides: Partial<IssueCreateDraft> = {}): IssueCreateDraft {
  return {
    title: "",
    description: "",
    status: "backlog",
    priority: "medium",
    assignee_agent_id: "",
    mission_id: "",
    github_repo: "",
    estimation: "",
    ...overrides,
  };
}

describe("IssueEditModal", () => {
  it("does not allow deleting issues while linked runs are active", () => {
    const issue = makeIssue();
    const onDelete = vi.fn(async () => undefined);

    render(
      <IssueEditModal
        mission={makeMissionControl()}
        editingIssue={issue}
        editFullScreen={false}
        setEditFullScreen={vi.fn()}
        editDraft={makeEditDraft(issue)}
        setEditDraft={vi.fn()}
        editRepoQuery=""
        setEditRepoQuery={vi.fn()}
        editRepoOptions={[]}
        onSearchRepos={vi.fn()}
        getInheritedRepo={() => null}
        confirmDelete={false}
        setConfirmDelete={vi.fn()}
        deleteError={null}
        comments={[]}
        newComment=""
        onNewCommentChange={vi.fn()}
        onPostComment={vi.fn(async () => undefined)}
        onDeleteComment={vi.fn(async () => undefined)}
        onReplyComment={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton).toBeDisabled();
    expect(screen.getByText("Active runs must finish first.")).toBeInTheDocument();

    fireEvent.click(deleteButton);

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("only offers active supported agents as assignees", () => {
    const issue = makeIssue();

    render(
      <IssueEditModal
        mission={makeMissionControl({
          agents: [
            makeAgent({ id: "agent-ready", name: "Ready Agent", engine: "codex", active: true }),
            makeAgent({ id: "agent-inactive", name: "Inactive Agent", engine: "codex", active: false }),
            makeAgent({ id: "agent-legacy", name: "Legacy Agent", engine: "legacy-engine", active: true }),
          ],
        })}
        editingIssue={issue}
        editFullScreen={false}
        setEditFullScreen={vi.fn()}
        editDraft={makeEditDraft(issue)}
        setEditDraft={vi.fn()}
        editRepoQuery=""
        setEditRepoQuery={vi.fn()}
        editRepoOptions={[]}
        onSearchRepos={vi.fn()}
        getInheritedRepo={() => null}
        confirmDelete={false}
        setConfirmDelete={vi.fn()}
        deleteError={null}
        comments={[]}
        newComment=""
        onNewCommentChange={vi.fn()}
        onPostComment={vi.fn(async () => undefined)}
        onDeleteComment={vi.fn(async () => undefined)}
        onReplyComment={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getAllByRole("combobox")[2]!);

    expect(screen.getByRole("option", { name: "Ready Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Inactive Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Legacy Agent" })).not.toBeInTheDocument();
  });

  it("only offers mission-staffed agents when editing mission issues", () => {
    const assignedAgent = makeAgent({ id: "agent-assigned", name: "Assigned Agent", engine: "codex", active: true });
    const outsideAgent = makeAgent({ id: "agent-outside", name: "Outside Agent", engine: "codex", active: true });
    const issue = makeIssue({ mission_id: "mission-1" });

    render(
      <IssueEditModal
        mission={makeMissionControl({
          agents: [assignedAgent, outsideAgent],
          missions: [makeMission({ id: "mission-1", assigned_agents: [assignedAgent] })],
        })}
        editingIssue={issue}
        editFullScreen={false}
        setEditFullScreen={vi.fn()}
        editDraft={makeEditDraft(issue)}
        setEditDraft={vi.fn()}
        editRepoQuery=""
        setEditRepoQuery={vi.fn()}
        editRepoOptions={[]}
        onSearchRepos={vi.fn()}
        getInheritedRepo={() => null}
        confirmDelete={false}
        setConfirmDelete={vi.fn()}
        deleteError={null}
        comments={[]}
        newComment=""
        onNewCommentChange={vi.fn()}
        onPostComment={vi.fn(async () => undefined)}
        onDeleteComment={vi.fn(async () => undefined)}
        onReplyComment={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getAllByRole("combobox")[2]!);

    expect(screen.getByRole("option", { name: "Assigned Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Outside Agent" })).not.toBeInTheDocument();
  });

  it("clears an assignee when changing to a mission where they are not staffed", () => {
    const assignedAgent = makeAgent({ id: "agent-assigned", name: "Assigned Agent", engine: "codex", active: true });
    const outsideAgent = makeAgent({ id: "agent-outside", name: "Outside Agent", engine: "codex", active: true });
    const mission = makeMissionControl({
      agents: [assignedAgent, outsideAgent],
      missions: [makeMission({ id: "mission-1", title: "Finance Mission", assigned_agents: [assignedAgent] })],
    });

    expect(issueAssigneeForMission(mission, "mission-1", "agent-outside")).toBe("");
    expect(issueAssigneeForMission(mission, "mission-1", "agent-assigned")).toBe("agent-assigned");
  });
});

describe("IssueCreateModal", () => {
  it("only offers active supported agents as assignees", () => {
    render(
      <IssueCreateModal
        open
        mission={makeMissionControl({
          agents: [
            makeAgent({ id: "agent-ready", name: "Ready Agent", engine: "codex", active: true }),
            makeAgent({ id: "agent-inactive", name: "Inactive Agent", engine: "codex", active: false }),
            makeAgent({ id: "agent-legacy", name: "Legacy Agent", engine: "legacy-engine", active: true }),
          ],
        })}
        draft={makeCreateDraft()}
        setDraft={vi.fn()}
        createRepoQuery=""
        setCreateRepoQuery={vi.fn()}
        createRepoOptions={[]}
        onSearchRepos={vi.fn()}
        getInheritedRepo={() => null}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getAllByRole("combobox")[2]!);

    expect(screen.getByRole("option", { name: "Ready Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Inactive Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Legacy Agent" })).not.toBeInTheDocument();
  });

  it("only offers mission-staffed agents when creating mission issues", () => {
    const assignedAgent = makeAgent({ id: "agent-assigned", name: "Assigned Agent", engine: "codex", active: true });
    const outsideAgent = makeAgent({ id: "agent-outside", name: "Outside Agent", engine: "codex", active: true });

    render(
      <IssueCreateModal
        open
        mission={makeMissionControl({
          agents: [assignedAgent, outsideAgent],
          missions: [makeMission({ id: "mission-1", assigned_agents: [assignedAgent] })],
        })}
        draft={makeCreateDraft({ mission_id: "mission-1" })}
        setDraft={vi.fn()}
        createRepoQuery=""
        setCreateRepoQuery={vi.fn()}
        createRepoOptions={[]}
        onSearchRepos={vi.fn()}
        getInheritedRepo={() => null}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getAllByRole("combobox")[2]!);

    expect(screen.getByRole("option", { name: "Assigned Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Outside Agent" })).not.toBeInTheDocument();
  });

  it("clears an assignee when changing to a mission where they are not staffed", () => {
    const assignedAgent = makeAgent({ id: "agent-assigned", name: "Assigned Agent", engine: "codex", active: true });
    const outsideAgent = makeAgent({ id: "agent-outside", name: "Outside Agent", engine: "codex", active: true });
    const mission = makeMissionControl({
      agents: [assignedAgent, outsideAgent],
      missions: [makeMission({ id: "mission-1", title: "Finance Mission", assigned_agents: [assignedAgent] })],
    });

    expect(issueAssigneeForMission(mission, "mission-1", "agent-outside")).toBe("");
    expect(issueAssigneeForMission(mission, null, "agent-outside")).toBe("agent-outside");
  });
});

describe("IssueBoardView", () => {
  it("only offers active supported agents in inline assignment controls", () => {
    const issue = makeIssue({ id: "issue-1", title: "Inline issue", status: "todo" });

    render(
      <IssueBoardView
        mission={makeMissionControl({
          issues: [issue],
          agents: [
            makeAgent({ id: "agent-ready", name: "Ready Agent", engine: "codex", active: true }),
            makeAgent({ id: "agent-inactive", name: "Inactive Agent", engine: "codex", active: false }),
            makeAgent({ id: "agent-legacy", name: "Legacy Agent", engine: "legacy-engine", active: true }),
          ],
          updateIssue: vi.fn(async () => true),
        })}
        filteredIssues={[issue]}
        selectedIssueId={issue.id}
        onSelectIssue={vi.fn()}
        onEditIssue={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("Unassigned"));

    expect(screen.getByRole("button", { name: /Ready Agent/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Inactive Agent/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Legacy Agent/ })).not.toBeInTheDocument();
  });

  it("only offers mission-staffed agents in inline assignment controls for mission issues", () => {
    const assignedAgent = makeAgent({ id: "agent-assigned", name: "Assigned Agent", engine: "codex", active: true });
    const outsideAgent = makeAgent({ id: "agent-outside", name: "Outside Agent", engine: "codex", active: true });
    const issue = makeIssue({ id: "issue-1", title: "Inline issue", status: "todo", mission_id: "mission-1" });

    render(
      <IssueBoardView
        mission={makeMissionControl({
          issues: [issue],
          agents: [assignedAgent, outsideAgent],
          missions: [makeMission({ id: "mission-1", assigned_agents: [assignedAgent] })],
          updateIssue: vi.fn(async () => true),
        })}
        filteredIssues={[issue]}
        selectedIssueId={issue.id}
        onSelectIssue={vi.fn()}
        onEditIssue={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("Unassigned"));

    expect(screen.getByRole("button", { name: /Assigned Agent/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Outside Agent/ })).not.toBeInTheDocument();
  });
});
