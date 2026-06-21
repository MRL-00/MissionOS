import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentRecord, MissionRecord, RunRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { MissionsDashboard } from "./MissionsDashboard";

function makeMission(overrides: Partial<MissionRecord>): MissionRecord {
  const id = overrides.id ?? "mission-1";
  return {
    id,
    title: "Mission",
    description: null,
    status: "planning",
    team_name: "General",
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

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    name: "Finance Analyst",
    role: "Analyst",
    emoji: "F",
    color: "#7c3aed",
    engine: "codex",
    skills: [],
    tools: [],
    connection_type: null,
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
    missions: [
      makeMission({ id: "engineering", title: "Engineering migration", team_name: "Engineering" }),
      makeMission({ id: "marketing", title: "Campaign launch", team_name: "Marketing" }),
    ],
    agents: [],
    derivedAgents: [],
    engines: [
      {
        id: "codex",
        label: "Codex",
        description: "Code execution",
        connectionType: "cli",
        fields: [],
      },
    ],
    issues: [],
    runs: [],
    settingsMap: {},
    busyKey: null,
    error: null,
    setActiveView: vi.fn(),
    createMission: vi.fn(async () => makeMission({ id: "created", title: "Created", team_name: "Sales" })),
    updateMission: vi.fn(async () => true),
    assignMissionAgent: vi.fn(async () => true),
    removeMissionAgent: vi.fn(async () => true),
    startMission: vi.fn(async () => true),
    loadGitHubRepos: vi.fn(async () => []),
    ...overrides,
  } as unknown as MissionControlState;
}

function makeRun(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: "run-1",
    agent_id: null,
    mission_id: null,
    issue_id: null,
    schedule_id: null,
    engine: "codex",
    status: "running",
    prompt: "Run",
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

describe("MissionsDashboard", () => {
  it("filters mission cards by team", async () => {
    render(<MissionsDashboard mission={makeMissionControl()} />);

    expect(screen.getAllByText("Engineering migration").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Campaign launch").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Sales" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finance" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Marketing" }));

    await waitFor(() => {
      expect(screen.queryAllByText("Engineering migration")).toHaveLength(0);
    });
    expect(screen.getAllByText("Campaign launch").length).toBeGreaterThan(0);
  });

  it("does not show another team's mission details when the filtered team is empty", async () => {
    render(<MissionsDashboard mission={makeMissionControl()} />);

    fireEvent.click(screen.getByRole("button", { name: "Finance" }));

    await waitFor(() => {
      expect(screen.queryAllByText("Engineering migration")).toHaveLength(0);
    });
    expect(screen.queryAllByText("Campaign launch")).toHaveLength(0);
    expect(screen.queryByText("Editing Mission")).not.toBeInTheDocument();
  });

  it("can start a mission from a preset team with no existing missions", async () => {
    const createMission = vi.fn(async () => makeMission({ id: "created", title: "Created", team_name: "Finance" }));
    render(<MissionsDashboard mission={makeMissionControl({ createMission })} />);

    fireEvent.click(screen.getByRole("button", { name: "New Mission" }));
    fireEvent.change(screen.getByPlaceholderText("Ship MissionOS backend"), { target: { value: "Close books" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Finance" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Create Mission" }));

    await waitFor(() => {
      expect(createMission).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Close books",
          team_name: "Finance",
        }),
      );
    });
  });

  it("includes the selected team when creating missions", async () => {
    const createMission = vi.fn(async () => makeMission({ id: "created", title: "Created", team_name: "Sales" }));
    render(<MissionsDashboard mission={makeMissionControl({ createMission })} />);

    fireEvent.click(screen.getByRole("button", { name: "New Mission" }));
    fireEvent.change(screen.getByPlaceholderText("Ship MissionOS backend"), { target: { value: "Sales forecast" } });
    fireEvent.change(screen.getByPlaceholderText("Engineering"), { target: { value: "Sales" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Mission" }));

    await waitFor(() => {
      expect(createMission).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Sales forecast",
          team_name: "Sales",
        }),
      );
    });
  });

  it("shows selected lead agent names instead of raw ids when creating missions", async () => {
    render(<MissionsDashboard mission={makeMissionControl({ agents: [makeAgent()] })} />);

    fireEvent.click(screen.getByRole("button", { name: "New Mission" }));
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Finance Analyst" }));

    expect(screen.getAllByText("Finance Analyst").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("agent-1")).not.toBeInTheDocument();
  });

  it("only offers active supported agents when creating missions", async () => {
    render(
      <MissionsDashboard
        mission={makeMissionControl({
          agents: [
            makeAgent({ id: "agent-ready", name: "Ready Agent", engine: "codex", active: true }),
            makeAgent({ id: "agent-inactive", name: "Inactive Agent", engine: "codex", active: false }),
            makeAgent({ id: "agent-legacy", name: "Legacy Agent", engine: "legacy-engine", active: true }),
          ],
          derivedAgents: [
            { ...makeAgent({ id: "agent-ready", name: "Ready Agent", engine: "codex", active: true }), engineLabel: "Codex", avatarText: "R", statusLabel: "Idle", lastRunLabel: null },
            { ...makeAgent({ id: "agent-inactive", name: "Inactive Agent", engine: "codex", active: false }), engineLabel: "Codex", avatarText: "I", statusLabel: "Offline", lastRunLabel: null },
            { ...makeAgent({ id: "agent-legacy", name: "Legacy Agent", engine: "legacy-engine", active: true }), engineLabel: "Legacy", avatarText: "L", statusLabel: "Idle", lastRunLabel: null },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Mission" }));
    fireEvent.click(screen.getByRole("combobox"));

    expect(screen.getByRole("option", { name: "Ready Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Inactive Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Legacy Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ready Agent/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Inactive Agent/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Legacy Agent/ })).not.toBeInTheDocument();
  });

  it("does not start completed missions from the detail panel", () => {
    const startMission = vi.fn(async () => true);
    render(<MissionsDashboard mission={makeMissionControl({ missions: [makeMission({ id: "done", status: "complete" })], startMission })} />);

    const startButton = screen.getByRole("button", { name: "Start Mission" });
    expect(startButton).toBeDisabled();

    fireEvent.click(startButton);

    expect(startMission).not.toHaveBeenCalled();
  });

  it("does not save completed status while the selected mission has active runs", async () => {
    const updateMission = vi.fn(async () => true);
    render(
      <MissionsDashboard
        mission={makeMissionControl({
          missions: [makeMission({ id: "active", status: "complete" })],
          runs: [makeRun({ mission_id: "active", status: "running" })],
          updateMission,
        })}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit mission"));

    expect(screen.getByText("Finish active runs before marking this mission complete.")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "Save Changes" });
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateMission).not.toHaveBeenCalled();
    });
  });

  it("can add and remove mission agents from the editor", async () => {
    const assignMissionAgent = vi.fn(async () => true);
    const removeMissionAgent = vi.fn(async () => true);
    render(
      <MissionsDashboard
        mission={makeMissionControl({
          missions: [
            makeMission({
              id: "finance",
              title: "Finance mission",
              team_name: "Finance",
              assigned_agents: [
                {
                  id: "agent-1",
                  name: "Finance Analyst",
                  role: "Analyst",
                  emoji: "F",
                  color: "#7c3aed",
                },
              ],
            }),
          ],
          agents: [
            makeAgent(),
            makeAgent({ id: "agent-2", name: "Sales Planner", role: "Planner", emoji: "S" }),
          ],
          assignMissionAgent,
          removeMissionAgent,
        })}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit mission"));
    fireEvent.click(screen.getByRole("button", { name: "Add Sales Planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Finance Analyst from mission" }));

    await waitFor(() => {
      expect(assignMissionAgent).toHaveBeenCalledWith("finance", "agent-2");
    });
    expect(removeMissionAgent).toHaveBeenCalledWith("finance", "agent-1");
  });

  it("only offers active supported agents when editing mission staffing", () => {
    render(
      <MissionsDashboard
        mission={makeMissionControl({
          missions: [makeMission({ id: "finance", title: "Finance mission", team_name: "Finance" })],
          agents: [
            makeAgent({ id: "agent-ready", name: "Ready Agent", engine: "codex", active: true }),
            makeAgent({ id: "agent-inactive", name: "Inactive Agent", engine: "codex", active: false }),
            makeAgent({ id: "agent-legacy", name: "Legacy Agent", engine: "legacy-engine", active: true }),
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit mission"));

    expect(screen.getByRole("button", { name: "Add Ready Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Inactive Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Legacy Agent" })).not.toBeInTheDocument();
  });

  it("does not remove mission agents with active linked runs from the editor", async () => {
    const removeMissionAgent = vi.fn(async () => true);
    render(
      <MissionsDashboard
        mission={makeMissionControl({
          missions: [
            makeMission({
              id: "finance",
              title: "Finance mission",
              team_name: "Finance",
              assigned_agents: [
                {
                  id: "agent-1",
                  name: "Finance Analyst",
                  role: "Analyst",
                  emoji: "F",
                  color: "#7c3aed",
                },
              ],
            }),
          ],
          agents: [makeAgent()],
          runs: [makeRun({ mission_id: "finance", agent_id: "agent-1", status: "running" })],
          removeMissionAgent,
        })}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit mission"));
    const removeButton = screen.getByRole("button", { name: "Remove Finance Analyst from mission" });
    expect(removeButton).toBeDisabled();

    fireEvent.click(removeButton);

    expect(removeMissionAgent).not.toHaveBeenCalled();
  });
});
