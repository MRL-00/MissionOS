import { fireEvent, render, screen } from "@testing-library/react";
import { MissionScene } from "./MissionScene";

describe("MissionScene", () => {
  it("renders the authored office map and forwards sprite selection", () => {
    const onSelectAgent = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}) as Promise<Response>);

    render(
      <MissionScene
        agents={[
          {
            id: "pickle",
            name: "Pickle",
            role: "Orchestrator",
            emoji: "🥒",
            connected: true,
            status: "working",
            location: "desk",
            timestamp: Date.now(),
            task: "Coordinate the launch board.",
            message: "Working through the backlog.",
          },
          {
            id: "zoe",
            name: "Matt",
            role: "Engineer Lead",
            emoji: "🟣",
            connected: true,
            status: "meeting",
            location: "meeting-room",
            timestamp: Date.now(),
            task: "Review architecture options.",
            message: "In the meeting room.",
          },
        ]}
        selectedAgentId="pickle"
        onSelectAgent={onSelectAgent}
      />,
    );

    expect(screen.getByText("Pixel-authored modern office")).toBeInTheDocument();
    expect(screen.getByText("Collab Room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pickle, working, Bullpen Floor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Matt, in meeting, Collab Room/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Matt, in meeting, Collab Room/i }));
    expect(onSelectAgent).toHaveBeenCalledWith("zoe");

    vi.restoreAllMocks();
  });
});
