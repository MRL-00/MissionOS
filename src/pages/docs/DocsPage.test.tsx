import { fireEvent, render, screen } from "@testing-library/react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { DocsPage } from "./DocsPage";

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    docs: [
      { path: "getting-started.md", title: "Getting Started" },
      { path: "guides/agents.md", title: "Agents" },
    ],
    docPath: "getting-started.md",
    docContent: "# Getting Started\n\nUse `MissionOS` to coordinate agents.",
    openDoc: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("DocsPage", () => {
  it("renders grouped docs and opens selected documents", () => {
    const openDoc = vi.fn(async () => undefined);
    render(<DocsPage mission={makeMissionControl({ openDoc })} />);

    expect(screen.getByRole("heading", { name: "Getting Started" })).toBeInTheDocument();
    expect(screen.getByText("guides")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    expect(openDoc).toHaveBeenCalledWith("guides/agents.md");
  });

  it("shows an empty state until a document is selected", () => {
    render(<DocsPage mission={makeMissionControl({ docContent: "" })} />);

    expect(screen.getByText("Select a document")).toBeInTheDocument();
    expect(screen.getByText("Choose a document from the sidebar to view it.")).toBeInTheDocument();
  });
});
