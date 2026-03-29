import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "./app";
import type { ProviderConnector } from "./mission/types";

function createMissionControlState(activeView: "mission" | "settings" = "mission") {
  const connectors: ProviderConnector[] = [
    {
      provider: "openclaw",
      label: "OpenClaw",
      enabled: true,
      baseUrl: "http://openclaw.local",
      websocketUrl: "ws://openclaw.local",
      runtimeBaseUrl: "http://openclaw.local",
      syncIntervalMs: 5000,
      authMode: "bearer",
      tokenConfigured: true,
      capabilities: {
        agents: true,
        schedules: true,
        activeWork: true,
        launch: true,
        subscribe: true,
      },
      health: {
        provider: "openclaw",
        status: "ok",
        checkedAt: Date.now(),
        activeAgents: 1,
        schedules: 2,
        message: "Healthy",
      },
      lastSyncAt: Date.now(),
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
      providerAgents: [],
      schedules: [
        {
          id: "openclaw:nightly",
          provider: "openclaw" as const,
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
    connectionState: "connected" as const,
    busyKey: null,
    error: null,
    loading: false,
    refreshMission: vi.fn(),
    saveTaskUpdate: vi.fn(),
    addComment: vi.fn(),
    createHandoff: vi.fn(),
    respondToHandoff: vi.fn(),
    saveConnector: vi.fn(),
    syncConnector: vi.fn(),
    testConnectorHealth: vi.fn(),
  };
}

let mockMissionControlState = createMissionControlState();

vi.mock("./mission/scene/MissionScene", () => ({
  MissionScene: () => <div data-testid="mission-scene">mission-scene</div>,
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
    expect(screen.getByText("Live Mission Overview")).toBeInTheDocument();
    expect(await screen.findByTestId("mission-scene")).toBeInTheDocument();
    expect(screen.getByText("Build mission control")).toBeInTheDocument();
  });

  it("keeps the connector token draft during live connector refreshes", () => {
    mockMissionControlState = createMissionControlState("settings");

    const { rerender } = render(<App />);
    const tokenInput = screen.getByLabelText("Bearer token") as HTMLInputElement;

    fireEvent.change(tokenInput, { target: { value: "openclaw-secret" } });
    expect(tokenInput).toHaveValue("openclaw-secret");

    mockMissionControlState = {
      ...mockMissionControlState,
      missionSnapshot: {
        ...mockMissionControlState.missionSnapshot,
        connectors: mockMissionControlState.missionSnapshot.connectors.map((connector) => (
          connector.provider === "openclaw"
            ? {
                ...connector,
                health: {
                  ...connector.health,
                  status: "syncing",
                  checkedAt: Date.now(),
                  message: "Syncing OpenClaw...",
                },
                lastSyncAt: Date.now(),
              }
            : connector
        )),
        syncedAt: Date.now(),
      },
    };

    rerender(<App />);

    expect(screen.getByLabelText("Bearer token")).toHaveValue("openclaw-secret");
  });
});
