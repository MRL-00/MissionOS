import { SearchIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";

interface TopNavProps {
  connectionState: "connecting" | "connected" | "offline";
  mission: MissionControlState;
}

export function TopNav({ connectionState, mission }: TopNavProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/[0.06] bg-[#131314]/80 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <form
          className="flex h-8 w-64 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3"
          onSubmit={(event) => {
            event.preventDefault();
            void mission.performSearch(mission.searchQuery);
          }}
        >
          <SearchIcon className="size-3.5 text-[#918f90]" />
          <input
            value={mission.searchQuery}
            onChange={(event) => mission.setSearchQuery(event.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-[#918f90]"
          />
          <kbd className="ml-auto rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#918f90]">
            ⌘K
          </kbd>
        </form>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block size-2 rounded-full ${
              connectionState === "connected"
                ? "bg-emerald-400"
                : connectionState === "connecting"
                  ? "bg-amber-400"
                  : "bg-red-400"
            }`}
          />
          <span className="text-[12px] text-[#918f90] capitalize">{connectionState}</span>
        </div>
        <button
          onClick={() => mission.setActiveView("settings")}
          className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#39147e] to-[#2e1065] text-[14px] font-semibold text-white"
        >
          {mission.user?.avatarEmoji ?? "•"}
        </button>
      </div>
    </header>
  );
}
