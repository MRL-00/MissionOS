import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { ProjectSetupPage } from "./ProjectSetupPage";

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    busyKey: null,
    error: null,
    saveProject: vi.fn(async () => true),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("ProjectSetupPage", () => {
  it("submits the visible default project name", async () => {
    const saveProject = vi.fn(async () => true);
    render(<ProjectSetupPage mission={makeMissionControl({ saveProject })} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue to onboarding" }));

    await waitFor(() => {
      expect(saveProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "MissionOS HQ",
        }),
      );
    });
  });

  it("submits browser-filled project fields even when React state has not changed", async () => {
    const saveProject = vi.fn(async () => true);
    render(<ProjectSetupPage mission={makeMissionControl({ saveProject })} />);

    (screen.getByLabelText("Project Name") as HTMLInputElement).value = "Finance Ops";
    (screen.getByLabelText("Description") as HTMLTextAreaElement).value = "Quarter-end automation";
    fireEvent.click(screen.getByRole("button", { name: "Continue to onboarding" }));

    await waitFor(() => {
      expect(saveProject).toHaveBeenCalledWith({
        name: "Finance Ops",
        description: "Quarter-end automation",
      });
    });
  });
});
