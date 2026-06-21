import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentRecord, MissionRecord, RunRecord, ScheduleRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { SchedulesPage } from "./SchedulesPage";

function makeSchedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "schedule-1",
    name: "Daily Finance Sweep",
    mission_id: null,
    agent_id: "agent-1",
    prompt: "Review the finance queue.",
    cron_expression: "0 9 * * *",
    enabled: true,
    max_runs: null,
    run_count: 1,
    last_run_at: null,
    next_run_at: null,
    last_error: null,
    created_at: "2026-05-06T00:00:00.000Z",
    updated_at: "2026-05-06T00:00:00.000Z",
    agent_name: "Finance Agent",
    agent_emoji: "F",
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    agent_id: "agent-1",
    mission_id: null,
    issue_id: null,
    schedule_id: "schedule-1",
    engine: "codex",
    status: "running",
    prompt: "Review the finance queue.",
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
    agent_name: "Finance Agent",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    name: "Finance Agent",
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
    selectedMissionId: null,
    schedules: [makeSchedule()],
    runs: [],
    missions: [],
    agents: [],
    engines: [{ id: "codex", label: "Codex", description: "", connectionType: "cli", fields: [] }],
    settingsMap: {},
    refreshSchedules: vi.fn(async () => undefined),
    runSchedule: vi.fn(async () => null),
    updateSchedule: vi.fn(async () => true),
    createSchedule: vi.fn(async () => makeSchedule()),
    removeSchedule: vi.fn(async () => true),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("SchedulesPage", () => {
  it("does not offer deletion while a schedule has active linked runs", () => {
    const removeSchedule = vi.fn(async () => true);
    render(
      <SchedulesPage
        mission={makeMissionControl({
          runs: [makeRun({ status: "running" })],
          removeSchedule,
        })}
      />,
    );

    expect(screen.getByText("Active schedule runs must finish before deletion.")).toBeInTheDocument();
    const deleteButton = screen.getByRole("button", { name: "Delete schedule" });
    expect(deleteButton).toBeDisabled();

    fireEvent.click(deleteButton);

    expect(removeSchedule).not.toHaveBeenCalled();
  });

  it("shows schedule select labels instead of raw ids", () => {
    render(
      <SchedulesPage
        mission={makeMissionControl({
          selectedMissionId: "mission-1",
          schedules: [makeSchedule({ mission_id: "mission-1", mission_title: "Finance Mission" })],
          missions: [makeMission()],
          agents: [makeAgent()],
        })}
      />,
    );

    expect(screen.getAllByText("Finance Mission").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByText("Daily Finance Sweep"));

    expect(screen.getAllByText(/Finance Agent/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("mission-1")).not.toBeInTheDocument();
    expect(screen.queryByText("agent-1")).not.toBeInTheDocument();
  });

  it("locks mission changes while editing a schedule with active linked runs", () => {
    render(
      <SchedulesPage
        mission={makeMissionControl({
          schedules: [makeSchedule({ mission_id: "mission-1", mission_title: "Finance Mission" })],
          runs: [makeRun({ status: "planning" })],
          missions: [makeMission()],
          agents: [makeAgent()],
        })}
      />,
    );

    fireEvent.click(screen.getByText("Daily Finance Sweep"));

    expect(screen.getByText("Mission changes are locked while this schedule has active runs.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /mission/i })).toBeDisabled();
  });

  it("only offers active supported agents for schedules", () => {
    render(
      <SchedulesPage
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

  it("only offers mission-staffed agents for mission schedules", () => {
    const assignedAgent = makeAgent({ id: "agent-assigned", name: "Assigned Agent", engine: "codex", active: true });
    const outsideAgent = makeAgent({ id: "agent-outside", name: "Outside Agent", engine: "codex", active: true });

    render(
      <SchedulesPage
        mission={makeMissionControl({
          schedules: [makeSchedule({ mission_id: "mission-1", agent_id: "agent-assigned", agent_name: "Assigned Agent" })],
          missions: [makeMission({ id: "mission-1", title: "Finance Mission", assigned_agents: [assignedAgent] })],
          agents: [assignedAgent, outsideAgent],
        })}
      />,
    );

    fireEvent.click(screen.getByText("Daily Finance Sweep"));
    fireEvent.click(screen.getByRole("combobox", { name: "Agent" }));

    expect(screen.getByRole("option", { name: "Assigned Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Outside Agent" })).not.toBeInTheDocument();
  });

  it("clears a selected agent when changing to a mission where they are not staffed", () => {
    const assignedAgent = makeAgent({ id: "agent-assigned", name: "Assigned Agent", engine: "codex", active: true });
    const outsideAgent = makeAgent({ id: "agent-outside", name: "Outside Agent", engine: "codex", active: true });
    const createSchedule = vi.fn(async () => makeSchedule());

    render(
      <SchedulesPage
        mission={makeMissionControl({
          schedules: [],
          missions: [makeMission({ id: "mission-1", title: "Finance Mission", assigned_agents: [assignedAgent] })],
          agents: [assignedAgent, outsideAgent],
          createSchedule,
        })}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Morning backlog sweep"), { target: { value: "Daily work" } });
    fireEvent.click(screen.getByText("Select agent"));
    fireEvent.click(screen.getByRole("option", { name: "Outside Agent" }));
    fireEvent.click(screen.getByText("No mission"));
    fireEvent.click(screen.getByRole("option", { name: "Finance Mission" }));
    fireEvent.change(screen.getByPlaceholderText("Review new issues in Linear, cluster them by urgency, and post a short summary."), {
      target: { value: "Do the work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Schedule" }));

    expect(screen.getByText("Select an agent.")).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();
  });
});
