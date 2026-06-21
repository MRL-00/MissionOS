import { fireEvent, render, screen } from "@testing-library/react";
import { MissionLink } from "./MissionLink";

describe("MissionLink", () => {
  it("renders a normal href and intercepts plain left clicks for app navigation", () => {
    const navigate = vi.fn();

    render(
      <MissionLink view="search" search="q=agent" navigate={navigate}>
        Search agents
      </MissionLink>,
    );

    const link = screen.getByRole("link", { name: "Search agents" });
    expect(link).toHaveAttribute("href", "/search?q=agent");

    fireEvent.click(link);

    expect(navigate).toHaveBeenCalledWith("search", { search: "q=agent" });
  });

  it("does not intercept prevented or new-tab clicks", () => {
    const navigate = vi.fn();

    const { rerender } = render(
      <MissionLink view="docs" navigate={navigate} onClick={(event) => event.preventDefault()}>
        Docs
      </MissionLink>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Docs" }));

    rerender(
      <MissionLink view="docs" navigate={navigate} target="_blank">
        Docs
      </MissionLink>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Docs" }));

    expect(navigate).not.toHaveBeenCalled();
  });
});
