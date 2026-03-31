import type { AgentRuntimeState } from "../../types";

export interface OrgTreeNode {
  agent: AgentRuntimeState;
  children: OrgTreeNode[];
  depth: number;
}

export interface NodePosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
