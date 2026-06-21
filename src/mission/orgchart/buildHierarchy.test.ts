import type { AgentRuntimeState } from "../../types";
import type { ProviderAgentRecord } from "../types";
import { buildHierarchy } from "./buildHierarchy";

function agent(overrides: Partial<AgentRuntimeState> & { id: string; name: string; role: string }): AgentRuntimeState {
  return {
    emoji: "",
    connected: true,
    status: "idle",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("buildHierarchy", () => {
  it("returns an empty array for an empty input", () => {
    const trees = buildHierarchy([]);
    expect(trees).toHaveLength(0);
  });

  it("returns a single root for one agent", () => {
    const trees = buildHierarchy([agent({ id: "a", name: "Alice", role: "Engineer" })]);
    expect(trees).toHaveLength(1);
    expect(trees[0]!.agent.name).toBe("Alice");
    expect(trees[0]!.children).toHaveLength(0);
  });

  it("builds a tree from parentAgentId", () => {
    const trees = buildHierarchy([
      agent({ id: "pickle", name: "Pickle", role: "Orchestrator" }),
      agent({ id: "dan", name: "Dan", role: "Engineer", parentAgentId: "pickle" }),
      agent({ id: "matt", name: "Matt", role: "Designer", parentAgentId: "pickle" }),
    ]);

    expect(trees).toHaveLength(1);
    expect(trees[0]!.agent.name).toBe("Pickle");
    expect(trees[0]!.children).toHaveLength(2);
    expect(trees[0]!.children.map((c) => c.agent.name).sort()).toEqual(["Dan", "Matt"]);
  });

  it("returns peer orchestrators as separate roots", () => {
    const trees = buildHierarchy([
      agent({ id: "pickle", name: "Pickle", role: "Orchestrator" }),
      agent({ id: "hermes", name: "Hermes", role: "The Boss" }),
    ]);

    expect(trees).toHaveLength(2);
    expect(trees.map((t) => t.agent.name).sort()).toEqual(["Hermes", "Pickle"]);
  });

  it("groups sub-agents under correct orchestrator via parentAgentId", () => {
    const trees = buildHierarchy([
      agent({ id: "pickle", name: "Pickle", role: "Orchestrator" }),
      agent({ id: "hermes", name: "Hermes", role: "The Boss" }),
      agent({ id: "dan", name: "Dan", role: "Engineer", parentAgentId: "pickle" }),
      agent({ id: "claude", name: "Claude", role: "Assistant", parentAgentId: "hermes" }),
    ]);

    expect(trees).toHaveLength(2);
    const pickleBranch = trees.find((t) => t.agent.name === "Pickle")!;
    const hermesBranch = trees.find((t) => t.agent.name === "Hermes")!;

    expect(pickleBranch.children).toHaveLength(1);
    expect(pickleBranch.children[0]!.agent.name).toBe("Dan");
    expect(hermesBranch.children).toHaveLength(1);
    expect(hermesBranch.children[0]!.agent.name).toBe("Claude");
  });

  it("supports nested hierarchies (3+ levels)", () => {
    const trees = buildHierarchy([
      agent({ id: "pickle", name: "Pickle", role: "Orchestrator" }),
      agent({ id: "lead", name: "Lead", role: "Lead Engineer", parentAgentId: "pickle" }),
      agent({ id: "dev", name: "Dev", role: "Engineer", parentAgentId: "lead" }),
    ]);

    expect(trees).toHaveLength(1);
    expect(trees[0]!.agent.name).toBe("Pickle");
    expect(trees[0]!.depth).toBe(0);
    expect(trees[0]!.children[0]!.agent.name).toBe("Lead");
    expect(trees[0]!.children[0]!.depth).toBe(1);
    expect(trees[0]!.children[0]!.children[0]!.agent.name).toBe("Dev");
    expect(trees[0]!.children[0]!.children[0]!.depth).toBe(2);
  });

  it("treats agent with missing parent ref as a root", () => {
    const trees = buildHierarchy([
      agent({ id: "a", name: "Alice", role: "Engineer", parentAgentId: "nonexistent" }),
      agent({ id: "b", name: "Bob", role: "Designer" }),
    ]);

    expect(trees).toHaveLength(2);
  });

  it("handles all agents being roots", () => {
    const trees = buildHierarchy([
      agent({ id: "a", name: "Alice", role: "Engineer" }),
      agent({ id: "b", name: "Bob", role: "Designer" }),
      agent({ id: "c", name: "Charlie", role: "QA" }),
    ]);

    expect(trees).toHaveLength(3);
  });

  it("sets correct depths for multi-orchestrator trees", () => {
    const trees = buildHierarchy([
      agent({ id: "pickle", name: "Pickle", role: "Orchestrator" }),
      agent({ id: "hermes", name: "Hermes", role: "The Boss" }),
      agent({ id: "dev", name: "Dev", role: "Engineer", parentAgentId: "hermes" }),
    ]);

    expect(trees).toHaveLength(2);
    trees.forEach((t) => expect(t.depth).toBe(0));
    const hermesBranch = trees.find((t) => t.agent.name === "Hermes")!;
    expect(hermesBranch.children[0]!.depth).toBe(1);
  });

  it("null parentAgentId means root", () => {
    const trees = buildHierarchy([
      agent({ id: "a", name: "Alice", role: "Engineer", parentAgentId: null }),
      agent({ id: "b", name: "Bob", role: "Designer", parentAgentId: "a" }),
    ]);

    expect(trees).toHaveLength(1);
    expect(trees[0]!.agent.name).toBe("Alice");
    expect(trees[0]!.children).toHaveLength(1);
    expect(trees[0]!.children[0]!.agent.name).toBe("Bob");
  });

  it("keeps agents visible when parentAgentId relationships contain a cycle", () => {
    const trees = buildHierarchy([
      agent({ id: "a", name: "Alice", role: "Lead", parentAgentId: "b" }),
      agent({ id: "b", name: "Bob", role: "Engineer", parentAgentId: "a" }),
    ]);

    expect(trees.map((tree) => tree.agent.name).sort()).toEqual(["Alice", "Bob"]);
    expect(trees.every((tree) => tree.children.length === 0)).toBe(true);
  });

  it("keeps agents visible when provider manager relationships contain a cycle", () => {
    const agents = [
      agent({ id: "a", name: "Alice", role: "Lead" }),
      agent({ id: "b", name: "Bob", role: "Engineer" }),
    ];
    const providerAgents: ProviderAgentRecord[] = [
      {
        connectorId: "provider",
        provider: "hermes",
        externalId: "provider-a",
        officeAgentId: "a",
        name: "Alice",
        managerExternalId: "provider-b",
        status: "online",
        imported: true,
      },
      {
        connectorId: "provider",
        provider: "hermes",
        externalId: "provider-b",
        officeAgentId: "b",
        name: "Bob",
        managerExternalId: "provider-a",
        status: "online",
        imported: true,
      },
    ];

    const trees = buildHierarchy(agents, providerAgents);

    expect(trees.map((tree) => tree.agent.name).sort()).toEqual(["Alice", "Bob"]);
    expect(trees.every((tree) => tree.children.length === 0)).toBe(true);
  });
});
