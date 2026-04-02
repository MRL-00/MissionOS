import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaskContext, preferredThreadReplyCommentId } from "./mission-workflow";

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
