import {
  LayoutDashboardIcon,
  UsersIcon,
  NetworkIcon,
  KanbanIcon,
  ActivityIcon,
  CalendarClockIcon,
  WandSparklesIcon,
  SettingsIcon,
  BookOpenIcon,
  HelpCircleIcon,
  MessageSquareIcon,
} from "lucide-react";
import type { MissionView } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";

const NAV_ITEMS: Array<{
  id: MissionView;
  label: string;
  icon: typeof LayoutDashboardIcon;
}> = [
  { id: "missions", label: "Missions", icon: LayoutDashboardIcon },
  { id: "agents", label: "Agents", icon: UsersIcon },
  { id: "orgchart", label: "Org Chart", icon: NetworkIcon },
  { id: "issues", label: "Issues", icon: KanbanIcon },
  { id: "runs", label: "Runs", icon: ActivityIcon },
  { id: "schedules", label: "Schedules", icon: CalendarClockIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

interface SidebarProps {
  activeView: MissionView;
  onNavigate: (view: MissionView) => void;
  showOnboarding: boolean;
  projectLogo?: string | undefined;
}

export function Sidebar({ activeView, onNavigate, showOnboarding, projectLogo }: SidebarProps) {
  const items = showOnboarding
    ? [...NAV_ITEMS.slice(0, 5), { id: "onboarding" as MissionView, label: "Onboarding", icon: WandSparklesIcon }, ...NAV_ITEMS.slice(5)]
    : NAV_ITEMS;

  return (
    <aside className="hidden w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-[#131314] md:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex size-8 items-center justify-center overflow-hidden rounded-lg">
          {projectLogo?.startsWith("data:") ? (
            <img src={projectLogo} alt="Logo" className="size-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-white">{projectLogo || "M"}</span>
          )}
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-white">MissionOS</span>
      </div>

      <nav className="mt-1 flex flex-1 flex-col gap-0.5 px-3">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
                isActive
                  ? "bg-white/[0.08] text-white"
                  : "text-[#918f90] hover:bg-white/[0.04] hover:text-[#c8c4d7]",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-white/[0.06] px-3 pt-3 pb-4">
        <button
          onClick={() => onNavigate("docs")}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
            activeView === "docs" ? "bg-white/[0.08] text-white" : "text-[#918f90] hover:bg-white/[0.04] hover:text-[#c8c4d7]",
          )}
        >
          <BookOpenIcon className="size-4 shrink-0" />
          Docs
        </button>
        <button
          onClick={() => onNavigate("help")}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
            activeView === "help" ? "bg-white/[0.08] text-white" : "text-[#918f90] hover:bg-white/[0.04] hover:text-[#c8c4d7]",
          )}
        >
          <HelpCircleIcon className="size-4 shrink-0" />
          Help
        </button>
        <button
          onClick={() => onNavigate("help")}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-[#c8c4d7]"
        >
          <MessageSquareIcon className="size-4 shrink-0" />
          Feedback
        </button>
      </div>
    </aside>
  );
}
