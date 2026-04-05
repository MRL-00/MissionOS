import { render, screen } from "@testing-library/react";
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

  it("renders first run account setup when no account exists", async () => {
    render(<App />);
    expect(await screen.findByText("Create your local account")).toBeInTheDocument();
  });
});
