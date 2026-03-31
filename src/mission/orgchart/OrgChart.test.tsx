import { fireEvent, render, screen } from "@testing-library/react";
import { OrgChart } from "./OrgChart";
import type { AgentRuntimeState } from "../../types";
import type { ProviderAgentRecord } from "../types";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function agent(overrides: Partial<AgentRuntimeState> & { id: string; name: string; role: string }): AgentRuntimeState {
  return {
    emoji: "",
    connected: true,
    status: "idle",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("OrgChart", () => {
  it("renders agent cards and fires selection", () => {
    const onSelectAgent = vi.fn();

    render(
      <OrgChart
        agents={[
          agent({ id: "o", name: "Oscar", role: "CIO", status: "working" }),
          agent({ id: "a", name: "Alice", role: "Engineer" }),
        ]}
        selectedAgentId="o"
        onSelectAgent={onSelectAgent}
      />,
    );

    expect(screen.getByText("Oscar")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Alice"));
    expect(onSelectAgent).toHaveBeenCalledWith("a");
  });

  it("renders a single agent as the root", () => {
    render(
      <OrgChart
        agents={[agent({ id: "a", name: "Alice", role: "Engineer" })]}
        selectedAgentId={null}
        onSelectAgent={() => {}}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders multiple top-level agents as peer roots", () => {
    render(
      <OrgChart
        agents={[
          agent({ id: "a", name: "Alice", role: "Engineer" }),
          agent({ id: "b", name: "Bob", role: "Designer" }),
        ]}
        selectedAgentId={null}
        onSelectAgent={() => {}}
      />,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Orchestrator")).not.toBeInTheDocument();
  });

  it("renders empty state gracefully", () => {
    render(
      <OrgChart agents={[]} selectedAgentId={null} onSelectAgent={() => {}} />,
    );

    expect(screen.getByTestId("org-chart")).toBeInTheDocument();
  });

  it("renders linked provider ticket and task stage metadata", () => {
    const providerAgents: ProviderAgentRecord[] = [
      {
        connectorId: "hermes",
        provider: "hermes",
        externalId: "hermes",
        name: "Hermes",
        officeAgentId: "a",
        status: "working",
        activityStatus: "building",
        currentTicket: "EPIC-555",
        taskStage: "implementing backend",
        lastActivityAt: "2026-03-31T14:30:00Z",
        imported: true,
      },
    ];

    render(
      <OrgChart
        agents={[agent({ id: "a", name: "Alice", role: "Engineer" })]}
        providerAgents={providerAgents}
        selectedAgentId={null}
        onSelectAgent={() => {}}
      />,
    );

    expect(screen.getByText("EPIC-555")).toBeInTheDocument();
    expect(screen.getByText("implementing backend")).toBeInTheDocument();
  });
});
