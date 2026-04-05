import type { MissionControlState } from "@/mission/hooks/useMissionControl";

export function SearchPage({ mission }: { mission: MissionControlState }) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5">
        <h1 className="text-[18px] font-semibold text-white">Search</h1>
        <p className="mt-1 text-[13px] text-[#918f90]">Results for “{mission.searchQuery || "…"}”</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ResultGroup title="Agents" items={mission.searchResults.agents.map((item) => ({ id: item.id, label: item.name, body: item.role || "" }))} />
        <ResultGroup title="Missions" items={mission.searchResults.missions.map((item) => ({ id: item.id, label: item.title, body: item.description || "" }))} />
        <ResultGroup title="Issues" items={mission.searchResults.issues.map((item) => ({ id: item.id, label: item.title, body: item.description || "" }))} />
        <ResultGroup title="Runs" items={mission.searchResults.runs.map((item) => ({ id: item.id, label: item.prompt, body: item.output }))} />
      </div>
    </div>
  );
}

function ResultGroup({ title, items }: { title: string; items: Array<{ id: string; label: string; body: string }> }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
      <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[#918f90]">{title}</div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-[12px] text-[#918f90]">No matches.</div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="text-[13px] font-medium text-white">{item.label}</div>
              <div className="mt-1 text-[12px] text-[#918f90]">{item.body}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
