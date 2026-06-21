import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { HelpPage } from "./HelpPage";

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    sendFeedback: vi.fn(async () => true),
    setActiveView: vi.fn(),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("HelpPage", () => {
  it("captures feedback and clears the submitted message", async () => {
    const sendFeedback = vi.fn(async () => true);
    render(<HelpPage mission={makeMissionControl({ sendFeedback })} />);

    const message = screen.getByLabelText("Message");
    fireEvent.change(message, { target: { value: "The run log filter is confusing." } });
    fireEvent.click(screen.getByRole("button", { name: "Send Feedback" }));

    await waitFor(() => {
      expect(sendFeedback).toHaveBeenCalledWith({ type: "bug", message: "The run log filter is confusing." });
      expect(screen.getByText("Feedback captured.")).toBeInTheDocument();
    });
    expect(message).toHaveValue("");
  });

  it("uses in-app navigation for documentation shortcuts", () => {
    const setActiveView = vi.fn();
    render(<HelpPage mission={makeMissionControl({ setActiveView })} />);

    fireEvent.click(screen.getByRole("link", { name: "Issues Docs" }));
    fireEvent.click(screen.getByRole("link", { name: "Go-live Checklist" }));

    expect(setActiveView).toHaveBeenCalledWith("docs", { search: "path=issues.md" });
    expect(setActiveView).toHaveBeenCalledWith("docs", { search: "path=go-live-checklist.md" });
  });
});
