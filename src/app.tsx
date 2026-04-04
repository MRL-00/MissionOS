import { startTransition } from "react";
import {
  ActivityIcon,
  BriefcaseBusinessIcon,
  CableIcon,
  ChevronRightIcon,
  RefreshCcwIcon,
  SearchIcon,
  Settings2Icon,
  Users2Icon,
} from "lucide-react";
import { useMissionControl, type MissionView } from "./mission/hooks/useMissionControl";
import { OrgView, RunsView, SettingsView, SetupView, WorkView } from "./app/views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatRelativeUpdate } from "./app/shared";

const NAV_ITEMS: Array<{ id: MissionView; label: string; hint: string; icon: typeof CableIcon }> = [
  { id: "setup", label: "Setup", hint: "Connect runtimes", icon: CableIcon },
  { id: "org", label: "Org", hint: "Map reporting lines", icon: Users2Icon },
  { id: "work", label: "Work", hint: "Run Linear tasks", icon: BriefcaseBusinessIcon },
  { id: "runs", label: "Runs", hint: "Watch execution", icon: ActivityIcon },
  { id: "settings", label: "Settings", hint: "Advanced controls", icon: Settings2Icon },
];

const NAV_GROUPS: Array<{ label: string; items: MissionView[] }> = [
  { label: "Onboarding", items: ["setup", "org"] },
  { label: "Delivery", items: ["work", "runs"] },
  { label: "System", items: ["settings"] },
];

const VIEW_META: Record<MissionView, { title: string; subtitle: string; section: string }> = {
  setup: {
    title: "Connect the office",
    subtitle: "Start by getting Hermes or another runtime online, then open Org to save who reports to who.",
    section: "Onboarding",
  },
  org: {
    title: "Build the org",
    subtitle: "Choose who appears in the org and how everyone connects to who.",
    section: "Onboarding",
  },
  work: {
    title: "Run the first task",
    subtitle: "Pick a synced Linear task, review the brief, and submit it to the org.",
    section: "Delivery",
  },
  runs: {
    title: "Watch runs and heartbeats",
    subtitle: "See what is running, what recently finished, and what is scheduled to wake up next.",
    section: "Delivery",
  },
  settings: {
    title: "Advanced settings",
    subtitle: "Keep low-level controls here so non-technical users do not need to live in this screen.",
    section: "Operations",
  },
};

function onboardingLabel(activeView: MissionView): string {
  switch (activeView) {
    case "setup":
      return "Step 1";
    case "org":
      return "Step 2";
    case "work":
      return "Step 3";
    case "runs":
      return "Step 4";
    case "settings":
    default:
      return "Advanced";
  }
}

function connectionClass(state: "connecting" | "connected" | "offline"): string {
  if (state === "connected") {
    return "border-emerald-500/30 bg-emerald-500/15 text-emerald-200";
  }
  if (state === "connecting") {
    return "border-amber-500/30 bg-amber-500/15 text-amber-200";
  }
  return "border-rose-500/30 bg-rose-500/15 text-rose-200";
}

export function App() {
  const mission = useMissionControl();
  const meta = VIEW_META[mission.activeView];

  async function handleAddIntegration(provider: string): Promise<void> {
    const defaultLabel = provider === "hermes"
      ? "Hermes"
      : provider === "claude-local"
        ? "Claude Code"
        : provider === "codex-local"
          ? "Codex"
          : provider;
    await mission.addConnector(provider, defaultLabel);
  }

  return (
    <div className="dark theme min-h-screen bg-[#050608] text-foreground">
      <TooltipProvider delay={100}>
        <div className="flex min-h-screen bg-[#050608]">
          <aside className="hidden w-[264px] shrink-0 border-r border-white/6 bg-[#07080c] px-4 py-4 md:flex md:flex-col">
            <div className="rounded-2xl border border-white/8 bg-[#0d0f15] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">Mission OS</h1>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/8 bg-[#0d0f15] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Runtimes</div>
                <div className="mt-2 text-2xl font-semibold text-white">{mission.missionSnapshot.providerAgents.length}</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-[#0d0f15] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Tasks</div>
                <div className="mt-2 text-2xl font-semibold text-white">{mission.missionSnapshot.tasks.length}</div>
              </div>
            </div>

            <div className="mt-6 flex-1 space-y-6 overflow-y-auto pr-1">
              {NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                    {group.label}
                  </div>
                  <div className="space-y-1.5">
                    {group.items.map((id) => {
                      const item = NAV_ITEMS.find((entry) => entry.id === id);
                      if (!item) return null;
                      const Icon = item.icon;
                      const isActive = mission.activeView === item.id;
                      return (
                        <button
                          key={item.id}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition",
                            isActive
                              ? "bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.08)]"
                              : "text-white/72 hover:bg-white/5 hover:text-white",
                          )}
                          onClick={() => {
                            startTransition(() => {
                              mission.setActiveView(item.id);
                            });
                          }}
                        >
                          <Icon className={cn("mt-0.5 size-4 shrink-0", isActive ? "text-black" : "text-white/45")} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{item.label}</div>
                            <div className={cn("mt-0.5 text-xs", isActive ? "text-black/65" : "text-white/40")}>
                              {item.hint}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="sticky top-0 z-10 border-b border-white/6 bg-[rgba(5,6,8,0.9)] backdrop-blur-xl">
              <div className="px-6 py-5 lg:px-8">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <Breadcrumb>
                      <BreadcrumbList>
                        <BreadcrumbItem>
                          <span className="text-white/35">{meta.section}</span>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator>
                          <ChevronRightIcon className="size-3.5 text-white/35" />
                        </BreadcrumbSeparator>
                        <BreadcrumbItem>
                          <BreadcrumbPage>{meta.title}</BreadcrumbPage>
                        </BreadcrumbItem>
                      </BreadcrumbList>
                    </Breadcrumb>
                    <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-white">{meta.title}</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">{meta.subtitle}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className="border-white/10 bg-white/5 text-white/65">{onboardingLabel(mission.activeView)}</Badge>
                    <Badge className={cn("font-medium", connectionClass(mission.connectionState))}>
                      {mission.connectionState}
                    </Badge>
                    <Badge className="border-white/10 bg-white/5 text-white/65">{mission.missionSnapshot.taskSync.state}</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"
                      onClick={() => void mission.refreshMission()}
                    >
                      <RefreshCcwIcon className="size-4" />
                      Refresh
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-6 lg:px-8">
              {mission.error && mission.connectionState !== "connecting" ? (
                <div className="mb-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {mission.error}
                </div>
              ) : null}

              {mission.activeView === "setup" ? (
                <SetupView
                  mission={mission}
                  onAddIntegration={handleAddIntegration}
                  onOpenOrg={() => mission.setActiveView("org")}
                />
              ) : null}
              {mission.activeView === "org" ? <OrgView mission={mission} /> : null}
              {mission.activeView === "work" ? <WorkView mission={mission} /> : null}
              {mission.activeView === "runs" ? <RunsView mission={mission} /> : null}
              {mission.activeView === "settings" ? <SettingsView mission={mission} /> : null}
            </div>
          </main>
        </div>
      </TooltipProvider>
    </div>
  );
}
