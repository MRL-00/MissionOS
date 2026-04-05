import { useCallback, useEffect, useMemo, useState } from "react";
import { MaximizeIcon, MinusIcon, PlusIcon, TrashIcon, XIcon, ZapIcon, PencilIcon } from "lucide-react";
import ReactFlow, { Background, Handle, MarkerType, MiniMap, Position, ReactFlowProvider, applyNodeChanges, useReactFlow, type Connection, type Edge, type Node, type NodeChange, type NodeProps } from "reactflow";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { AgentWizard } from "@/pages/onboarding/AgentWizard";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/dateFormat";

interface OrgChartPageProps {
  mission: MissionControlState;
}

interface ActiveRunSummary {
  mission_title: string | null | undefined;
  issue_title: string | null | undefined;
}

const STATUS_COLORS: Record<string, string> = {
  Running: "bg-emerald-400",
  Active: "bg-blue-400",
  Idle: "bg-yellow-400",
  Offline: "bg-red-400",
};

const STATUS_RING: Record<string, string> = {
  Running: "ring-emerald-400/30",
  Active: "ring-blue-400/20",
  Idle: "",
  Offline: "",
};

const ENGINE_COLORS: Record<string, string> = {
  OpenClaw: "text-[#c6bfff]",
  Claude: "text-amber-300",
  Codex: "text-cyan-300",
  Hermes: "text-emerald-300",
  Cursor: "text-blue-300",
  Pi: "text-pink-300",
};

const ENGINE_BORDER: Record<string, string> = {
  OpenClaw: "border-t-[#5e4ae3]",
  Claude: "border-t-amber-500",
  Codex: "border-t-cyan-500",
  Hermes: "border-t-emerald-500",
  Cursor: "border-t-blue-500",
  Pi: "border-t-pink-500",
};

function FlowNode({ data, selected }: NodeProps<{
  agent: MissionControlState["derivedAgents"][number];
  activeRun: ActiveRunSummary | null;
}>) {
  const agent = data.agent;
  const isRunning = agent.statusLabel === "Running";
  const isActive = agent.statusLabel === "Active";

  return (
    <div
      className={cn(
        "w-[240px] rounded-xl border-t-2 border bg-[#1e1e20] p-4 text-left transition-all",
        ENGINE_BORDER[agent.engineLabel] ?? "border-t-[#5e4ae3]",
        selected
          ? "border-[#5e4ae3]/60 bg-[#39147e]/[0.08] shadow-[0_0_20px_rgba(94,74,227,0.2)]"
          : "border-white/[0.08]",
        isRunning && "org-node-running",
        isActive && !selected && "org-node-active",
      )}
    >
      <Handle type="target" position={Position.Top} className="!size-2 !border-0 !bg-white/30" />
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="relative">
          <div
            className="flex size-9 items-center justify-center rounded-xl text-[13px] font-bold text-white"
            style={{ background: `linear-gradient(135deg, ${agent.color}90, ${agent.color})` }}
          >
            {agent.avatarText}
          </div>
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[#1e1e20]",
              STATUS_COLORS[agent.statusLabel] ?? STATUS_COLORS.Idle,
              isRunning && "animate-pulse",
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-white">{agent.name}</div>
          <div className="truncate text-[11px] text-[#918f90]">{agent.role || "Unassigned"}</div>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className={cn("text-[10px] font-medium", ENGINE_COLORS[agent.engineLabel] ?? ENGINE_COLORS.OpenClaw)}>
          {agent.engineLabel}
        </span>
        <div className="flex items-center gap-1.5">
          {agent.skills.length > 0 ? (
            <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-[#918f90]">
              {agent.skills.length} skill{agent.skills.length > 1 ? "s" : ""}
            </span>
          ) : null}
          {isRunning ? (
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
              <ZapIcon className="size-2.5" />
              Running
            </span>
          ) : null}
        </div>
      </div>
      {data.activeRun ? (
        <div className="mt-2 truncate rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-[#918f90]">
          {data.activeRun.mission_title || data.activeRun.issue_title || "Active run"}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!size-2 !border-0 !bg-white/30" />
    </div>
  );
}

const nodeTypes = { agent: FlowNode };

function OrgChartFlow({ mission }: OrgChartPageProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const { fitView, zoomIn, zoomOut } = useReactFlow();


  // Find active runs per agent
  const activeRunsByAgent = useMemo(() => {
    const map = new Map<string, ActiveRunSummary>();
    for (const run of mission.runs) {
      if (run.status === "running" && run.agent_id) {
        map.set(run.agent_id, { mission_title: run.mission_title, issue_title: run.issue_title });
      }
    }
    return map;
  }, [mission.runs]);

  const externalNodes: Node[] = useMemo(
    () =>
      mission.derivedAgents.map((agent) => ({
        id: agent.id,
        type: "agent",
        position: agent.position,
        data: { agent, activeRun: activeRunsByAgent.get(agent.id) ?? null },
      })),
    [mission.derivedAgents, activeRunsByAgent],
  );

  const [nodes, setNodes] = useState<Node[]>(externalNodes);

  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      return externalNodes.map((node) => {
        const existing = currentById.get(node.id);
        if (!existing) {
          return node;
        }
        return {
          ...node,
          position: existing.position,
          ...(existing.selected !== undefined ? { selected: existing.selected } : {}),
          ...(existing.dragging !== undefined ? { dragging: existing.dragging } : {}),
        };
      });
    });
  }, [externalNodes]);

  const edges: Edge[] = useMemo(
    () =>
      mission.relationships.map((relationship) => {
        const latestMessage = mission.agentMessages.find(
          (message) => message.from_agent_id === relationship.parent_id && message.to_agent_id === relationship.child_id,
        );
        const isHot = latestMessage ? Date.now() - new Date(latestMessage.created_at).getTime() < 5000 : false;
        return {
          id: relationship.id,
          source: relationship.parent_id,
          target: relationship.child_id,
          animated: isHot,
          markerEnd: { type: MarkerType.ArrowClosed, color: isHot ? "#5e4ae3" : "rgba(255,255,255,0.25)", width: 16, height: 16 },
          style: {
            stroke: isHot ? "#5e4ae3" : "rgba(255,255,255,0.12)",
            strokeWidth: isHot ? 2.5 : 1.5,
            ...(isHot ? { filter: "drop-shadow(0 0 4px rgba(94,74,227,0.4))" } : {}),
          },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          ...(isHot && latestMessage
            ? {
                label: latestMessage.message.slice(0, 30),
                labelStyle: { fill: "#c6bfff", fontSize: 10, fontWeight: 500 },
                labelBgStyle: { fill: "#1e1e20", fillOpacity: 0.9 },
              }
            : {}),
        };
      }),
    [mission.agentMessages, mission.relationships],
  );

  const selectedNode = mission.derivedAgents.find((agent) => agent.id === selectedNodeId) ?? null;

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  // Find missions this agent is assigned to
  const agentMissions = useMemo(() => {
    if (!selectedNode) return [];
    return mission.missions.filter((m) => m.assigned_agents.some((a) => a.id === selectedNode.id));
  }, [selectedNode, mission.missions]);

  const handleConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      await mission.addRelationship(connection.source, connection.target);
    },
    [mission],
  );

  return (
    <div className="flex h-full">
      <div className={cn("relative flex-1", isDragging && "orgchart-dragging-active")}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          panOnScroll
          selectionOnDrag
          onNodesChange={handleNodesChange}
          onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          onEdgeDoubleClick={(_event, edge) => {
            void mission.removeRelationship(edge.id);
          }}
          onConnect={(connection) => {
            void handleConnect(connection);
          }}
          onNodeDragStart={() => {
            setIsDragging(true);
          }}
          onNodeDragStop={(_event, node) => {
            setIsDragging(false);
            const positions = nodes.map((entry) => ({
              agent_id: entry.id,
              x: entry.id === node.id ? node.position.x : entry.position.x,
              y: entry.id === node.id ? node.position.y : entry.position.y,
            }));
            void mission.persistPositions(positions);
          }}
          proOptions={{ hideAttribution: true }}
          style={{ background: "#161618" }}
        >
          <Background color="rgba(255,255,255,0.06)" gap={24} />
          <MiniMap
            nodeColor={(node) => (node.data as { agent: { color: string } }).agent.color}
            maskColor="rgba(0,0,0,0.7)"
            className="!rounded-lg !border-white/[0.08] !bg-[#1c1b1c]/80"
          />
        </ReactFlow>

        {/* Top-right zoom controls */}
        <div className="absolute right-4 top-4 flex items-center gap-1.5">
          <div className="flex items-center overflow-hidden rounded-lg border border-white/[0.08] bg-[#1e1e20] shadow-lg">
            <button
              onClick={() => zoomIn({ duration: 200 })}
              className="flex size-8 items-center justify-center text-[#918f90] transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Zoom in"
            >
              <PlusIcon className="size-3.5" />
            </button>
            <div className="h-5 w-px bg-white/[0.06]" />
            <button
              onClick={() => zoomOut({ duration: 200 })}
              className="flex size-8 items-center justify-center text-[#918f90] transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Zoom out"
            >
              <MinusIcon className="size-3.5" />
            </button>
            <div className="h-5 w-px bg-white/[0.06]" />
            <button
              onClick={() => fitView({ padding: 0.2, duration: 300 })}
              className="flex size-8 items-center justify-center text-[#918f90] transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Fit view"
            >
              <MaximizeIcon className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Bottom-right add agent */}
        <div className="absolute bottom-6 right-6">
          <button
            onClick={() => mission.setActiveView("agents")}
            className="flex items-center gap-2 rounded-full bg-[#39147e] px-4 py-2.5 text-[12px] font-medium text-white shadow-lg shadow-[#2e1065]/25 transition-transform hover:scale-105"
          >
            <PlusIcon className="size-3.5" />
            Add Agent
          </button>
        </div>
      </div>

      {selectedNode ? (
        <div className="w-[320px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[#585658]">Agent Inspector</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setEditingAgentId(selectedNode.id)}
                className="rounded-lg p-1 text-[#585658] hover:bg-white/[0.06] hover:text-white"
                title="Edit agent"
              >
                <PencilIcon className="size-3.5" />
              </button>
              <button onClick={() => setSelectedNodeId(null)} className="rounded-lg p-1 text-[#585658] hover:bg-white/[0.06] hover:text-white">
                <XIcon className="size-4" />
              </button>
            </div>
          </div>

          <div className="mb-5 flex items-center gap-3">
            <div className="relative">
              <div className="flex size-12 items-center justify-center rounded-xl text-lg font-semibold text-white" style={{ background: `linear-gradient(135deg, ${selectedNode.color}99, ${selectedNode.color})` }}>
                {selectedNode.avatarText}
              </div>
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-[#131314]",
                  STATUS_COLORS[selectedNode.statusLabel] ?? STATUS_COLORS.Idle,
                  selectedNode.statusLabel === "Running" && "animate-pulse",
                )}
              />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-white">{selectedNode.name}</div>
              <div className="text-[12px] text-[#918f90]">{selectedNode.role || "Unassigned role"}</div>
            </div>
          </div>

          <div className="mb-5 flex items-center gap-2">
            <div className={cn("flex items-center gap-1.5 rounded-full px-2 py-1", selectedNode.statusLabel === "Running" ? "bg-emerald-500/15" : "bg-white/[0.04]")}>
              <span className={cn("size-2 rounded-full", STATUS_COLORS[selectedNode.statusLabel] ?? STATUS_COLORS.Idle)} />
              <span className={cn("text-[11px] font-medium", selectedNode.statusLabel === "Running" ? "text-emerald-400" : "text-[#c8c4d7]")}>{selectedNode.statusLabel}</span>
            </div>
            <span className={cn("rounded-full border border-white/[0.06] px-2 py-1 text-[10px] font-medium", ENGINE_COLORS[selectedNode.engineLabel] ?? ENGINE_COLORS.OpenClaw)}>
              {selectedNode.engineLabel}
            </span>
          </div>

          {/* Current Missions */}
          {agentMissions.length > 0 ? (
            <div className="mb-5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Assigned Missions</div>
              <div className="space-y-1.5">
                {agentMissions.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                    <span className={cn("size-2 rounded-full", m.status === "active" ? "bg-[#39147e]" : m.status === "complete" ? "bg-emerald-400" : "bg-white/[0.1]")} />
                    <span className="truncate text-[11px] text-[#c8c4d7]">{m.title}</span>
                    <span className="ml-auto text-[9px] uppercase text-[#585658]">{m.status}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mb-5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Technical Skills</div>
            <div className="flex flex-wrap gap-1.5">
              {selectedNode.skills.length > 0 ? selectedNode.skills.map((skill) => (
                <span key={skill} className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[10px] text-[#918f90]">{skill}</span>
              )) : <span className="text-[11px] text-[#585658]">No skills configured.</span>}
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Tool Access</div>
            <div className="space-y-1.5">
              {selectedNode.tools.length > 0 ? selectedNode.tools.map((tool) => (
                <div key={tool} className="flex items-center gap-2 text-[11px]">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[#918f90]">{tool}</span>
                </div>
              )) : <div className="text-[11px] text-[#585658]">No tools configured.</div>}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Activity Log</div>
            <div className="space-y-2.5">
              {mission.agentMessages
                .filter((entry) => entry.from_agent_id === selectedNode.id || entry.to_agent_id === selectedNode.id)
                .slice(0, 5)
                .map((entry) => {
                  const isRecent = Date.now() - new Date(entry.created_at).getTime() < 10000;
                  return (
                    <div key={entry.id} className="flex gap-2.5">
                      <div className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", isRecent ? "bg-[#5e4ae3] animate-pulse" : "bg-white/[0.15]")} />
                      <div>
                        <div className="text-[11px] text-[#918f90]">{entry.message}</div>
                        <div className="text-[10px] text-[#585658]">{formatDateTime(entry.created_at, mission.settingsMap.user_timezone)}</div>
                      </div>
                    </div>
                  );
                })}
              {mission.agentMessages.filter((entry) => entry.from_agent_id === selectedNode.id || entry.to_agent_id === selectedNode.id).length === 0 ? (
                <div className="text-[11px] text-[#585658]">No recent activity.</div>
              ) : null}
            </div>
          </div>

        </div>
      ) : null}

      {/* Edit Agent Modal */}
      {editingAgentId ? (() => {
        const agentToEdit = mission.agents.find((a) => a.id === editingAgentId);
        if (!agentToEdit) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
                <h2 className="text-[14px] font-semibold text-white">Edit Agent</h2>
                <button onClick={() => setEditingAgentId(null)} className="rounded-lg p-1 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white">
                  <XIcon className="size-4" />
                </button>
              </div>
              <AgentWizard
                mission={mission}
                onComplete={() => setEditingAgentId(null)}
                onCancel={() => setEditingAgentId(null)}
                submitLabel="Save Changes"
                initialAgent={agentToEdit}
              />
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}

export function OrgChartPage({ mission }: OrgChartPageProps) {
  return (
    <ReactFlowProvider>
      <OrgChartFlow mission={mission} />
    </ReactFlowProvider>
  );
}
