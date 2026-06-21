import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { Settings } from "./Settings";

function makeMissionControl(overrides: Partial<MissionControlState> = {}): MissionControlState {
  return {
    user: {
      id: "user-1",
      username: "operator",
      displayName: "Mission Control",
      avatarEmoji: "MC",
      created_at: "2026-05-06T00:00:00.000Z",
    },
    project: { id: "project-1", name: "Launch", description: null },
    settingsMap: { project_logo: "M", issue_prefix: "OPS" },
    engines: [],
    saveProfile: vi.fn(async () => true),
    updatePassword: vi.fn(async () => true),
    updateSettingsMap: vi.fn(async () => true),
    wipeProject: vi.fn(async () => true),
    testLinearConnection: vi.fn(async () => null),
    testGitHubConnection: vi.fn(async () => null),
    testEngineConnection: vi.fn(async () => null),
    ...overrides,
  } as unknown as MissionControlState;
}

describe("Settings", () => {
  it("saves profile details and project logo together", async () => {
    const saveProfile = vi.fn(async () => true);
    const updateSettingsMap = vi.fn(async () => true);
    render(<Settings mission={makeMissionControl({ saveProfile, updateSettingsMap })} />);

    fireEvent.change(screen.getByDisplayValue("Mission Control"), { target: { value: "Ops Lead" } });
    fireEvent.change(screen.getByDisplayValue("MC"), { target: { value: "OL" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalledWith({ displayName: "Ops Lead", avatarEmoji: "OL" });
      expect(updateSettingsMap).toHaveBeenCalledWith(expect.objectContaining({ project_logo: "M" }));
      expect(screen.getByText("Profile saved.")).toBeInTheDocument();
    });
  });

  it("does not persist profile settings when profile save fails", async () => {
    const saveProfile = vi.fn(async () => false);
    const updateSettingsMap = vi.fn(async () => true);
    render(<Settings mission={makeMissionControl({ saveProfile, updateSettingsMap })} />);

    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => {
      expect(saveProfile).toHaveBeenCalled();
    });
    expect(updateSettingsMap).not.toHaveBeenCalled();
    expect(screen.queryByText("Profile saved.")).not.toBeInTheDocument();
  });

  it("clears password fields after a successful password change", async () => {
    const updatePassword = vi.fn(async () => true);
    render(<Settings mission={makeMissionControl({ updatePassword })} />);

    const passwordInputs = screen.getAllByPlaceholderText("••••••••") as HTMLInputElement[];
    expect(passwordInputs).toHaveLength(2);
    const currentPasswordInput = passwordInputs[0]!;
    const newPasswordInput = passwordInputs[1]!;
    fireEvent.change(currentPasswordInput, { target: { value: "old-password" } });
    fireEvent.change(newPasswordInput, { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));

    await waitFor(() => {
      expect(updatePassword).toHaveBeenCalledWith({ currentPassword: "old-password", newPassword: "new-password" });
      expect(screen.getByText("Password updated.")).toBeInTheDocument();
    });
    expect(currentPasswordInput).toHaveValue("");
    expect(newPasswordInput).toHaveValue("");
  });
});
