import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "./app";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/bootstrap")) {
          return {
            ok: true,
            text: async () => JSON.stringify({ hasAccount: false, hasAgents: false, hasProject: false }),
          };
        }

        return {
          ok: true,
          text: async () => JSON.stringify({}),
        };
      }),
    );
  });

  it("renders the landing page when no account exists", async () => {
    render(<App />);
    expect(await screen.findByText("Your AI agents,"));
  });

  it("routes the landing call to action into first-run account setup", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Get started" }));

    expect(await screen.findByRole("button", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByText("Create your local account")).toBeInTheDocument();
  });
});
