import { render, screen } from "@testing-library/react";
import { App } from "./app";
import type { ProviderConnector } from "./mission/types";

function createMissionControlState(activeView: "mission" | "tasks" | "schedules" | "settings" | "agents" = "mission") {
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
        { key: "websocketUrl", label: "SSH host", type: "text" as const, placeholder: "matt@192.168.1.113" },
        { key: "runtimeBaseUrl", label: "Runtime bridge URL", type: "url" as const },
        { key: "token", label: "API token", type: "password" as const },
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
      providerAgents: [],
      schedules: [
        {
          connectorId: "hermes",
          id: "hermes:nightly",
          provider: "hermes" as const,
          name: "Nightly sync",
          recurrence: "Every weekday at 9am",
          nextRunAt: Date.now(),
          status: "scheduled" as const,
        },
      ],
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
    selectedTaskDetail: {
      task: {
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
      comments: [],
      handoffs: [],
    },
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
    createHandoff: vi.fn(),
    respondToHandoff: vi.fn(),
    saveConnector: vi.fn(),
    syncConnector: vi.fn(),
    testConnectorHealth: vi.fn(),
    addConnector: vi.fn(),
    removeConnector: vi.fn(),
    sendMessageToAgent: vi.fn(),
    refreshAgentMessages: vi.fn(),
  };
}

let mockMissionControlState = createMissionControlState();

vi.mock("./mission/orgchart/OrgChart", () => ({
  OrgChart: () => <div data-testid="org-chart">org-chart</div>,
}));

vi.mock("./mission/hooks/useMissionControl", () => ({
  useMissionControl: () => mockMissionControlState,
}));

describe("App", () => {
  beforeEach(() => {
    mockMissionControlState = createMissionControlState();
  });

  it("renders mission control shell", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Mission Control" })).toBeInTheDocument();
    expect(await screen.findByTestId("org-chart")).toBeInTheDocument();
    expect(screen.queryByText("Office roster")).not.toBeInTheDocument();
    expect(screen.getByText("1 cycle tasks")).toBeInTheDocument();
    expect(screen.getByText("1 office agents")).toBeInTheDocument();
  });

  it("renders settings view with connector config", () => {
    mockMissionControlState = createMissionControlState("settings");

    render(<App />);

    expect(screen.getAllByText("Hermes").length).toBeGreaterThanOrEqual(1);
  });

  it("renders agents view with agent list and form", () => {
    mockMissionControlState = createMissionControlState("agents");

    render(<App />);

    expect(screen.getByText("Office agents")).toBeInTheDocument();
    expect(screen.getAllByText("Pickle").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
    expect(screen.getByText("Register a new office agent")).toBeInTheDocument();
  });
});
