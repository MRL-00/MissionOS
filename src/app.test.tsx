import { render, screen, fireEvent } from "@testing-library/react";
import { App } from "./app";
import type { ProviderConnector } from "./mission/types";
import type { MissionView } from "./mission/hooks/useMissionControl";

function createMissionControlState(activeView: MissionView = "missions") {
  const connectors: ProviderConnector[] = [
    {
      id: "hermes",
      provider: "hermes",
      label: "Hermes",
      enabled: true,
      baseUrl: "hermes",
      authMode: "none",
      tokenConfigured: false,
      capabilities: {
        agents: true,
        schedules: true,
        activeWork: true,
        launch: true,
        subscribe: true,
      },
      health: {
        provider: "hermes",
        status: "ok",
        checkedAt: Date.now(),
        activeAgents: 1,
        schedules: 2,
        message: "Healthy",
      },
      lastSyncAt: Date.now(),
      useHermesDefaults: true,
      adapterConfig: {
        baseUrl: "hermes",
        runtimePort: 8642,
      },
      configFields: [
        { key: "baseUrl", label: "CLI command", type: "text" as const, placeholder: "hermes", required: true },
      ],
    },
  ];

  return {
    activeView,
    setActiveView: vi.fn(),
    agents: [
      {
        id: "pickle",
        name: "Pickle",
        role: "Orchestrator",
        emoji: "🥒",
        connected: true,
        status: "working",
        location: "desk",
        timestamp: Date.now(),
        task: "Coordinate mission control rollout",
        message: "Working through the queue.",
      },
    ],
    missionSnapshot: {
      connectors,
      hermesDefaults: {
        sshHost: "matt@192.168.1.113",
        runtimeHost: "http://192.168.1.113",
        tokenConfigured: true,
      },
      teamSettings: {},
      providerAgents: [],
      schedules: [],
      tasks: [
        {
          id: "task-1",
          identifier: "LIN-1",
          title: "Build mission control",
          priority: 2,
          state: { name: "In Progress" },
          team: { name: "Ops" },
          labels: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          handoffCount: 0,
          commentCount: 0,
        },
      ],
      rosterImport: {
        imported: 1,
        linked: 1,
        staged: 0,
        updatedAt: Date.now(),
      },
      taskSync: {
        state: "ok" as const,
        updatedAt: Date.now(),
        message: "Synced",
      },
      syncedAt: Date.now(),
    },
    selectedAgentId: "pickle",
    setSelectedAgentId: vi.fn(),
    selectedTaskId: "task-1",
    setSelectedTaskId: vi.fn(),
    selectedTaskDetail: null,
    activityLog: [],
    agentMessages: [],
    agentMessagesLoading: false,
    connectionState: "connected" as const,
    busyKey: null,
    error: null,
    loading: false,
    refreshMission: vi.fn(),
    createAgent: vi.fn(),
    editAgent: vi.fn(),
    removeAgent: vi.fn(),
    saveTaskUpdate: vi.fn(),
    addComment: vi.fn(),
    runTask: vi.fn(),
    saveConnector: vi.fn(),
    saveHermesSharedDefaults: vi.fn(),
    syncConnector: vi.fn(),
    testConnectorHealth: vi.fn(),
    addConnector: vi.fn(),
    removeConnector: vi.fn(),
    bootstrapTeam: vi.fn(),
    sendMessageToAgent: vi.fn(),
    refreshAgentMessages: vi.fn(),
  };
}

let mockMissionControlState = createMissionControlState();

vi.mock("./mission/hooks/useMissionControl", () => ({
  useMissionControl: () => mockMissionControlState,
}));

describe("App", () => {
  beforeEach(() => {
    mockMissionControlState = createMissionControlState();
  });

  it("renders the missions dashboard by default", () => {
    render(<App />);

    expect(screen.getByText("MissionOS")).toBeInTheDocument();
    expect(screen.getByText("Active Missions")).toBeInTheDocument();
  });

  it("renders sidebar with all navigation items", () => {
    render(<App />);

    expect(screen.getByText("Missions")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Org Chart")).toBeInTheDocument();
    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("Onboarding")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("navigates to agents via sidebar", () => {
    render(<App />);

    fireEvent.click(screen.getByText("Agents"));

    expect(mockMissionControlState.setActiveView).toHaveBeenCalledWith("agents");
  });

  it("renders settings page", () => {
    mockMissionControlState = createMissionControlState("settings");

    render(<App />);

    expect(screen.getByText("Linear Integration")).toBeInTheDocument();
    expect(screen.getAllByText("Danger Zone").length).toBeGreaterThan(0);
  });

  it("renders agent roster page", () => {
    mockMissionControlState = createMissionControlState("agents");

    render(<App />);

    expect(screen.getByText("Agent Roster")).toBeInTheDocument();
  });

  it("renders onboarding page", () => {
    mockMissionControlState = createMissionControlState("onboarding");

    render(<App />);

    expect(screen.getByText("Agent Identification")).toBeInTheDocument();
  });
});
