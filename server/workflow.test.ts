import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

const ENGINEER = { agentId: "harry", name: "Harry", role: "engineer" as const };
const REVIEWER = { agentId: "zoe", name: "Zoe", role: "reviewer" as const };
const QA = { agentId: "pickle", name: "Pickle", role: "qa" as const };
const OBSERVER = { agentId: "observer-1", name: "Observer", role: "observer" as const };

let originalCwd = process.cwd();
let tempDir = "";
let workflowModule: typeof import("./workflow");

function buildWorkflowItem(
  overrides: Partial<Parameters<typeof workflowModule.createWorkflowItem>[0]> = {},
): Parameters<typeof workflowModule.createWorkflowItem>[0] {
  return {
    id: "wf-1",
    sprintId: "current",
    title: "Wire up merge blockers",
    linear: {
      issueId: "linear-1",
      issueKey: "OFF-1",
    },
    actor: ENGINEER,
    ...overrides,
  };
}

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return typeof error === "object"
    && error !== null
    && "statusCode" in error
    && typeof (error as { statusCode?: unknown }).statusCode === "number"
    && (error as { statusCode: number }).statusCode === statusCode;
}

before(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "the-office-workflow-"));
  process.chdir(tempDir);
  workflowModule = await import("./workflow");
});

beforeEach(async () => {
  workflowModule.resetWorkflowStateForTests();
  await rm(path.join(tempDir, "data"), { recursive: true, force: true });
});

after(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

test("rejects workflow mutations outside the current sprint", async () => {
  await assert.rejects(
    workflowModule.createWorkflowItem(buildWorkflowItem({ sprintId: "next-sprint" })),
    (error) => hasStatusCode(error, 409),
  );

  await workflowModule.createWorkflowItem(buildWorkflowItem());

  await assert.rejects(
    workflowModule.updateWorkflowItem("wf-1", {
      sprintId: "next-sprint",
      actor: ENGINEER,
    }),
    (error) => hasStatusCode(error, 409),
  );
});

test("rejects direct Linear comments from observer roles", async () => {
  await workflowModule.createWorkflowItem(buildWorkflowItem());

  await assert.rejects(
    workflowModule.createWorkflowComment("wf-1", {
      actor: OBSERVER,
      target: "linear",
      body: "Pinging Linear from a read-only observer.",
    }),
    (error) => hasStatusCode(error, 403),
  );

  const { comment } = await workflowModule.createWorkflowComment("wf-1", {
    actor: REVIEWER,
    target: "linear",
    body: "Reviewer note is allowed.",
  });

  assert.equal(comment.target, "linear");
  assert.equal(comment.actor.agentId, REVIEWER.agentId);
});

test("queues QA automatically when work enters QA or merged-ready", async () => {
  const created = await workflowModule.createWorkflowItem(buildWorkflowItem());
  assert.equal(created.qaTrigger, undefined);

  const movedToQa = await workflowModule.updateWorkflowItem("wf-1", {
    actor: REVIEWER,
    status: "qa",
  });

  assert.ok(movedToQa.qaTrigger);
  assert.equal(movedToQa.item.qa.status, "queued");
  assert.equal(movedToQa.item.qa.lastTriggeredBy?.agentId, REVIEWER.agentId);
  assert.equal(workflowModule.listWorkflowQaTriggers("wf-1").length, 1);

  const mergedReady = await workflowModule.createWorkflowItem(buildWorkflowItem({
    id: "wf-2",
    linear: {
      issueId: "linear-2",
      issueKey: "OFF-2",
    },
    status: "merged_ready",
    github: {
      branch: "zoe/workflow-pipeline-architecture",
      pullRequestNumber: 27,
    },
    actor: QA,
  }));

  assert.ok(mergedReady.qaTrigger);
  assert.equal(mergedReady.item.qa.status, "queued");
  assert.equal(workflowModule.listWorkflowQaTriggers("wf-2").length, 1);
});

test("transfers ownership when a handoff is accepted", async () => {
  await workflowModule.createWorkflowItem(buildWorkflowItem({
    ownership: {
      ownerAgentId: ENGINEER.agentId,
      reviewerAgentId: REVIEWER.agentId,
    },
  }));

  const { handoff } = await workflowModule.createWorkflowHandoff("wf-1", {
    from: ENGINEER,
    to: REVIEWER,
    summary: "Review workflow state transitions.",
    checklist: ["Check QA trigger behavior", "Confirm current sprint guard"],
  });

  const response = await workflowModule.respondToWorkflowHandoff(handoff.id, {
    actor: REVIEWER,
    status: "accepted",
  });

  assert.equal(response.handoff.status, "accepted");
  assert.equal(response.item?.ownership.ownerAgentId, REVIEWER.agentId);
  assert.equal(workflowModule.workflowItems.get("wf-1")?.ownership.ownerAgentId, REVIEWER.agentId);
});
