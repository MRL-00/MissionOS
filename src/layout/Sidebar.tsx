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
import { MissionLink } from "@/components/MissionLink";
import { cn } from "@/lib/utils";
import type { MissionNavigate, MissionView } from "@/mission/navigation";

type NavItem = {
  id: MissionView;
  label: string;
  icon: typeof LayoutDashboardIcon;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const PRIMARY_SECTIONS: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { id: "missions", label: "Missions", icon: LayoutDashboardIcon },
      { id: "agents", label: "Agents", icon: UsersIcon },
      { id: "orgchart", label: "Org Chart", icon: NetworkIcon },
    ],
  },
  {
    title: "Delivery",
    items: [
      { id: "issues", label: "Issues", icon: KanbanIcon },
      { id: "runs", label: "Runs", icon: ActivityIcon },
      { id: "schedules", label: "Schedules", icon: CalendarClockIcon },
    ],
  },
  {
    title: "Admin",
    items: [{ id: "settings", label: "Settings", icon: SettingsIcon }],
  },
];

const RESOURCE_ITEMS: NavItem[] = [
  { id: "docs", label: "Docs", icon: BookOpenIcon },
  { id: "help", label: "Help", icon: HelpCircleIcon },
  { id: "help", label: "Feedback", icon: MessageSquareIcon },
];

interface SidebarProps {
  activeView: MissionView;
  onNavigate: MissionNavigate;
  showOnboarding: boolean;
  projectLogo?: string | undefined;
}

export function Sidebar({ activeView, onNavigate, showOnboarding, projectLogo }: SidebarProps) {
  const sections: NavSection[] = showOnboarding
    ? PRIMARY_SECTIONS.map<NavSection>((section) =>
        section.title === "Delivery"
          ? {
              ...section,
              items: [...section.items, { id: "onboarding", label: "Onboarding", icon: WandSparklesIcon }],
            }
          : section,
      )
    : PRIMARY_SECTIONS;

  function renderNavButton(item: NavItem) {
    const Icon = item.icon;
    const isActive = activeView === item.id;

    return (
      <MissionLink
        key={`${item.id}-${item.label}`}
        view={item.id}
        navigate={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
          isActive
            ? "bg-white/[0.08] text-white"
            : "text-[#918f90] hover:bg-white/[0.04] hover:text-[#c8c4d7]",
        )}
      >
        <Icon className="size-4 shrink-0" />
        {item.label}
      </MissionLink>
    );
  }

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

      <nav className="mt-1 flex flex-1 flex-col gap-4 px-3">
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6f6b74]">
              {section.title}
            </p>
            <div className="flex flex-col gap-0.5">{section.items.map(renderNavButton)}</div>
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-white/[0.06] bg-black px-3 pt-3 pb-4">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6f6b74]">Resources</p>
        <div className="flex flex-col gap-0.5">{RESOURCE_ITEMS.map(renderNavButton)}</div>
      </div>
    </aside>
  );
}
