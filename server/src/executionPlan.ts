// ── Execution Plan Types ────────────────────────────────────────────────

export interface ExecutionPlanStep {
  id: string;
  agent: string;
  task: string;
  dependsOn?: string[];
}

export interface ExecutionPlan {
  plan: ExecutionPlanStep[];
  summary?: string;
}

// ── Plan Extraction ─────────────────────────────────────────────────────

/**
 * Extract a structured execution plan from agent output.
 * Tries in order:
 *   1. Fenced ```json:plan block
 *   2. Fenced ```json block containing a top-level `plan` array
 *   3. Raw `{ "plan": [...] }` in the text
 */
export function extractPlan(output: string): ExecutionPlan | null {
  // Strategy 1: ```json:plan fenced block
  const taggedMatches = [...output.matchAll(/```json:plan\s*\n([\s\S]*?)```/g)];
  for (let index = taggedMatches.length - 1; index >= 0; index -= 1) {
    const parsed = tryParsePlan(taggedMatches[index]?.[1] ?? "");
    if (parsed) return parsed;
  }

  // Strategy 2: ```json fenced block with plan array
  const jsonMatches = [...output.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  for (let index = jsonMatches.length - 1; index >= 0; index -= 1) {
    const parsed = tryParsePlan(jsonMatches[index]?.[1] ?? "");
    if (parsed) return parsed;
  }

  // Strategy 3: raw JSON object with plan array
  const rawMatches = [...output.matchAll(/\{\s*"plan"\s*:\s*\[[\s\S]*?\]\s*(?:,\s*"summary"\s*:\s*"[^"]*"\s*)?\}/g)];
  for (let index = rawMatches.length - 1; index >= 0; index -= 1) {
    const parsed = tryParsePlan(rawMatches[index]?.[0] ?? "");
    if (parsed) return parsed;
  }

  return null;
}

function tryParsePlan(text: string): ExecutionPlan | null {
  try {
    const obj = JSON.parse(text.trim());
    if (obj && Array.isArray(obj.plan) && obj.plan.length > 0) {
      return obj as ExecutionPlan;
    }
  } catch {
    // Invalid JSON
  }
  return null;
}

// ── Plan Validation ─────────────────────────────────────────────────────

export function validatePlan(
  plan: ExecutionPlan,
  knownAgentNames: string[],
): { valid: boolean; error?: string } {
  if (!plan.plan || plan.plan.length === 0) {
    return { valid: false, error: "Plan has no steps." };
  }

  const stepIds = new Set<string>();
  const lowerAgentNames = new Set(knownAgentNames.map((n) => n.toLowerCase()));

  for (const step of plan.plan) {
    if (!step.id || typeof step.id !== "string") {
      return { valid: false, error: "Step missing id." };
    }
    if (stepIds.has(step.id)) {
      return { valid: false, error: `Duplicate step id: ${step.id}` };
    }
    stepIds.add(step.id);

    if (!step.agent || typeof step.agent !== "string") {
      return { valid: false, error: `Step ${step.id} missing agent.` };
    }
    if (!lowerAgentNames.has(step.agent.toLowerCase())) {
      return { valid: false, error: `Step ${step.id} references unknown agent: ${step.agent}` };
    }

    if (!step.task || typeof step.task !== "string") {
      return { valid: false, error: `Step ${step.id} missing task.` };
    }

    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep) && !plan.plan.some((s) => s.id === dep)) {
          return { valid: false, error: `Step ${step.id} depends on unknown step: ${dep}` };
        }
      }
    }
  }

  // Check for circular dependencies via topological sort
  const cycleError = detectCycles(plan.plan);
  if (cycleError) {
    return { valid: false, error: cycleError };
  }

  return { valid: true };
}

function detectCycles(steps: ExecutionPlanStep[]): string | null {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  function dfs(id: string): string | null {
    if (visiting.has(id)) return `Circular dependency detected involving step: ${id}`;
    if (visited.has(id)) return null;

    visiting.add(id);
    const step = stepMap.get(id);
    if (step?.dependsOn) {
      for (const dep of step.dependsOn) {
        const err = dfs(dep);
        if (err) return err;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const step of steps) {
    const err = dfs(step.id);
    if (err) return err;
  }
  return null;
}

// ── Dependency Resolution ───────────────────────────────────────────────

/**
 * Returns steps that are ready to execute: all dependencies satisfied
 * and not yet started.
 */
export function getReadySteps(
  plan: ExecutionPlan,
  completedStepIds: Set<string>,
  startedStepIds: Set<string>,
): ExecutionPlanStep[] {
  return plan.plan.filter((step) => {
    if (startedStepIds.has(step.id)) return false;
    if (!step.dependsOn || step.dependsOn.length === 0) return true;
    return step.dependsOn.every((dep) => completedStepIds.has(dep));
  });
}
