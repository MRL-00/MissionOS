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
  childSubtreeWorking: boolean;
  childSubtreeMeeting: boolean;
}

function collectEdges(node: OrgTreeNode): { edges: Edge[]; subtreeWorking: boolean; subtreeMeeting: boolean } {
  const edges: Edge[] = [];
  let subtreeWorking = node.agent.connected && node.agent.status === "working";
  let subtreeMeeting = node.agent.connected && node.agent.status === "meeting";

  node.children.forEach((child) => {
    const childTree = collectEdges(child);
    edges.push({
      parentId: node.agent.id,
      childId: child.agent.id,
      childAgent: child.agent,
      childSubtreeWorking: childTree.subtreeWorking,
      childSubtreeMeeting: childTree.subtreeMeeting,
    });
    edges.push(...childTree.edges);
    subtreeWorking = subtreeWorking || childTree.subtreeWorking;
    subtreeMeeting = subtreeMeeting || childTree.subtreeMeeting;
  });

  return { edges, subtreeWorking, subtreeMeeting };
}

function lineClass(childAgent: AgentRuntimeState, childSubtreeWorking: boolean, childSubtreeMeeting: boolean): string {
  if (!childAgent.connected) {
    return "org-line org-line--disconnected";
  }
  if (childSubtreeWorking) {
    return "org-line org-line--active";
  }
  if (childSubtreeMeeting) {
    return "org-line org-line--meeting";
  }
  return "org-line";
}

export function ConnectionLines({ trees, positions, width, height }: ConnectionLinesProps) {
  if (positions.size === 0) {
    return null;
  }

  const edges = trees.flatMap((tree) => collectEdges(tree).edges);

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
            className={lineClass(edge.childAgent, edge.childSubtreeWorking, edge.childSubtreeMeeting)}
          />
        );
      })}
    </svg>
  );
}
