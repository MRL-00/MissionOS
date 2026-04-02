import assert from "node:assert/strict";
import { test } from "node:test";
import { RequestBodyError } from "./types";
import { missionControlTestExports } from "./mission-control";
import {
  buildHermesIntakePrompt,
  buildScoutReviewPrompt,
  buildScoutRoutingPrompt,
} from "./mission-workflow";

test("buildWorkerExecutionPrompt includes Scout follow-up context for revisions", () => {
  const prompt = missionControlTestExports.buildWorkerExecutionPrompt(
    "Ticket: EPIC-646",
    "full stack",
    "Atlas",
    "epic-646",
    {
      route: "fullstack",
      reason: "Web login button change.",
      implementationPrompt: "Update the login button styling.",
      acceptanceCriteria: ["Login button is green"],
      riskNotes: ["Keep scope limited to the login page"],
    },
    1,
    "",
    "Fix the disabled opacity regression.",
    "atlas/epic-646",
    ["https://github.com/example/repo/pull/123"],
  );

  assert.match(prompt, /Continue the existing implementation/);
  assert.match(prompt, /Reuse any existing branch and PR for this ticket/);
  assert.match(prompt, /Scout follow-up changes: Fix the disabled opacity regression\./);
  assert.match(prompt, /Current branch: atlas\/epic-646/);
  assert.match(prompt, /Known PR URLs: https:\/\/github.com\/example\/repo\/pull\/123/);
  assert.match(prompt, /If develop exists, you MUST branch from develop/);
  assert.match(prompt, /PR MUST target develop, not main or master/);
});

test("canRetryScoutReview allows bounded follow-up revisions", () => {
  assert.equal(missionControlTestExports.canRetryScoutReview(0), true);
  assert.equal(missionControlTestExports.canRetryScoutReview(1), true);
  assert.equal(missionControlTestExports.canRetryScoutReview(2), false);
});

test("looksLikeMetaWorkerResult detects prompt-reflective blocker responses", () => {
  assert.equal(
    missionControlTestExports.looksLikeMetaWorkerResult({
      status: "blocked",
      summary: "Inspected the repo and ran checks.",
      blockingReason: "The provided content does not include a completed implementation result or pull request URL.",
    }),
    true,
  );

  assert.equal(
    missionControlTestExports.looksLikeMetaWorkerResult({
      status: "blocked",
      summary: "pnpm install fails because the private registry token is missing.",
      blockingReason: "npm ERR! 401 Unauthorized from registry.example.com",
    }),
    false,
  );
});

test("buildWorkerMalformedResultPrompt redirects the worker back to execution", () => {
  const prompt = missionControlTestExports.buildWorkerMalformedResultPrompt(
    "Atlas",
    {
      status: "blocked",
      summary: "Inspected the repo and reviewed files.",
      blockingReason: "The provided content does not include a branch name.",
    },
    "Ticket: EPIC-646",
    "atlas/epic-646",
    ["https://github.com/example/repo/pull/123"],
  );

  assert.match(prompt, /described the prompt or available content/);
  assert.match(prompt, /Do not talk about 'provided content'/);
  assert.match(prompt, /Work in the repository now/);
  assert.match(prompt, /reuse it and do not create another one/);
  assert.match(prompt, /If develop exists, you MUST branch from develop/);
  assert.match(prompt, /Current branch: atlas\/epic-646/);
  assert.match(prompt, /Known PR URLs: https:\/\/github.com\/example\/repo\/pull\/123/);
  assert.match(prompt, /Ticket: EPIC-646/);
});

test("developBranchPolicyInstructions makes develop mandatory when present", () => {
  const instructions = missionControlTestExports.developBranchPolicyInstructions();

  assert.deepEqual(instructions, [
    "Before creating or reusing a branch, check whether the repository has a local or remote develop branch.",
    "If develop exists, you MUST branch from develop and any PR MUST target develop, not main or master.",
    "Only use main/master as the base branch if develop does not exist.",
  ]);
});

test("detectAgentTransportIssue classifies HTTP 429 banners as retryable", () => {
  assert.deepEqual(
    missionControlTestExports.detectAgentTransportIssue("[HTTP 429] Too Many Requests"),
    {
      message: "Too Many Requests",
      retryable: true,
      statusCode: 429,
    },
  );
});

test("isRetryableAgentTransportError distinguishes transient transport failures from parse failures", () => {
  assert.equal(
    missionControlTestExports.isRetryableAgentTransportError(
      new RequestBodyError("Atlas execution failed: Too Many Requests", 429),
    ),
    true,
  );

  assert.equal(
    missionControlTestExports.isRetryableAgentTransportError(
      new RequestBodyError("Atlas execution returned invalid JSON: Unexpected token", 502),
    ),
    false,
  );
});

test("buildWorkerExecutionPrompt forbids a second PR when retrying with existing artifacts", () => {
  const prompt = missionControlTestExports.buildWorkerExecutionPrompt(
    "Ticket: EPIC-646",
    "full stack",
    "Atlas",
    "epic-646",
    {
      route: "fullstack",
      reason: "Web login button change.",
      implementationPrompt: "Update the login button styling.",
      acceptanceCriteria: ["Login button is green"],
      riskNotes: [],
    },
    2,
    "Retry after a procedural blocker.",
    "",
    "atlas/EPIC-646-change-login-button-green",
    [
      "https://github.com/example/repo/pull/567",
      "https://github.com/example/repo/pull/568",
    ],
  );

  assert.match(prompt, /Do not create or open a second PR/);
  assert.match(prompt, /Multiple PRs are already linked to this ticket/);
  assert.match(prompt, /Known PR URLs: https:\/\/github.com\/example\/repo\/pull\/567, https:\/\/github.com\/example\/repo\/pull\/568/);
});

test("mergeWorkerExecutionContext preserves branch and PRs from blocked attempts", () => {
  const merged = missionControlTestExports.mergeWorkerExecutionContext(
    {
      branch: "matt/epic-646-change-login-button-to-be-green",
      pullRequestUrls: ["https://github.com/example/repo/pull/568"],
    },
    {
      branch: "atlas/EPIC-646-change-login-button-green",
      pullRequestUrl: "https://github.com/example/repo/pull/567",
    },
  );

  assert.equal(merged.branch, "atlas/EPIC-646-change-login-button-green");
  assert.deepEqual(merged.pullRequestUrls, [
    "https://github.com/example/repo/pull/568",
    "https://github.com/example/repo/pull/567",
  ]);
});

test("workerExecutionContextFromTask seeds known branch and PRs from Linear metadata", () => {
  const context = missionControlTestExports.workerExecutionContextFromTask({
    task: {
      id: "task-1",
      identifier: "EPIC-646",
      title: "Change login button to be green",
      gitBranchName: "matt/epic-646-change-login-button-to-be-green",
      pullRequestUrls: [
        "https://github.com/example/repo/pull/568",
        "https://github.com/example/repo/pull/567",
      ],
      priority: 0,
      state: { name: "Todo" },
      team: { name: "EpicShot" },
      labels: [],
      createdAt: 0,
      updatedAt: 0,
      handoffCount: 0,
      commentCount: 0,
    },
    comments: [],
    handoffs: [],
  });

  assert.equal(context.branch, "matt/epic-646-change-login-button-to-be-green");
  assert.deepEqual(context.pullRequestUrls, [
    "https://github.com/example/repo/pull/568",
    "https://github.com/example/repo/pull/567",
  ]);
});

test("workflow prompts use SOUL/profile context instead of redefining agent identity", () => {
  const intakePrompt = buildHermesIntakePrompt("Ticket: EPIC-646");
  const routingPrompt = buildScoutRoutingPrompt("Ready for implementation.", "Ticket: EPIC-646");
  const reviewPrompt = buildScoutReviewPrompt(
    "Ticket: EPIC-646",
    "Atlas",
    "full stack",
    {
      status: "implemented",
      summary: "Updated the login button to the green variant.",
      branch: "atlas/epic-646",
      pullRequestUrl: "https://github.com/example/repo/pull/123",
      reviewPrompt: "Verify the login button states.",
    },
    "atlas/epic-646",
    ["https://github.com/example/repo/pull/123"],
  );

  assert.match(intakePrompt, /SOUL\.md role/);
  assert.match(routingPrompt, /SOUL\.md role/);
  assert.match(reviewPrompt, /SOUL\.md role/);
  assert.doesNotMatch(intakePrompt, /You are Hermes/);
  assert.doesNotMatch(routingPrompt, /You are Scout/);
  assert.doesNotMatch(reviewPrompt, /You are Scout/);
});
