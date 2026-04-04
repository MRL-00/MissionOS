import { useState } from "react";
import { PlusIcon, XIcon, MessageSquareIcon, ShareIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";

interface IssuesBoardProps {
  mission: MissionControlState;
}

interface Issue {
  id: string;
  identifier: string;
  title: string;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  labels: string[];
  assignee?: string;
  column: string;
}

const COLUMNS = [
  { id: "backlog", label: "Backlog", count: 12 },
  { id: "todo", label: "Todo", count: 4 },
  { id: "in_progress", label: "In Progress", count: 2 },
  { id: "in_review", label: "In Review", count: 1 },
  { id: "done", label: "Done", count: 82 },
];

const PRIORITY_INDICATORS: Record<string, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-400",
  none: "border-l-transparent",
};

const MOCK_ISSUES: Issue[] = [
  { id: "1", identifier: "MOS-392", title: "Agent heartbeat timeout handling", priority: "high", labels: ["bug", "infra"], assignee: "P", column: "backlog" },
  { id: "2", identifier: "MOS-391", title: "Implement WebSocket reconnection logic", priority: "medium", labels: ["feature"], assignee: "N", column: "backlog" },
  { id: "3", identifier: "MOS-390", title: "Add agent skill discovery endpoint", priority: "low", labels: ["api"], column: "backlog" },
  { id: "4", identifier: "MOS-389", title: "Mission progress calculation fix", priority: "urgent", labels: ["bug"], assignee: "Z", column: "todo" },
  { id: "5", identifier: "MOS-388", title: "Kanban drag-and-drop implementation", priority: "high", labels: ["feature", "ui"], assignee: "N", column: "in_progress" },
  { id: "6", identifier: "MOS-387", title: "Agent onboarding flow redesign", priority: "medium", labels: ["design"], assignee: "P", column: "in_progress" },
  { id: "7", identifier: "MOS-386", title: "Dashboard stat card component", priority: "low", labels: ["ui"], assignee: "Z", column: "in_review" },
  { id: "8", identifier: "MOS-385", title: "Linear API integration", priority: "high", labels: ["feature", "integration"], assignee: "P", column: "done" },
];

export function IssuesBoard({ mission }: IssuesBoardProps) {
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(
    MOCK_ISSUES.find((i) => i.identifier === "MOS-388") ?? null,
  );

  return (
    <div className="flex h-full">
      {/* Board */}
      <div className="flex flex-1 gap-4 overflow-x-auto p-6">
        {COLUMNS.map((col) => {
          const issues = MOCK_ISSUES.filter((i) => i.column === col.id);
          return (
            <div key={col.id} className="flex w-[260px] shrink-0 flex-col">
              {/* Column Header */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-white">{col.label}</span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[#918f90]">{col.count}</span>
                </div>
                <button className="rounded p-0.5 text-[#918f90] hover:text-white">
                  <PlusIcon className="size-3.5" />
                </button>
              </div>

              {/* Cards */}
              <div className="flex flex-1 flex-col gap-2">
                {issues.map((issue) => (
                  <button
                    key={issue.id}
                    onClick={() => setSelectedIssue(issue)}
                    className={cn(
                      "rounded-lg border-l-2 border border-white/[0.06] bg-[#1c1b1c] p-3 text-left transition-all",
                      PRIORITY_INDICATORS[issue.priority],
                      selectedIssue?.id === issue.id && "border-[#5e4ae3]/50 bg-[#5e4ae3]/[0.06] shadow-[0_0_0_1px_rgba(94,74,227,0.3)]",
                    )}
                  >
                    <div className="mb-1.5 text-[11px] font-medium text-[#918f90]">{issue.identifier}</div>
                    <div className="text-[13px] font-medium leading-snug text-white">{issue.title}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex gap-1">
                        {issue.labels.map((l) => (
                          <span key={l} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#918f90]">{l}</span>
                        ))}
                      </div>
                      {issue.assignee && (
                        <div className="flex size-5 items-center justify-center rounded-full bg-gradient-to-br from-[#c6bfff] to-[#5e4ae3] text-[9px] font-semibold text-white">
                          {issue.assignee}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Panel */}
      {selectedIssue && (
        <div className="w-[360px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#918f90]">{selectedIssue.identifier}</span>
            <button onClick={() => setSelectedIssue(null)} className="rounded-lg p-1 text-[#918f90] hover:bg-white/[0.06] hover:text-white">
              <XIcon className="size-4" />
            </button>
          </div>
          <h2 className="mb-4 text-[16px] font-semibold text-white">{selectedIssue.title}</h2>

          {/* Description */}
          <div className="mb-5 text-[13px] leading-relaxed text-[#918f90]">
            <p className="mb-2">This issue tracks the implementation of the feature described in the title.</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Define component structure and props</li>
              <li>Implement core functionality</li>
              <li>Add unit tests</li>
              <li>Update documentation</li>
            </ul>
          </div>

          {/* Properties */}
          <div className="mb-5 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Properties</div>
            <PropertyRow label="Status" value={COLUMNS.find((c) => c.id === selectedIssue.column)?.label ?? selectedIssue.column} />
            <PropertyRow label="Assignee" value={selectedIssue.assignee ? `Agent ${selectedIssue.assignee}` : "Unassigned"} />
            <PropertyRow label="Priority" value={selectedIssue.priority} />
            <PropertyRow label="Labels" value={selectedIssue.labels.join(", ")} />
          </div>

          {/* Metadata */}
          <div className="mb-5 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Metadata</div>
            <div className="text-[12px] text-[#918f90]">Created: 2 days ago</div>
            <div className="text-[12px] text-[#918f90]">Updated: 5 min ago</div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#c6bfff] to-[#5e4ae3] py-2.5 text-[13px] font-medium text-white">
              <MessageSquareIcon className="size-3.5" />
              Post Comment
            </button>
            <button className="flex items-center justify-center rounded-lg border border-white/[0.08] p-2.5 text-[#918f90] transition-colors hover:bg-white/[0.04]">
              <ShareIcon className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* FAB */}
      <button className="fixed bottom-6 right-6 z-20 flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-[#c6bfff] to-[#5e4ae3] shadow-lg shadow-[#5e4ae3]/25 transition-transform hover:scale-105">
        <PlusIcon className="size-5 text-white" />
      </button>
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-[#918f90]">{label}</span>
      <span className="text-[12px] capitalize text-[#c8c4d7]">{value}</span>
    </div>
  );
}
