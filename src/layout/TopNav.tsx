import { SearchIcon } from "lucide-react";

interface TopNavProps {
  connectionState: "connecting" | "connected" | "offline";
}

export function TopNav({ connectionState }: TopNavProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/[0.06] bg-[#131314]/80 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-64 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3">
          <SearchIcon className="size-3.5 text-[#918f90]" />
          <span className="text-[13px] text-[#918f90]">Search...</span>
          <kbd className="ml-auto rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#918f90]">
            ⌘K
          </kbd>
        </div>
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
        <div className="size-8 rounded-full bg-gradient-to-br from-[#c6bfff] to-[#5e4ae3]" />
      </div>
    </header>
  );
}
