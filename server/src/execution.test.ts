import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDelegationMessage,
  isDelegationOnlyAgent,
  isImplementationAgent,
  stripPromptEcho,
} from "./execution.js";

test("identifies implementation-capable agents by tool access", () => {
  assert.equal(isImplementationAgent({ tools: JSON.stringify(["code-exec"]) }), true);
  assert.equal(isImplementationAgent({ tools: JSON.stringify(["file-system"]) }), true);
  assert.equal(isImplementationAgent({ tools: JSON.stringify(["web-search"]) }), false);
});

test("identifies delegation-only agents from role/prompt identity when they lack implementation tools", () => {
  assert.equal(
    isDelegationOnlyAgent({
      name: "Boss",
      role: "Orchestrator",
      soul_md: "You are delegation-only by default.",
      tools: JSON.stringify([]),
    }),
    true,
  );

  assert.equal(
    isDelegationOnlyAgent({
      name: "Analyst",
      role: "Researcher",
      soul_md: "Read docs and summarize findings.",
      tools: JSON.stringify([]),
    }),
    false,
  );
});

test("buildDelegationMessage includes issue, repo, acceptance, and verification context", () => {
  const message = buildDelegationMessage(
    { name: "Boss" },
    "Claudy",
    {
      issueId: "issue-1",
      missionId: "mission-1",
      issueTitle: "Change login button to be ORANGE",
      issueDescription: "Change the login button to be ORANGE on the main login page.",
      missionTitle: "EpicZone",
      githubRepo: "acme/portal",
      baseBranch: "main",
      rawPrompt: "fallback prompt",
    },
  );

  assert.match(message, /Implement issue issue-1: Change login button to be ORANGE\./);
  assert.match(message, /Repository context: acme\/portal on base branch main\./);
  assert.match(message, /Acceptance criteria:/);
  assert.match(message, /Verification:/);
  assert.match(message, /general product engineering work/i);
});

test("stripPromptEcho removes echoed orchestrator prompt before delegation parsing", () => {
  const prompt = [
    "[OUTPUT FORMAT]",
    "Use one single-line directive to hand work off:",
    "@agent:Claudy: Implement EPIC-002 in the linked repo. Change the main login button to black.",
    "",
    "[TASK]",
    "Resolve the following issue.",
  ].join("\n");
  const modelOutput = [
    prompt,
    "",
    "```json:plan",
    JSON.stringify(
      {
        plan: [
          {
            id: "step-1",
            agent: "Claudy",
            task: "Issue ID: issue-1. Change login button text to WASSSSSUP.",
          },
        ],
        summary: "Delegate the requested login page copy change to Claudy.",
      },
      null,
      2,
    ),
    "```",
  ].join("\n");

  const stripped = stripPromptEcho(modelOutput, [prompt]);

  assert.doesNotMatch(stripped, /@agent:Claudy: Implement EPIC-002/i);
  assert.match(stripped, /```json:plan/);
  assert.match(stripped, /WASSSSSUP/);
});
