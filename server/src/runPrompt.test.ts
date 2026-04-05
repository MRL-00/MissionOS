import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRunPrompt } from "./runPrompt.js";

test("returns the raw task when agent config is managed externally", () => {
  const prompt = buildRunPrompt({
    external_config: 1,
    soul_md: "# Purpose\nDelegate work.",
    agents_md: "# Rules\nUse Claudy.",
    skills: JSON.stringify(["Planning"]),
  }, "Fix EPIC-002.");

  assert.equal(prompt, "Fix EPIC-002.");
});

test("injects soul, skills, agents, and task sections for locally managed agents", () => {
  const prompt = buildRunPrompt({
    external_config: 0,
    soul_md: "# Purpose\nDelegate work.",
    agents_md: "# Rules\nUse Claudy.",
    skills: JSON.stringify(["Planning", "Testing"]),
  }, "Fix EPIC-002.");

  assert.match(prompt, /\[SOUL\]\n# Purpose\nDelegate work\./);
  assert.match(prompt, /\[SKILLS\]\n- Planning\n- Testing/);
  assert.match(prompt, /\[AGENTS\]\n# Rules\nUse Claudy\./);
  assert.match(prompt, /\[TASK\]\nFix EPIC-002\./);
});
