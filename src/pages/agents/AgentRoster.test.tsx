import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentRecord, MissionRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { AgentRoster } from "./AgentRoster";

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    name: "Finance Agent",
    role: "Analyst",
    emoji: "F",
    color: "#5e4ae3",
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
    title: "Finance close",
    description: null,
    status: "planning",
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
  const agent = makeAgent();
  return {
    agents: [agent],
    derivedAgents: [
      {
        ...agent,
        engineLabel: "Codex",
        statusLabel: "Idle",
        lastRunLabel: null,
        avatarText: "F",
      },
    ],
    missions: [],
    issues: [],
    runs: [],
    schedules: [],
    agentMessages: [],
    settingsMap: {},
    removeAgent: vi.fn(async () => true),
    testAgentConnection: vi.fn(async () => null),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("AgentRoster", () => {
  it("shows dynamic engine filters for custom engines", async () => {
    const customAgent = makeAgent({ id: "agent-custom", name: "Custom Agent", engine: "custom-engine" });
    render(
      <AgentRoster
        mission={makeMissionControl({
          agents: [customAgent],
          derivedAgents: [
            {
              ...customAgent,
              engineLabel: "Custom Engine",
              statusLabel: "Idle",
              lastRunLabel: null,
              avatarText: "C",
            },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByText("All Engines"));

    await waitFor(() => {
      expect(screen.getAllByText("Custom Engine").length).toBeGreaterThan(1);
    });
  });

  it("does not allow deleting agents that are assigned to missions", () => {
    const removeAgent = vi.fn(async () => true);
    render(
      <AgentRoster
        mission={makeMissionControl({
          missions: [makeMission({ assigned_agents: [{ id: "agent-1", name: "Finance Agent", role: "Analyst", emoji: "F", color: "#5e4ae3" }] })],
          removeAgent,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Finance Agent actions" }));

    const deleteButton = screen.getByRole("button", { name: "Delete Agent" });
    expect(deleteButton).toBeDisabled();
    expect(screen.getByText("Reassign this agent from missions before deleting it.")).toBeInTheDocument();

    fireEvent.click(deleteButton);

    expect(removeAgent).not.toHaveBeenCalled();
  });
});
