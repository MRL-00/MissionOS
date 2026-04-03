import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildArtifactBackedScoutDeliveryDecision,
  buildArtifactBackedScoutReviewDecision,
  buildFallbackScoutRoutingDecision,
  buildScoutDeliveryPrompt,
  buildScoutReviewLinearComment,
  buildTaskContext,
  preferredThreadReplyCommentId,
  validateScoutDeliveryDecision,
  validateScoutRoutingDecision,
  validateScoutReviewDecision,
} from "./mission-workflow";

test("preferredThreadReplyCommentId targets the latest human thread and ignores automated suffixes", () => {
  const detail = {
    task: {
      id: "task-1",
      identifier: "EPIC-653",
      title: "Change login button to be RED",
      priority: 0,
      state: { name: "Todo" },
      team: { name: "EpicShot" },
      labels: [],
      createdAt: 0,
      updatedAt: 0,
      handoffCount: 0,
      commentCount: 5,
    },
    comments: [
      {
        id: "c1",
        taskId: "task-1",
        body: "Need a bit more detail here. ^Hermes",
        authorName: "matt",
        createdAt: 1,
        source: "linear" as const,
      },
      {
        id: "c2",
        taskId: "task-1",
        body: "It is the login button on the sign-in page.",
        authorName: "matt",
        parentCommentId: "c1",
        createdAt: 2,
        source: "linear" as const,
      },
      {
        id: "c3",
        taskId: "task-1",
        body: "Using bg-red-500 is fine. ^Hermes",
        authorName: "matt",
        parentCommentId: "c1",
        createdAt: 3,
        source: "linear" as const,
      },
      {
        id: "c4",
        taskId: "task-1",
        body: "Please also keep the hover state a darker red.",
        authorName: "matt",
        parentCommentId: "c1",
        createdAt: 4,
        source: "linear" as const,
      },
    ],
    handoffs: [],
  };

  assert.equal(preferredThreadReplyCommentId(detail), "c1");
});

test("buildTaskContext renders threaded comments with indentation", () => {
  const context = buildTaskContext({
    task: {
      id: "task-1",
      identifier: "EPIC-653",
      title: "Change login button to be RED",
      description: "Update the login page CTA.",
      priority: 0,
      state: { name: "Todo" },
      team: { name: "EpicShot" },
      labels: [],
      createdAt: 0,
      updatedAt: 0,
      handoffCount: 0,
      commentCount: 2,
    },
    comments: [
      {
        id: "root",
        taskId: "task-1",
        body: "Need the exact color token. ^Hermes",
        authorName: "matt",
        createdAt: 1,
        source: "linear" as const,
      },
      {
        id: "reply",
        taskId: "task-1",
        body: "Use bg-red-500.",
        authorName: "matt",
        parentCommentId: "root",
        createdAt: 2,
        source: "linear" as const,
      },
    ],
    handoffs: [],
  });

  assert.match(context, /Recent comments:/);
  assert.match(context, /- matt: Need the exact color token\. \^Hermes/);
  assert.match(context, /  - matt: Use bg-red-500\./);
});

test("validateScoutReviewDecision rejects stale ticket and PR references", () => {
  const errors = validateScoutReviewDecision(
    {
      decision: "approved",
      summary: "Looks good.",
      reviewedTicket: "EPIC-646",
      reviewedBranch: "atlas/epic-646",
      reviewedPullRequestUrl: "https://github.com/example/repo/pull/569",
      reviewedFiles: ["src/routes/login.tsx"],
      evidence: ["The button uses green classes."],
      requestedChanges: [],
    },
    "EPIC-654",
    "atlas/epic-654",
    ["https://github.com/example/repo/pull/572"],
  );

  assert.equal(errors.length, 3);
  assert.match(errors[0] ?? "", /expected EPIC-654/);
  assert.match(errors[1] ?? "", /expected atlas\/epic-654/);
  assert.match(errors[2] ?? "", /pull\/572/);
});

test("buildScoutReviewLinearComment renders deterministic review output", () => {
  const comment = buildScoutReviewLinearComment({
    decision: "approved",
    summary: "The login button uses the black variant with white text.",
    reviewedTicket: "EPIC-654",
    reviewedBranch: "atlas/epic-654",
    reviewedPullRequestUrl: "https://github.com/example/repo/pull/572",
    reviewedFiles: ["src/routes/login.tsx", "src/components/button/AppButton.tsx"],
    evidence: ["The login button passes variant=\"black\".", "The black variant maps to bg-black text-white."],
    requestedChanges: [],
  });

  assert.match(comment, /PR #572 reviewed and approved for merge/);
  assert.match(comment, /Ticket: EPIC-654/);
  assert.match(comment, /Reviewed files: src\/routes\/login\.tsx, src\/components\/button\/AppButton\.tsx/);
  assert.match(comment, /\^Scout$/);
});

test("validateScoutRoutingDecision rejects missing routing fields", () => {
  const errors = validateScoutRoutingDecision({
    route: "fullstack",
    reason: "",
    implementationPrompt: "",
    acceptanceCriteria: [],
    riskNotes: [],
  });

  assert.deepEqual(errors, [
    "Scout routing must include a routing reason.",
    "Scout routing must include an implementation prompt.",
  ]);
});

test("validateScoutDeliveryDecision rejects stale branch and missing evidence", () => {
  const errors = validateScoutDeliveryDecision(
    {
      status: "delivery_required",
      reviewedTicket: "EPIC-655",
      reviewedBranch: "atlas/epic-654",
      reviewedPullRequestUrl: "",
      summary: "Need the PR URL.",
      evidence: [],
      deliveryInstructions: "",
    },
    "EPIC-655",
    "atlas/epic-655",
  );

  assert.equal(errors.length, 3);
  assert.match(errors[0] ?? "", /atlas\/epic-655/);
  assert.match(errors[1] ?? "", /verification fact/);
  assert.match(errors[2] ?? "", /delivery instructions/);
});

test("buildScoutDeliveryPrompt asks Scout to resolve the canonical PR", () => {
  const prompt = buildScoutDeliveryPrompt(
    "Ticket: EPIC-655",
    "Atlas",
    "full stack",
    {
      status: "code_complete",
      summary: "Code is complete but PR URL still needs confirmation.",
      branch: "atlas/epic-655",
      pullRequestUrl: "",
      reviewPrompt: "Verify the login button uses purple.",
      blockingReason: "",
    },
    "atlas/epic-655",
    [],
  );

  assert.match(prompt, /Resolve the canonical pull request/);
  assert.match(prompt, /return delivery_required/);
  assert.match(prompt, /Expected branch: atlas\/epic-655/);
});

test("buildFallbackScoutRoutingDecision derives a usable fullstack routing response", () => {
  const decision = buildFallbackScoutRoutingDecision(
    [
      "Workflow correction: Scout routing.",
      "Route the task to either Orbit (iOS) or Atlas (fullstack).",
      "Hermes intake summary: Update the login page button to use a standard Tailwind purple background class with white text, preserving existing behavior.",
    ].join("\n"),
    [
      "Ticket: EPIC-655",
      "Title: Change the login button to purple",
      "Description:",
      "Use Tailwind purple styling on the login page button.",
    ].join("\n"),
    {
      route: "fullstack",
      acceptanceCriteria: ["Login button is purple"],
      riskNotes: ["Keep hover states intact"],
    },
  );

  assert.equal(decision.route, "fullstack");
  assert.match(decision.reason, /Fallback routing derived from workflow context/);
  assert.match(decision.implementationPrompt, /^Implement this ticket:/);
  assert.match(decision.implementationPrompt, /Tailwind purple background class/);
  assert.deepEqual(decision.acceptanceCriteria, ["Login button is purple"]);
  assert.deepEqual(decision.riskNotes, ["Keep hover states intact"]);
});

test("buildFallbackScoutRoutingDecision does not infer ios from static prompt text alone", () => {
  const decision = buildFallbackScoutRoutingDecision(
    [
      "Workflow correction: Scout routing.",
      "Route the task to either Orbit (iOS) or Atlas (fullstack).",
      "Choose ios only when the issue is clearly iOS/native/mobile focused. Otherwise choose fullstack.",
    ].join("\n"),
    [
      "Ticket: EPIC-655",
      "Title: Change login button color to be purple",
      "Description:",
      "Update the web login page button styling with Tailwind purple classes.",
    ].join("\n"),
  );

  assert.equal(decision.route, "fullstack");
  assert.notEqual(decision.implementationPrompt, "");
});

test("buildArtifactBackedScoutDeliveryDecision returns review_ready when PR is already known", () => {
  const decision = buildArtifactBackedScoutDeliveryDecision(
    "EPIC-655",
    "atlas/epic-655",
    {
      status: "delivery_complete",
      summary: "Verified the EPIC-655 changes and confirmed PR #573.",
      branch: "atlas/epic-655",
      pullRequestUrl: "https://github.com/example/repo/pull/573",
      reviewPrompt: "Review the login button change.",
      blockingReason: "",
    },
    [],
  );

  assert.equal(decision.status, "review_ready");
  assert.equal(decision.reviewedTicket, "EPIC-655");
  assert.equal(decision.reviewedBranch, "atlas/epic-655");
  assert.equal(decision.reviewedPullRequestUrl, "https://github.com/example/repo/pull/573");
  assert.match(decision.evidence[0] ?? "", /Branch resolved/);
});

test("buildArtifactBackedScoutDeliveryDecision returns delivery_required when PR is missing", () => {
  const decision = buildArtifactBackedScoutDeliveryDecision(
    "EPIC-655",
    "atlas/epic-655",
    {
      status: "code_complete",
      summary: "Code is complete but PR still needs to be confirmed.",
      branch: "atlas/epic-655",
      pullRequestUrl: "",
      reviewPrompt: "Review the login button change.",
      blockingReason: "",
    },
    [],
  );

  assert.equal(decision.status, "delivery_required");
  assert.equal(decision.reviewedTicket, "EPIC-655");
  assert.equal(decision.reviewedBranch, "atlas/epic-655");
  assert.equal(decision.reviewedPullRequestUrl, "");
  assert.match(decision.deliveryInstructions ?? "", /single PR for branch atlas\/epic-655/);
  assert.ok(decision.evidence.length > 0);
});

test("buildArtifactBackedScoutReviewDecision returns a valid fallback review from worker artifacts", () => {
  const review = buildArtifactBackedScoutReviewDecision(
    "EPIC-655",
    "atlas/epic-655",
    {
      status: "delivery_complete",
      summary: "The login page submit button now uses the AppButton purple variant with white text on src/routes/login.tsx. Added purple variant coverage in src/components/button/AppButton.spec.tsx and login-page styling coverage in src/routes/login.spec.tsx. Ran corepack pnpm vitest run src/routes/login.spec.tsx src/components/button/AppButton.spec.tsx and all 3 tests passed.",
      branch: "atlas/epic-655",
      pullRequestUrl: "https://github.com/example/repo/pull/575",
      reviewPrompt: "Verify the login button styling and test coverage.",
      blockingReason: "",
    },
    ["https://github.com/example/repo/pull/575"],
    "Ticket: EPIC-655\nTitle: Change login button color to be purple",
    {
      decision: "approved",
      summary: "",
      reviewedTicket: "",
      reviewedBranch: "",
      reviewedPullRequestUrl: "",
      reviewedFiles: [],
      evidence: [],
      requestedChanges: [],
    },
  );

  assert.equal(review.decision, "approved");
  assert.equal(review.reviewedTicket, "EPIC-655");
  assert.equal(review.reviewedBranch, "atlas/epic-655");
  assert.equal(review.reviewedPullRequestUrl, "https://github.com/example/repo/pull/575");
  assert.deepEqual(review.reviewedFiles, [
    "src/routes/login.tsx",
    "src/components/button/AppButton.spec.tsx",
    "src/routes/login.spec.tsx",
  ]);
  assert.ok(review.evidence.length > 0);
});
