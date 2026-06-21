import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EngineDefinition } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { AgentOnboarding } from "./AgentOnboarding";
import { AgentWizard } from "./AgentWizard";

const codexEngine: EngineDefinition = {
  id: "codex",
  label: "Codex",
  description: "Local Codex CLI",
  connectionType: "cli",
  fields: [
    { key: "codexPath", label: "Codex Path", type: "text", defaultValue: "codex" },
  ],
};

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    engines: [codexEngine],
    settingsMap: {},
    createAgent: vi.fn(async () => true),
    editAgent: vi.fn(async () => true),
    testEngineConnection: vi.fn(async () => ({ ok: true, message: "Connected", latency_ms: 12 })),
    setActiveView: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  } as unknown as MissionControlState;
}

async function advanceToPersonaStep() {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => {
    expect(screen.getByText("Agent Persona")).toBeInTheDocument();
  });
}

describe("AgentWizard", () => {
  it("creates an agent with selected identity, engine config, skills, and tools", async () => {
    const createAgent = vi.fn(async () => true);
    const onComplete = vi.fn();
    render(
      <AgentWizard
        mission={makeMissionControl({ createAgent })}
        onComplete={onComplete}
        onCancel={vi.fn()}
        submitLabel="Initialize Agent"
      />,
    );

    fireEvent.change(screen.getByLabelText("Agent Name"), { target: { value: "Ops Agent" } });
    fireEvent.change(screen.getByLabelText("Role / Title"), { target: { value: "Operator" } });
    await advanceToPersonaStep();
    fireEvent.click(screen.getByRole("button", { name: "Initialize Agent" }));

    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
        name: "Ops Agent",
        role: "Operator",
        emoji: "O",
        engine: "codex",
        connection_type: "cli",
        connection_config: { codexPath: "codex" },
        tools: ["web-search", "code-exec"],
        external_config: false,
        active: true,
      }));
      const calls = createAgent.mock.calls as unknown as Array<[Record<string, unknown>]>;
      expect(calls).toHaveLength(1);
      expect(calls[0]![0].skills).toEqual(expect.any(Array));
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("shows a validation result and does not submit when connection config JSON is invalid", async () => {
    const createAgent = vi.fn(async () => true);
    render(
      <AgentWizard
        mission={makeMissionControl({ createAgent })}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="Initialize Agent"
      />,
    );

    fireEvent.change(screen.getByLabelText("Agent Name"), { target: { value: "Ops Agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Connection Config (JSON)"), { target: { value: "{not-json" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Initialize Agent" }));

    await waitFor(() => {
      expect(screen.getByText("Connection config must be valid JSON.")).toBeInTheDocument();
    });
    expect(createAgent).not.toHaveBeenCalled();
  });
});

describe("AgentOnboarding", () => {
  it("routes completion to org chart and cancel to logout", async () => {
    const createAgent = vi.fn(async () => true);
    const setActiveView = vi.fn();
    const logout = vi.fn();
    render(<AgentOnboarding mission={makeMissionControl({ createAgent, setActiveView, logout })} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(logout).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Agent Name"), { target: { value: "Ops Agent" } });
    await advanceToPersonaStep();
    fireEvent.click(screen.getByRole("button", { name: "Initialize Agent" }));

    await waitFor(() => {
      expect(setActiveView).toHaveBeenCalledWith("orgchart");
    });
  });
});
