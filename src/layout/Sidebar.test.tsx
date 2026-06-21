import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("renders primary navigation and marks the active view", () => {
    render(
      <Sidebar
        activeView="missions"
        onNavigate={vi.fn()}
        showOnboarding={false}
        projectLogo="T"
      />,
    );

    expect(screen.getByText("MissionOS")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Missions/u })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Agents/u })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: /Docs/u })).toHaveAttribute("href", "/docs");
    expect(screen.queryByRole("link", { name: /Onboarding/u })).not.toBeInTheDocument();
  });

  it("shows onboarding only when requested and routes clicks through app navigation", () => {
    const onNavigate = vi.fn();

    render(
      <Sidebar
        activeView="agents"
        onNavigate={onNavigate}
        showOnboarding
        projectLogo="T"
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: /Onboarding/u }));
    fireEvent.click(screen.getByRole("link", { name: /Feedback/u }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, "onboarding", undefined);
    expect(onNavigate).toHaveBeenNthCalledWith(2, "help", undefined);
  });

  it("renders data-url project logos as images", () => {
    render(
      <Sidebar
        activeView="settings"
        onNavigate={vi.fn()}
        showOnboarding={false}
        projectLogo="data:image/png;base64,logo"
      />,
    );

    expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute("src", "data:image/png;base64,logo");
  });
});
