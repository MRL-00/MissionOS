import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPlan, validatePlan, getReadySteps } from "./executionPlan.js";
import type { ExecutionPlan } from "./executionPlan.js";

// ── extractPlan ─────────────────────────────────────────────────────────

test("extracts plan from ```json:plan fenced block", () => {
  const output = `Here is my analysis.\n\n\`\`\`json:plan\n{"plan":[{"id":"impl","agent":"Claudy","task":"Fix the button"}],"summary":"Quick fix"}\n\`\`\`\n\nDone.`;
  const plan = extractPlan(output);
  assert.ok(plan);
  assert.equal(plan!.plan.length, 1);
  assert.equal(plan!.plan[0]!.id, "impl");
  assert.equal(plan!.plan[0]!.agent, "Claudy");
  assert.equal(plan!.summary, "Quick fix");
});

test("extracts plan from generic ```json fenced block", () => {
  const output = `\`\`\`json\n{"plan":[{"id":"a","agent":"Claudy","task":"Do stuff"}]}\n\`\`\``;
  const plan = extractPlan(output);
  assert.ok(plan);
  assert.equal(plan!.plan.length, 1);
});

test("extracts plan from raw JSON in text", () => {
  const output = `I recommend: {"plan":[{"id":"x","agent":"Cody","task":"Build it"}],"summary":"iOS work"}`;
  const plan = extractPlan(output);
  assert.ok(plan);
  assert.equal(plan!.plan[0]!.agent, "Cody");
});

test("returns null for output with no JSON", () => {
  assert.equal(extractPlan("Just some regular text output."), null);
});

test("returns null for malformed JSON", () => {
  const output = `\`\`\`json:plan\n{broken json\n\`\`\``;
  assert.equal(extractPlan(output), null);
});

test("returns null for JSON missing plan array", () => {
  const output = `\`\`\`json\n{"steps":[{"id":"a","agent":"Claudy","task":"Do stuff"}]}\n\`\`\``;
  assert.equal(extractPlan(output), null);
});

test("returns null for empty plan array", () => {
  const output = `\`\`\`json:plan\n{"plan":[]}\n\`\`\``;
  assert.equal(extractPlan(output), null);
});

// ── validatePlan ────────────────────────────────────────────────────────

const knownAgents = ["Claudy", "Cody", "QA"];

test("accepts valid plan with parallel steps", () => {
  const plan: ExecutionPlan = {
    plan: [
      { id: "a", agent: "Claudy", task: "Do frontend" },
      { id: "b", agent: "Cody", task: "Do iOS" },
    ],
  };
  assert.deepEqual(validatePlan(plan, knownAgents), { valid: true });
});

test("accepts valid plan with dependencies", () => {
  const plan: ExecutionPlan = {
    plan: [
      { id: "impl", agent: "Claudy", task: "Implement" },
      { id: "qa", agent: "QA", task: "Test", dependsOn: ["impl"] },
    ],
  };
  assert.deepEqual(validatePlan(plan, knownAgents), { valid: true });
});

test("rejects empty plan", () => {
  const result = validatePlan({ plan: [] }, knownAgents);
  assert.equal(result.valid, false);
  assert.match(result.error!, /no steps/i);
});

test("rejects step with blank agent", () => {
  const result = validatePlan({ plan: [{ id: "a", agent: "", task: "Do stuff" }] }, knownAgents);
  assert.equal(result.valid, false);
  assert.match(result.error!, /missing agent/i);
});

test("rejects step with blank task", () => {
  const result = validatePlan({ plan: [{ id: "a", agent: "Claudy", task: "" }] }, knownAgents);
  assert.equal(result.valid, false);
  assert.match(result.error!, /missing task/i);
});

test("rejects unknown agent name", () => {
  const result = validatePlan({ plan: [{ id: "a", agent: "Unknown", task: "Do stuff" }] }, knownAgents);
  assert.equal(result.valid, false);
  assert.match(result.error!, /unknown agent/i);
});

test("agent name matching is case-insensitive", () => {
  const plan: ExecutionPlan = {
    plan: [{ id: "a", agent: "claudy", task: "Do stuff" }],
  };
  assert.deepEqual(validatePlan(plan, knownAgents), { valid: true });
});

test("rejects circular dependencies", () => {
  const plan: ExecutionPlan = {
    plan: [
      { id: "a", agent: "Claudy", task: "Do A", dependsOn: ["b"] },
      { id: "b", agent: "Cody", task: "Do B", dependsOn: ["a"] },
    ],
  };
  const result = validatePlan(plan, knownAgents);
  assert.equal(result.valid, false);
  assert.match(result.error!, /circular/i);
});

test("rejects dangling dependsOn reference", () => {
  const plan: ExecutionPlan = {
    plan: [{ id: "a", agent: "Claudy", task: "Do stuff", dependsOn: ["nonexistent"] }],
  };
  const result = validatePlan(plan, knownAgents);
  assert.equal(result.valid, false);
  assert.match(result.error!, /unknown step/i);
});

test("rejects duplicate step ids", () => {
  const plan: ExecutionPlan = {
    plan: [
      { id: "a", agent: "Claudy", task: "First" },
      { id: "a", agent: "Cody", task: "Second" },
    ],
  };
  const result = validatePlan(plan, knownAgents);
  assert.equal(result.valid, false);
  assert.match(result.error!, /duplicate/i);
});

// ── getReadySteps ───────────────────────────────────────────────────────

test("all steps ready when none have dependencies", () => {
  const plan: ExecutionPlan = {
    plan: [
      { id: "a", agent: "Claudy", task: "Do A" },
      { id: "b", agent: "Cody", task: "Do B" },
    ],
  };
  const ready = getReadySteps(plan, new Set(), new Set());
  assert.equal(ready.length, 2);
});

test("step blocked until dependency completes", () => {
  const plan: ExecutionPlan = {
    plan: [
      { id: "impl", agent: "Claudy", task: "Implement" },
      { id: "qa", agent: "QA", task: "Test", dependsOn: ["impl"] },
    ],
  };

  // Initially only impl is ready
  const ready1 = getReadySteps(plan, new Set(), new Set());
  assert.equal(ready1.length, 1);
  assert.equal(ready1[0]!.id, "impl");

  // After impl started but not complete, qa still blocked
  const ready2 = getReadySteps(plan, new Set(), new Set(["impl"]));
  assert.equal(ready2.length, 0);

  // After impl completes, qa is ready
  const ready3 = getReadySteps(plan, new Set(["impl"]), new Set(["impl"]));
  assert.equal(ready3.length, 1);
  assert.equal(ready3[0]!.id, "qa");
});

test("multiple steps unblock when shared dependency completes", () => {
  const plan: ExecutionPlan = {
    plan: [
      { id: "impl", agent: "Claudy", task: "Implement" },
      { id: "qa1", agent: "QA", task: "Test A", dependsOn: ["impl"] },
      { id: "qa2", agent: "QA", task: "Test B", dependsOn: ["impl"] },
    ],
  };
  const ready = getReadySteps(plan, new Set(["impl"]), new Set(["impl"]));
  assert.equal(ready.length, 2);
});

test("already-started steps are not returned", () => {
  const plan: ExecutionPlan = {
    plan: [
      { id: "a", agent: "Claudy", task: "Do A" },
      { id: "b", agent: "Cody", task: "Do B" },
    ],
  };
  const ready = getReadySteps(plan, new Set(), new Set(["a"]));
  assert.equal(ready.length, 1);
  assert.equal(ready[0]!.id, "b");
});
