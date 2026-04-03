import assert from "node:assert/strict";
import { test } from "node:test";
import type { MissionTaskDetail } from "../src/mission/types";
import { syncWorkerArtifactsForReview } from "./mission-task-workflow";

function buildDetail(pullRequestUrls?: string[]): MissionTaskDetail {
  return {
    task: {
      id: "task-1",
      identifier: "EPIC-653",
      title: "Change login button to be RED",
      gitBranchName: "atlas/epic-653",
      pullRequestUrls,
      priority: 0,
      state: { name: "Dev Review" },
      team: { name: "EpicShot" },
      labels: [],
      createdAt: 0,
      updatedAt: 0,
      handoffCount: 0,
      commentCount: 0,
    },
    comments: [],
    handoffs: [],
  };
}

test("syncWorkerArtifactsForReview waits for a PR to appear on the task", async () => {
  const details = [
    buildDetail(),
    buildDetail(["https://github.com/AJ-Hackett-Bungy/epiczone-web/pull/571"]),
  ];
  let callCount = 0;

  const result = await syncWorkerArtifactsForReview(
    "task-1",
    async () => {
      const detail = details[Math.min(callCount, details.length - 1)]!;
      callCount += 1;
      return detail;
    },
    {
      branch: "atlas/epic-653",
      pullRequestUrls: [],
    },
    {
      maxAttempts: 1,
      delayMs: 0,
    },
  );

  assert.equal(callCount, 2);
  assert.equal(result.executionContext.branch, "atlas/epic-653");
  assert.deepEqual(result.executionContext.pullRequestUrls, [
    "https://github.com/AJ-Hackett-Bungy/epiczone-web/pull/571",
  ]);
});

test("syncWorkerArtifactsForReview preserves known PRs without waiting", async () => {
  let callCount = 0;

  const result = await syncWorkerArtifactsForReview(
    "task-1",
    async () => {
      callCount += 1;
      return buildDetail();
    },
    {
      branch: "atlas/epic-653",
      pullRequestUrls: ["https://github.com/AJ-Hackett-Bungy/epiczone-web/pull/571"],
    },
    {
      maxAttempts: 3,
      delayMs: 0,
    },
  );

  assert.equal(callCount, 1);
  assert.deepEqual(result.executionContext.pullRequestUrls, [
    "https://github.com/AJ-Hackett-Bungy/epiczone-web/pull/571",
  ]);
});

test("syncWorkerArtifactsForReview resolves a PR directly from the branch when task metadata is stale", async () => {
  let detailCallCount = 0;
  let resolveCallCount = 0;

  const result = await syncWorkerArtifactsForReview(
    "task-1",
    async () => {
      detailCallCount += 1;
      return buildDetail();
    },
    {
      branch: "atlas/epic-653",
      pullRequestUrls: [],
    },
    {
      maxAttempts: 0,
      delayMs: 0,
      resolveCanonicalPullRequestUrl: async (branchName) => {
        resolveCallCount += 1;
        assert.equal(branchName, "atlas/epic-653");
        return "https://github.com/AJ-Hackett-Bungy/epiczone-web/pull/571";
      },
    },
  );

  assert.equal(detailCallCount, 1);
  assert.equal(resolveCallCount, 1);
  assert.deepEqual(result.executionContext.pullRequestUrls, [
    "https://github.com/AJ-Hackett-Bungy/epiczone-web/pull/571",
  ]);
});
