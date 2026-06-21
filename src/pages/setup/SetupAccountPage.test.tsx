import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { SetupAccountPage } from "./SetupAccountPage";

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    busyKey: null,
    error: null,
    register: vi.fn(async () => true),
    setActiveView: vi.fn(),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("SetupAccountPage", () => {
  it("submits browser-filled field values even when React state has not changed", async () => {
    const register = vi.fn(async () => true);
    render(<SetupAccountPage mission={makeMissionControl({ register })} />);

    (screen.getByLabelText("Username") as HTMLInputElement).value = "operator";
    (screen.getByLabelText("Display Name") as HTMLInputElement).value = "Mission Control";
    (screen.getByLabelText("Password") as HTMLInputElement).value = "correct horse battery staple";
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith({
        username: "operator",
        displayName: "Mission Control",
        password: "correct horse battery staple",
      });
    });
  });
});
