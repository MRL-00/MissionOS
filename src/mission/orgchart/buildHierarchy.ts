import type { AgentRuntimeState } from "../../types";
import type { ProviderAgentRecord } from "../types";
import type { OrgTreeNode } from "./types";

/**
 * Build org-chart trees from the flat agents array.
 *
 * The hierarchy is determined by `parentAgentId`:
 *   - Agents with no parent (undefined/null) are roots.
 *   - Each root becomes an independent tree.
 *   - If every agent has a parent but the referenced parent doesn't exist,
 *     the agent falls back to root level.
 *
 * Returns one OrgTreeNode per root, sorted alphabetically.
 */
export function buildHierarchy(agents: AgentRuntimeState[], providerAgents: ProviderAgentRecord[] = []): OrgTreeNode[] {
  if (agents.length === 0) {
    return [];
  }

  const agentMap = new Map<string, AgentRuntimeState>();
  agents.forEach((agent) => agentMap.set(agent.id, agent));
  const providerByOfficeAgentId = new Map<string, ProviderAgentRecord>();
  const providerByExternalId = new Map<string, ProviderAgentRecord>();
  providerAgents.forEach((agent) => {
    if (agent.officeAgentId && !providerByOfficeAgentId.has(agent.officeAgentId)) {
      providerByOfficeAgentId.set(agent.officeAgentId, agent);
    }
    if (!providerByExternalId.has(agent.externalId)) {
      providerByExternalId.set(agent.externalId, agent);
    }
  });

  // Group children by parent id
  const childrenOf = new Map<string, AgentRuntimeState[]>();
  const roots: AgentRuntimeState[] = [];

  agents.forEach((agent) => {
    const providerAgent = providerByOfficeAgentId.get(agent.id);
    const providerParentExternalId = providerAgent?.reportsToExternalId ?? providerAgent?.managerExternalId;
    const providerParent = providerParentExternalId ? providerByExternalId.get(providerParentExternalId) : undefined;
    const parentId = providerParent?.officeAgentId ?? agent.parentAgentId;
    if (!parentId || !agentMap.has(parentId)) {
      roots.push(agent);
    } else {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(agent);
      childrenOf.set(parentId, siblings);
    }
  });

  function buildNode(agent: AgentRuntimeState, depth: number): OrgTreeNode {
    const children = (childrenOf.get(agent.id) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => buildNode(child, depth + 1));
    return { agent, children, depth };
  }

  const sortedRoots = [...roots].sort((a, b) => a.name.localeCompare(b.name));
  return sortedRoots.map((root) => buildNode(root, 0));
}
