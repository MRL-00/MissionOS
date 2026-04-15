export type MissionView =
  | "landing"
  | "setup"
  | "login"
  | "project-setup"
  | "missions"
  | "agents"
  | "orgchart"
  | "issues"
  | "runs"
  | "schedules"
  | "onboarding"
  | "settings"
  | "docs"
  | "help"
  | "search";

export type MissionNavigate = (view: MissionView, options?: { search?: string }) => void;

export const VIEW_PATHS: Record<MissionView, string> = {
  landing: "/",
  setup: "/setup",
  login: "/login",
  "project-setup": "/setup/project",
  missions: "/missions",
  agents: "/agents",
  orgchart: "/org-chart",
  issues: "/issues",
  runs: "/runs",
  schedules: "/schedules",
  onboarding: "/onboarding",
  settings: "/settings",
  docs: "/docs",
  help: "/help",
  search: "/search",
};

export const PATH_VIEWS = new Map<string, MissionView>(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as MissionView]),
);

export const MAIN_VIEWS: MissionView[] = [
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
];

export const PRE_AUTH_VIEWS: MissionView[] = [
  "landing",
  "setup",
  "login",
];

export function isMissionView(value: string): value is MissionView {
  return value in VIEW_PATHS;
}

export function getMissionHref(view: MissionView, search?: string) {
  return `${VIEW_PATHS[view]}${search ? `?${search}` : ""}`;
}
