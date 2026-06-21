import { getMissionHref, isMissionView, MAIN_VIEWS, PATH_VIEWS, PRE_AUTH_VIEWS, VIEW_PATHS } from "./navigation";

describe("mission navigation", () => {
  it("keeps every view path reversible", () => {
    for (const [view, path] of Object.entries(VIEW_PATHS)) {
      expect(PATH_VIEWS.get(path)).toBe(view);
      expect(isMissionView(view)).toBe(true);
    }
  });

  it("separates public pre-auth views from authenticated main views", () => {
    expect(PRE_AUTH_VIEWS).toEqual(["landing", "setup", "login"]);
    expect(MAIN_VIEWS).toEqual([
      "missions",
      "agents",
      "orgchart",
      "issues",
      "runs",
      "schedules",
      "settings",
      "docs",
      "help",
      "search",
    ]);
  });

  it("builds mission hrefs with optional search strings", () => {
    expect(getMissionHref("issues")).toBe("/issues");
    expect(getMissionHref("search", "q=release")).toBe("/search?q=release");
  });

  it("rejects unknown view ids", () => {
    expect(isMissionView("missions")).toBe(true);
    expect(isMissionView("unknown")).toBe(false);
  });
});
