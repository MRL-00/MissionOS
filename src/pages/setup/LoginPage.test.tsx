import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { LoginPage } from "./LoginPage";

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    bootstrap: { hasAccount: true, hasAgents: false, hasProject: false },
    busyKey: null,
    error: null,
    login: vi.fn(async () => true),
    setActiveView: vi.fn(),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("LoginPage", () => {
  it("submits browser-filled credentials even when React state has not changed", async () => {
    const login = vi.fn(async () => true);
    render(<LoginPage mission={makeMissionControl({ login })} />);

    (screen.getByLabelText("Username") as HTMLInputElement).value = "operator";
    (screen.getByLabelText("Password") as HTMLInputElement).value = "correct horse battery staple";
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        username: "operator",
        password: "correct horse battery staple",
      });
    });
  });
});
