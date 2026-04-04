import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AgentRuntimeState } from "../../types";
import type { ProviderAgentRecord } from "../types";
import { AgentNode } from "./AgentNode";
import { buildHierarchy } from "./buildHierarchy";
import { ConnectionLines } from "./ConnectionLines";
import type { OrgTreeNode } from "./types";
import { useNodePositions } from "./useNodePositions";

interface OrgChartProps {
  agents: AgentRuntimeState[];
  providerAgents?: ProviderAgentRecord[];
  selectedAgentId: string | null;
  thinkingAgentId?: string | null;
  onSelectAgent(agentId: string): void;
}

interface ViewportState {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 0.65;
const MAX_SCALE = 2.6;
const ZOOM_STEP = 1.14;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function projectViewport(
  current: ViewportState,
  originX: number,
  originY: number,
  nextScale: number,
): ViewportState {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  if (scale === current.scale) {
    return current;
  }

  const worldX = (originX - current.x) / current.scale;
  const worldY = (originY - current.y) / current.scale;

  return {
    scale,
    x: originX - worldX * scale,
    y: originY - worldY * scale,
  };
}

function collectLevels(node: OrgTreeNode): OrgTreeNode[][] {
  const levels: OrgTreeNode[][] = [[node]];
  let current = node.children;
  while (current.length > 0) {
    levels.push(current);
    current = current.flatMap((child) => child.children);
  }
  return levels;
}

export function OrgChart({
  agents,
  providerAgents = [],
  selectedAgentId,
  thinkingAgentId,
  onSelectAgent,
}: OrgChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<ViewportState>({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const trees = useMemo(() => buildHierarchy(agents, providerAgents), [agents, providerAgents]);
  const providerAgentsByOfficeAgentId = useMemo(() => {
    const next = new Map<string, ProviderAgentRecord>();
    providerAgents.forEach((agent) => {
      if (agent.officeAgentId && !next.has(agent.officeAgentId)) {
        next.set(agent.officeAgentId, agent);
      }
    });
    return next;
  }, [providerAgents]);
  const { positions, measure } = useNodePositions(containerRef);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    measure();
  }, [agents, measure, viewport.scale, viewport.x, viewport.y]);

  const zoomFromClientPoint = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const originX = clientX - rect.left;
    const originY = clientY - rect.top;

    setViewport((current) => projectViewport(current, originX, originY, nextScale));
  }, []);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();

    const scaleDelta = Math.exp(-event.deltaY * 0.0015);
    zoomFromClientPoint(event.clientX, event.clientY, viewport.scale * scaleDelta);
  }, [viewport.scale, zoomFromClientPoint]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const listener = (event: WheelEvent) => {
      handleWheel(event);
    };

    container.addEventListener("wheel", listener, { passive: false });
    return () => {
      container.removeEventListener("wheel", listener);
    };
  }, [handleWheel]);

  const zoomAroundCenter = useCallback((factor: number) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    zoomFromClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, viewport.scale * factor);
  }, [viewport.scale, zoomFromClientPoint]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLElement && (target.closest("[data-agent-id]") || target.closest("button"))) {
      return;
    }

    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [viewport.x, viewport.y]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const panState = panRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    setViewport((current) => ({
      ...current,
      x: panState.originX + (event.clientX - panState.startX),
      y: panState.originY + (event.clientY - panState.startY),
    }));
  }, []);

  const stopPanning = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) {
      return;
    }

    panRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div
      className={`org-chart${isPanning ? " org-chart--panning" : ""}`}
      ref={containerRef}
      data-testid="org-chart"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopPanning}
      onPointerCancel={stopPanning}
    >
      <div className="org-chart__toolbar">
        <span className="org-chart__hint">Drag to pan · Scroll to zoom</span>
        <div className="flex items-center gap-1.5">
          <span className="mission-badge">{Math.round(viewport.scale * 100)}%</span>
          <button
            type="button"
            className="mission-button-muted px-2.5 py-1 text-[12px]"
            onClick={() => zoomAroundCenter(1 / ZOOM_STEP)}
            aria-label="Zoom out org chart"
          >
            -
          </button>
          <button
            type="button"
            className="mission-button-muted px-2.5 py-1 text-[12px]"
            onClick={() => zoomAroundCenter(ZOOM_STEP)}
            aria-label="Zoom in org chart"
          >
            +
          </button>
          <button
            type="button"
            className="mission-button-muted px-2.5 py-1 text-[12px]"
            onClick={() => setViewport({ scale: 1, x: 0, y: 0 })}
          >
            Reset
          </button>
        </div>
      </div>

      <ConnectionLines
        trees={trees}
        positions={positions}
        width={size.width}
        height={size.height}
      />

      {trees.length === 0 ? (
        <div className="org-chart__empty text-sm text-linear-muted">
          No office agents connected yet.
        </div>
      ) : null}

      <div
        className="org-chart__scene"
        style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
      >
        <div className="org-chart__roots">
          {trees.map((tree) => {
            const levels = collectLevels(tree);
            return (
              <div key={tree.agent.id} className="org-chart__branch">
                {levels.map((level, levelIndex) => (
                  <div key={levelIndex} className="org-chart__level">
                    {level.map((node) => (
                      <div key={node.agent.id} data-agent-id={node.agent.id}>
                        <AgentNode
                          agent={node.agent}
                          providerAgent={providerAgentsByOfficeAgentId.get(node.agent.id) ?? null}
                          selected={selectedAgentId === node.agent.id}
                          thinking={thinkingAgentId === node.agent.id}
                          onSelect={onSelectAgent}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
