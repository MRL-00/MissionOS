import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentRecord, MissionRecord, RunRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { RunLog } from "./RunLog";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    agent_id: "agent-1",
    mission_id: null,
    issue_id: null,
    schedule_id: null,
    engine: "codex",
    status: "complete",
    prompt: "Ship the report",
    output: "Done",
    tool_calls: [],
    started_at: "2026-05-06T00:00:00.000Z",
    finished_at: "2026-05-06T00:01:00.000Z",
    duration_ms: 60_000,
    working_directory: null,
    github_branch: null,
    github_pr_url: null,
    parent_run_id: null,
    plan_step_id: null,
    execution_plan: null,
    agent_name: "Live Agent",
    agent_emoji: "A",
    agent_color: "#5e4ae3",
    mission_title: null,
    issue_title: null,
    ...overrides,
  };
}

function makeMission(overrides: Partial<MissionRecord>): MissionRecord {
  const id = overrides.id ?? "mission-1";
  return {
    id,
    title: "Mission",
    description: null,
    status: "active",
    team_name: "Engineering",
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
    missions: [],
    agents: [],
    engines: [{ id: "codex", label: "Codex", description: "", connectionType: "cli", fields: [] }],
    runs: [makeRun()],
    selectedMissionId: null,
    settingsMap: {},
    busyKey: null,
    error: null,
    selectedRun: null,
    createRun: vi.fn(async () => null),
    removeRun: vi.fn(async () => true),
    loadRun: vi.fn(async () => null),
    streamSelectedRun: vi.fn(async () => undefined),
    silentRefreshRuns: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("RunLog", () => {
  it("defaults the run history to the selected mission", () => {
    render(
      <RunLog
        mission={makeMissionControl({
          selectedMissionId: "engineering",
          missions: [
            makeMission({ id: "engineering", title: "Engineering migration" }),
            makeMission({ id: "marketing", title: "Campaign launch", team_name: "Marketing" }),
          ],
          runs: [
            makeRun({ id: "run-engineering", mission_id: "engineering", mission_title: "Engineering migration" }),
            makeRun({ id: "run-marketing", mission_id: "marketing", mission_title: "Campaign launch" }),
          ],
        })}
      />,
    );

    expect(screen.getAllByText("Engineering migration").length).toBeGreaterThan(0);
    expect(screen.queryByText("Campaign launch")).not.toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("does not allow active runs to be deleted from the expanded row", async () => {
    const removeRun = vi.fn(async () => true);
    render(<RunLog mission={makeMissionControl({ runs: [makeRun({ status: "running" })], removeRun })} />);

    fireEvent.click(screen.getByText("Live Agent").closest("button")!);

    const deleteButton = await screen.findByRole("button", { name: "Delete Run" });
    expect(deleteButton).toBeDisabled();
    expect(screen.getByText("Active runs can be deleted after they finish.")).toBeInTheDocument();

    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(removeRun).not.toHaveBeenCalled();
    });
  });

  it("only offers active supported agents when triggering manual runs", () => {
    render(
      <RunLog
        mission={makeMissionControl({
          agents: [
            makeAgent({ id: "agent-ready", name: "Ready Agent", engine: "codex", active: true }),
            makeAgent({ id: "agent-inactive", name: "Inactive Agent", engine: "codex", active: false }),
            makeAgent({ id: "agent-legacy", name: "Legacy Agent", engine: "legacy-engine", active: true }),
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByText("Select agent"));

    expect(screen.getByRole("option", { name: "Ready Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Inactive Agent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Legacy Agent" })).not.toBeInTheDocument();
  });

  it("only offers mission-staffed agents when triggering mission runs", () => {
    const assignedAgent = makeAgent({ id: "agent-assigned", name: "Assigned Agent", engine: "codex", active: true });
    const outsideAgent = makeAgent({ id: "agent-outside", name: "Outside Agent", engine: "codex", active: true });

    render(
      <RunLog
        mission={makeMissionControl({
          selectedMissionId: "mission-1",
          missions: [makeMission({ id: "mission-1", title: "Finance Mission", assigned_agents: [assignedAgent] })],
          agents: [assignedAgent, outsideAgent],
        })}
      />,
    );

    fireEvent.click(screen.getByText("Select agent"));

    expect(screen.getByRole("option", { name: "Assigned Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Outside Agent" })).not.toBeInTheDocument();
  });

  it("clears a selected agent when changing to a mission where they are not staffed", () => {
    const assignedAgent = makeAgent({ id: "agent-assigned", name: "Assigned Agent", engine: "codex", active: true });
    const outsideAgent = makeAgent({ id: "agent-outside", name: "Outside Agent", engine: "codex", active: true });
    const createRun = vi.fn(async () => null);

    render(
      <RunLog
        mission={makeMissionControl({
          missions: [makeMission({ id: "mission-1", title: "Finance Mission", assigned_agents: [assignedAgent] })],
          agents: [assignedAgent, outsideAgent],
          createRun,
        })}
      />,
    );

    fireEvent.click(screen.getByText("Select agent"));
    fireEvent.click(screen.getByRole("option", { name: "Outside Agent" }));
    fireEvent.click(screen.getAllByRole("combobox")[0]!);
    fireEvent.click(screen.getByRole("option", { name: "Finance Mission" }));
    fireEvent.change(screen.getByPlaceholderText("Enter run prompt..."), { target: { value: "Do the work" } });

    const runButton = screen.getByRole("button", { name: "Run Agent" });
    expect(runButton).toBeDisabled();
    fireEvent.click(runButton);

    expect(createRun).not.toHaveBeenCalled();
  });
});
