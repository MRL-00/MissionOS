import type { AgentRecord, EngineDefinition } from "@/mission/appTypes";
import { orgChartRelationshipReadyAgentIds } from "./OrgChartPage";

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-ready",
    name: "Ready Agent",
    role: "Operator",
    emoji: "R",
    color: "#5e4ae3",
    engine: "codex",
    skills: [],
    tools: [],
    connection_type: null,
    connection_config: {},
    soul_md: null,
    agents_md: null,
    external_config: false,
    active: true,
    created_at: "2026-05-06T00:00:00.000Z",
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeEngine(overrides: Partial<EngineDefinition> = {}): EngineDefinition {
  return {
    id: "codex",
    label: "Codex",
    description: "Code execution",
    connectionType: "cli",
    fields: [],
    ...overrides,
  };
}

describe("orgChartRelationshipReadyAgentIds", () => {
  it("only includes active agents using supported engines", () => {
    const readyIds = orgChartRelationshipReadyAgentIds({
      agents: [
        makeAgent({ id: "agent-ready", active: true, engine: "codex" }),
        makeAgent({ id: "agent-inactive", active: false, engine: "codex" }),
        makeAgent({ id: "agent-legacy", active: true, engine: "legacy-engine" }),
      ],
      engines: [makeEngine({ id: "codex" })],
    });

    expect([...readyIds]).toEqual(["agent-ready"]);
  });
});
