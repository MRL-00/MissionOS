import type { AgentRuntimeState } from "../../types";
import type { NodePosition, OrgTreeNode } from "./types";

interface ConnectionLinesProps {
  trees: OrgTreeNode[];
  positions: Map<string, NodePosition>;
  width: number;
  height: number;
}

interface Edge {
  parentId: string;
  childId: string;
  childAgent: AgentRuntimeState;
}

function collectEdges(node: OrgTreeNode): Edge[] {
  const edges: Edge[] = [];
  node.children.forEach((child) => {
    edges.push({ parentId: node.agent.id, childId: child.agent.id, childAgent: child.agent });
    edges.push(...collectEdges(child));
  });
  return edges;
}

function lineClass(agent: AgentRuntimeState): string {
  if (!agent.connected) {
    return "org-line org-line--disconnected";
  }
  if (agent.status === "working") {
    return "org-line org-line--active";
  }
  if (agent.status === "meeting") {
    return "org-line org-line--meeting";
  }
  return "org-line";
}

export function ConnectionLines({ trees, positions, width, height }: ConnectionLinesProps) {
  if (positions.size === 0) {
    return null;
  }

  const edges = trees.flatMap((tree) => collectEdges(tree));

  return (
    <svg className="org-chart__svg" width={width} height={height} aria-hidden="true">
      {edges.map((edge) => {
        const parent = positions.get(edge.parentId);
        const child = positions.get(edge.childId);
        if (!parent || !child) {
          return null;
        }

        const x1 = parent.x;
        const y1 = parent.y + parent.height;
        const x2 = child.x;
        const y2 = child.y;
        const midY = y1 + (y2 - y1) / 2;

        const path = `M ${x1},${y1} C ${x1},${midY} ${x2},${midY} ${x2},${y2}`;

        return (
          <path
            key={`${edge.parentId}-${edge.childId}`}
            d={path}
            className={lineClass(edge.childAgent)}
          />
        );
      })}
    </svg>
  );
}
