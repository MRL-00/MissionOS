import { render, screen, within } from "@testing-library/react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { SearchPage } from "./SearchPage";

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    searchQuery: "deploy",
    searchResults: {
      agents: [{ id: "agent-1", name: "Release Agent", role: "Build operator" }],
      missions: [{ id: "mission-1", title: "Go-live", description: "Production readiness" }],
      issues: [],
      runs: [{ id: "run-1", prompt: "Deploy checklist", output: "All gates passed" }],
    },
    ...overrides,
  } as unknown as MissionControlState;
}

describe("SearchPage", () => {
  it("renders grouped results and empty groups", () => {
    render(<SearchPage mission={makeMissionControl()} />);

    expect(screen.getByText("Results for “deploy”")).toBeInTheDocument();
    expect(screen.getByText("Release Agent")).toBeInTheDocument();
    expect(screen.getByText("Go-live")).toBeInTheDocument();
    expect(screen.getByText("Deploy checklist")).toBeInTheDocument();

    const issues = screen.getByText("Issues").parentElement;
    expect(issues).not.toBeNull();
    expect(within(issues!).getByText("No matches.")).toBeInTheDocument();
  });

  it("shows a placeholder when there is no query", () => {
    render(<SearchPage mission={makeMissionControl({ searchQuery: "" })} />);

    expect(screen.getByText("Results for “…”")).toBeInTheDocument();
  });
});
