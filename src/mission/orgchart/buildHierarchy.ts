import type { AgentRuntimeState } from "../../types";
import type { OrgTreeNode } from "./types";

const ORCHESTRATOR_MATCHER = /(orchestrat|cio|chief|director)/i;
const LEAD_MATCHER = /(lead|head|manager|senior)/i;

function classify(agent: AgentRuntimeState): "orchestrator" | "lead" | "ic" {
  if (ORCHESTRATOR_MATCHER.test(agent.role)) {
    return "orchestrator";
  }
  if (LEAD_MATCHER.test(agent.role)) {
    return "lead";
  }
  return "ic";
}

function syntheticRoot(): AgentRuntimeState {
  return {
    id: "__orchestrator__",
    name: "Orchestrator",
    role: "System Orchestrator",
    emoji: "\u{1F3AF}",
    connected: true,
    status: "idle",
    timestamp: Date.now(),
  };
}

export function buildHierarchy(agents: AgentRuntimeState[]): OrgTreeNode {
  if (agents.length === 0) {
    return { agent: syntheticRoot(), children: [], depth: 0, isSynthetic: true };
  }

  const orchestrators: AgentRuntimeState[] = [];
  const leads: AgentRuntimeState[] = [];
  const ics: AgentRuntimeState[] = [];

  agents.forEach((agent) => {
    switch (classify(agent)) {
      case "orchestrator":
        orchestrators.push(agent);
        break;
      case "lead":
        leads.push(agent);
        break;
      default:
        ics.push(agent);
        break;
    }
  });

  const rootAgent = orchestrators[0] ?? syntheticRoot();
  const isSynthetic = orchestrators.length === 0;

  // Remaining orchestrators become leads
  orchestrators.slice(1).forEach((agent) => leads.push(agent));

  // If no leads, all ICs go directly under root
  if (leads.length === 0) {
    return {
      agent: rootAgent,
      children: ics.map((agent) => ({ agent, children: [], depth: 1 })),
      depth: 0,
      isSynthetic,
    };
  }

  // Assign ICs to the closest lead by matching provider, then round-robin
  const leadChildren = new Map<string, AgentRuntimeState[]>();
  leads.forEach((lead) => leadChildren.set(lead.id, []));

  const unassigned: AgentRuntimeState[] = [];

  ics.forEach((ic) => {
    const icProvider = (ic as AgentRuntimeState & { backendLink?: { provider?: string } }).backendLink?.provider;

    // Try to match by provider
    if (icProvider) {
      const matchingLead = leads.find((lead) => {
        const leadProvider = (lead as AgentRuntimeState & { backendLink?: { provider?: string } }).backendLink?.provider;
        return leadProvider === icProvider;
      });
      if (matchingLead) {
        leadChildren.get(matchingLead.id)!.push(ic);
        return;
      }
    }

    unassigned.push(ic);
  });

  // Round-robin unassigned ICs across leads
  unassigned.forEach((ic, index) => {
    const lead = leads[index % leads.length]!;
    leadChildren.get(lead.id)!.push(ic);
  });

  const children: OrgTreeNode[] = leads.map((lead) => ({
    agent: lead,
    children: (leadChildren.get(lead.id) ?? []).map((ic) => ({
      agent: ic,
      children: [],
      depth: 2,
    })),
    depth: 1,
  }));

  return { agent: rootAgent, children, depth: 0, isSynthetic };
}
