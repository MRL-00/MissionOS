import { useState } from "react";
import { PlusIcon, DownloadIcon, XIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";

interface OrgChartPageProps {
  mission: MissionControlState;
}

interface OrgNode {
  id: string;
  name: string;
  role: string;
  engine: string;
  status: "ACTIVE" | "IDLE" | "STDBY" | "OFFLINE";
  children?: OrgNode[];
}

const ORG_TREE: OrgNode = {
  id: "cmd",
  name: "Commander Prime",
  role: "Command",
  engine: "OPENCLAW",
  status: "ACTIVE",
  children: [
    {
      id: "alpha",
      name: "Alpha Unit",
      role: "Operations",
      engine: "OPENCLAW",
      status: "ACTIVE",
      children: [
        { id: "scout", name: "Scout-01", role: "Recon", engine: "HERMES", status: "IDLE" },
        { id: "parser", name: "Parser-X", role: "Analysis", engine: "CODEX", status: "ACTIVE" },
      ],
    },
    {
      id: "research",
      name: "Research Node",
      role: "Intelligence",
      engine: "CLAUDE",
      status: "ACTIVE",
      children: [
        { id: "lab", name: "Lab-Assistant", role: "Testing", engine: "CODEX", status: "STDBY" },
      ],
    },
    {
      id: "sentinel",
      name: "Sentinel Cluster",
      role: "Utility",
      engine: "HERMES",
      status: "ACTIVE",
      children: [
        { id: "guardian", name: "Guardian-7", role: "Security", engine: "OPENCLAW", status: "ACTIVE" },
      ],
    },
  ],
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-emerald-400",
  IDLE: "bg-yellow-400",
  STDBY: "bg-blue-400",
  OFFLINE: "bg-red-400",
};

const ENGINE_COLORS: Record<string, string> = {
  OPENCLAW: "text-[#c6bfff]",
  CLAUDE: "text-amber-300",
  CODEX: "text-cyan-300",
  HERMES: "text-emerald-300",
};

export function OrgChartPage({ mission }: OrgChartPageProps) {
  const [selectedNode, setSelectedNode] = useState<OrgNode | null>(null);

  return (
    <div className="flex h-full">
      {/* Chart Area */}
      <div className="relative flex-1 overflow-auto bg-[#0f0f10]">
        {/* Background Grid */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

        <div className="relative flex min-h-full flex-col items-center px-8 py-12">
          {/* Root Node */}
          <OrgNodeCard node={ORG_TREE} selected={selectedNode?.id === ORG_TREE.id} onClick={() => setSelectedNode(ORG_TREE)} />

          {/* Vertical Line */}
          <div className="h-10 w-px bg-white/[0.15]" />

          {/* Level 2 */}
          <div className="flex items-start gap-12">
            {ORG_TREE.children?.map((child, i) => (
              <div key={child.id} className="flex flex-col items-center">
                {/* Horizontal connector */}
                <div className="relative mb-0 h-px w-full">
                  <div className="absolute left-1/2 top-0 h-px w-0 bg-white/[0.15]" />
                </div>
                <OrgNodeCard node={child} selected={selectedNode?.id === child.id} onClick={() => setSelectedNode(child)} />

                {child.children && child.children.length > 0 && (
                  <>
                    <div className="h-8 w-px bg-white/[0.15]" />
                    <div className="flex items-start gap-6">
                      {child.children.map((leaf) => (
                        <div key={leaf.id} className="flex flex-col items-center">
                          <div className="mb-2 h-4 w-px bg-white/[0.15]" />
                          <OrgNodeCard node={leaf} small selected={selectedNode?.id === leaf.id} onClick={() => setSelectedNode(leaf)} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Floating Actions */}
        <div className="absolute bottom-6 right-6 flex items-center gap-2">
          <button className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-[#c6bfff] to-[#5e4ae3] shadow-lg transition-transform hover:scale-105">
            <PlusIcon className="size-4 text-white" />
          </button>
          <button className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-[#1c1b1c] px-4 py-2.5 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.06]">
            <DownloadIcon className="size-3.5" />
            Export Hierarchy
          </button>
        </div>
      </div>

      {/* Inspector Panel */}
      {selectedNode && (
        <div className="w-[340px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold uppercase tracking-wider text-[#918f90]">Agent Inspector</h2>
            <button onClick={() => setSelectedNode(null)} className="rounded-lg p-1 text-[#918f90] hover:bg-white/[0.06] hover:text-white">
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="mb-5 flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-[#c6bfff] to-[#5e4ae3] text-lg font-semibold text-white">
              {selectedNode.name[0]}
            </div>
            <div>
              <div className="text-[15px] font-semibold text-white">{selectedNode.name}</div>
              <div className="text-[12px] text-[#918f90]">{selectedNode.role}</div>
            </div>
          </div>

          {/* Status */}
          <div className="mb-5 flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", STATUS_COLORS[selectedNode.status])} />
            <span className="text-[13px] text-[#c8c4d7]">{selectedNode.status}</span>
            <span className="ml-auto text-[12px] text-[#918f90]">Engine:</span>
            <span className={cn("text-[12px] font-medium", ENGINE_COLORS[selectedNode.engine])}>{selectedNode.engine}</span>
          </div>

          {/* Technical Skills */}
          <div className="mb-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Technical Skills</div>
            <div className="flex flex-wrap gap-1.5">
              {["Coordination", "Planning", "Execution", "Analysis"].map((s) => (
                <span key={s} className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-[#c8c4d7]">{s}</span>
              ))}
            </div>
          </div>

          {/* Tool Access */}
          <div className="mb-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Tool Access</div>
            <div className="space-y-1.5">
              {["Web Search", "Code Execution", "File System", "API Gateway"].map((t) => (
                <div key={t} className="flex items-center gap-2 text-[12px]">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[#c8c4d7]">{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Log */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Activity Log</div>
            <div className="space-y-2.5">
              {[
                { time: "2 min ago", msg: "Completed task analysis" },
                { time: "15 min ago", msg: "Started data collection" },
                { time: "1h ago", msg: "Joined mission briefing" },
              ].map((entry, i) => (
                <div key={i} className="flex gap-2.5">
                  <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/[0.2]" />
                  <div>
                    <div className="text-[12px] text-[#c8c4d7]">{entry.msg}</div>
                    <div className="text-[11px] text-[#918f90]">{entry.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrgNodeCard({ node, small, selected, onClick }: { node: OrgNode; small?: boolean; selected?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border text-left transition-all",
        small ? "w-[180px] p-3" : "w-[220px] p-4",
        selected
          ? "border-[#5e4ae3]/60 bg-[#5e4ae3]/[0.08] shadow-[0_0_20px_rgba(94,74,227,0.15)]"
          : "border-white/[0.08] bg-[#1c1b1c] hover:border-white/[0.15]",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("size-2 rounded-full", STATUS_COLORS[node.status])} />
        <span className={cn("font-semibold text-white", small ? "text-[12px]" : "text-[13px]")}>{node.name}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className={cn("text-[#918f90]", small ? "text-[10px]" : "text-[11px]")}>{node.role}</span>
        <span className={cn("text-[10px] font-medium", ENGINE_COLORS[node.engine])}>{node.engine}</span>
      </div>
    </button>
  );
}
