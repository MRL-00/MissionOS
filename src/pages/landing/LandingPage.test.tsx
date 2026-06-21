import { fireEvent, render, screen } from "@testing-library/react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { LandingPage } from "./LandingPage";

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    bootstrap: { hasAccount: false, hasAgents: false, hasProject: false },
    setActiveView: vi.fn(),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("LandingPage", () => {
  it("routes new installs to setup", () => {
    const setActiveView = vi.fn();
    render(<LandingPage mission={makeMissionControl({ setActiveView })} />);

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));

    expect(setActiveView).toHaveBeenCalledWith("setup");
    expect(screen.getByAltText("MissionOS dashboard showing missions, agents, and run history")).toBeInTheDocument();
  });

  it("routes existing installs to login", () => {
    const setActiveView = vi.fn();
    render(<LandingPage mission={makeMissionControl({ bootstrap: { hasAccount: true, hasAgents: true, hasProject: true }, setActiveView })} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(setActiveView).toHaveBeenCalledWith("login");
  });
});
