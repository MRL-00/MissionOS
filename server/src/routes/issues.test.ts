import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { getDb } from "../db.js";
import {
  deleteIssueCommentForIssue,
  formatIssueSyncError,
  parseCommentPayload,
  parseIssueListQuery,
  parseIssuePayload,
  validateIssueReferences,
  registerIssueRoutes,
} from "./issues.js";

async function requestIssueComments(issueId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerIssueRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const port = (address as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/issues/${encodeURIComponent(issueId)}/comments`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestDeleteIssue(issueId: string): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerIssueRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const port = (address as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/issues/${encodeURIComponent(issueId)}`, {
      method: "DELETE",
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestCreateIssue(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerIssueRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const port = (address as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestUpdateIssue(issueId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.use(express.json());
  registerIssueRoutes(app);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const port = (address as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/issues/${encodeURIComponent(issueId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("parseIssuePayload trims fields and filters labels", () => {
  const result = parseIssuePayload({
    title: "  Close Q4 books  ",
    description: "  Reconcile revenue  ",
    status: "in_progress",
    priority: "high",
    source: "native",
    labels: ["finance", 42, " close ", ""],
    assignee_agent_id: "  agent-1  ",
    mission_id: "  mission-1  ",
    estimation: "  5  ",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.title, "Close Q4 books");
    assert.equal(result.payload.description, "Reconcile revenue");
    assert.equal(result.payload.status, "in_progress");
    assert.equal(result.payload.priority, "high");
    assert.deepEqual(result.payload.labels, ["finance", "close"]);
    assert.equal(result.payload.assigneeAgentId, "agent-1");
    assert.equal(result.payload.missionId, "mission-1");
    assert.equal(result.payload.estimation, "5");
  }
});

test("parseIssuePayload applies safe defaults", () => {
  const result = parseIssuePayload({ title: "Launch campaign" });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.status, "backlog");
    assert.equal(result.payload.priority, "medium");
    assert.equal(result.payload.source, "native");
    assert.deepEqual(result.payload.labels, []);
  }
});

test("parseIssuePayload rejects blank titles", () => {
  assert.deepEqual(parseIssuePayload({ title: " " }), {
    ok: false,
    error: "Issue title is required.",
  });
});

test("parseIssuePayload rejects invalid statuses", () => {
  assert.deepEqual(parseIssuePayload({ title: "Task", status: "blocked" }), {
    ok: false,
    error: "Issue status must be backlog, todo, in_progress, in_review, or done.",
  });
});

test("parseIssuePayload rejects invalid priorities", () => {
  assert.deepEqual(parseIssuePayload({ title: "Task", priority: "critical" }), {
    ok: false,
    error: "Issue priority must be urgent, high, medium, or low.",
  });
});

test("parseIssuePayload rejects invalid sources", () => {
  assert.deepEqual(parseIssuePayload({ title: "Task", source: "jira" }), {
    ok: false,
    error: "Issue source must be native, linear, or github.",
  });
});

test("parseIssuePayload rejects oversized issue fields", () => {
  assert.deepEqual(parseIssuePayload({ title: "a".repeat(181) }), {
    ok: false,
    error: "Issue title must be 180 characters or fewer.",
  });
  assert.deepEqual(parseIssuePayload({ title: "Task", description: "a".repeat(10_001) }), {
    ok: false,
    error: "Issue description must be 10000 characters or fewer.",
  });
  assert.deepEqual(parseIssuePayload({ title: "Task", estimation: "a".repeat(41) }), {
    ok: false,
    error: "Issue estimation must be 40 characters or fewer.",
  });
  assert.deepEqual(parseIssuePayload({ title: "Task", labels: Array.from({ length: 21 }, (_, index) => `label-${index}`) }), {
    ok: false,
    error: "Issue labels must include 20 or fewer entries.",
  });
  assert.deepEqual(parseIssuePayload({ title: "Task", labels: ["a".repeat(61)] }), {
    ok: false,
    error: "Issue labels must be 60 characters or fewer.",
  });
});

test("parseIssueListQuery trims and limits issue filters", () => {
  assert.deepEqual(
    parseIssueListQuery({
      status: "  in_progress  ",
      priority: "  high  ",
      assignee: "  agent-1  ",
      mission_id: "m".repeat(150),
      q: "launch",
    }),
    {
      status: "in_progress",
      priority: "high",
      assignee: "agent-1",
      missionId: "m".repeat(120),
      q: "launch",
    },
  );
});

test("parseIssueListQuery ignores unsupported status and priority filters", () => {
  assert.equal(parseIssueListQuery({ status: "blocked" }).status, undefined);
  assert.equal(parseIssueListQuery({ priority: "critical" }).priority, undefined);
});

test("validateIssueReferences rejects unknown assignees", () => {
  assert.deepEqual(
    validateIssueReferences({
      assigneeAgentId: "agent-1",
      missionId: null,
      assigneeExists: false,
      missionExists: false,
    }),
    { ok: false, status: 404, error: "Assignee agent not found." },
  );
});

test("validateIssueReferences rejects inactive or unsupported assignees", () => {
  assert.deepEqual(
    validateIssueReferences({
      assigneeAgentId: "agent-1",
      missionId: null,
      assigneeExists: true,
      assigneeActive: false,
      assigneeEngineSupported: true,
      missionExists: false,
    }),
    { ok: false, status: 409, error: "Assignee agent is inactive." },
  );
  assert.deepEqual(
    validateIssueReferences({
      assigneeAgentId: "agent-1",
      missionId: null,
      assigneeExists: true,
      assigneeActive: true,
      assigneeEngineSupported: false,
      missionExists: false,
    }),
    { ok: false, status: 409, error: "Assignee agent engine is not supported." },
  );
});

test("validateIssueReferences rejects unknown missions", () => {
  assert.deepEqual(
    validateIssueReferences({
      assigneeAgentId: null,
      missionId: "mission-1",
      assigneeExists: false,
      missionExists: false,
    }),
    { ok: false, status: 404, error: "Mission not found." },
  );
});

test("validateIssueReferences rejects mission assignees that are not staffed on the mission", () => {
  assert.deepEqual(
    validateIssueReferences({
      assigneeAgentId: "agent-1",
      missionId: "mission-1",
      assigneeExists: true,
      assigneeActive: true,
      assigneeEngineSupported: true,
      assigneeAssignedToMission: false,
      missionExists: true,
    }),
    { ok: false, status: 409, error: "Assignee agent is not assigned to this mission." },
  );
});

test("validateIssueReferences accepts empty or known references", () => {
  assert.deepEqual(
    validateIssueReferences({
      assigneeAgentId: null,
      missionId: null,
      assigneeExists: false,
      missionExists: false,
    }),
    { ok: true },
  );
  assert.deepEqual(
    validateIssueReferences({
      assigneeAgentId: "agent-1",
      missionId: "mission-1",
      assigneeExists: true,
      assigneeActive: true,
      assigneeEngineSupported: true,
      assigneeAssignedToMission: true,
      missionExists: true,
    }),
    { ok: true },
  );
});

test("issue creation rejects inactive assignees", async () => {
  const db = getDb();
  db.prepare("DELETE FROM issues WHERE title = 'Inactive assignee issue'").run();
  db.prepare("DELETE FROM agents WHERE id = 'issue-inactive-assignee-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, active)
    VALUES ('issue-inactive-assignee-test', 'Inactive assignee', NULL, 'codex', 0)
    `,
  ).run();

  try {
    const response = await requestCreateIssue({
      title: "Inactive assignee issue",
      assignee_agent_id: "issue-inactive-assignee-test",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Assignee agent is inactive." });
    assert.equal(db.prepare("SELECT 1 FROM issues WHERE title = 'Inactive assignee issue'").get(), undefined);
  } finally {
    db.prepare("DELETE FROM issues WHERE title = 'Inactive assignee issue'").run();
    db.prepare("DELETE FROM agents WHERE id = 'issue-inactive-assignee-test'").run();
  }
});

test("issue updates reject unsupported assignee engines", async () => {
  const db = getDb();
  db.prepare("DELETE FROM issues WHERE id = 'issue-unsupported-assignee-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'issue-unsupported-assignee-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, active)
    VALUES ('issue-unsupported-assignee-agent-test', 'Unsupported assignee', NULL, 'legacy-engine', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO issues (id, issue_number, title, status, priority, labels)
    VALUES ('issue-unsupported-assignee-test', 92001, 'Unsupported assignee issue', 'todo', 'medium', '[]')
    `,
  ).run();

  try {
    const response = await requestUpdateIssue("issue-unsupported-assignee-test", {
      title: "Unsupported assignee issue",
      status: "todo",
      priority: "medium",
      assignee_agent_id: "issue-unsupported-assignee-agent-test",
      labels: [],
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Assignee agent engine is not supported." });
    assert.deepEqual(db.prepare("SELECT assignee_agent_id FROM issues WHERE id = 'issue-unsupported-assignee-test'").get(), {
      assignee_agent_id: null,
    });
  } finally {
    db.prepare("DELETE FROM issues WHERE id = 'issue-unsupported-assignee-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'issue-unsupported-assignee-agent-test'").run();
  }
});

test("issue creation rejects assignees outside the issue mission", async () => {
  const db = getDb();
  db.prepare("DELETE FROM issues WHERE title = 'Unstaffed assignee issue'").run();
  db.prepare("DELETE FROM mission_agents WHERE mission_id = 'issue-unstaffed-mission-test'").run();
  db.prepare("DELETE FROM missions WHERE id = 'issue-unstaffed-mission-test'").run();
  db.prepare("DELETE FROM agents WHERE id = 'issue-unstaffed-agent-test'").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine, active)
    VALUES ('issue-unstaffed-agent-test', 'Unstaffed assignee', NULL, 'codex', 1)
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES ('issue-unstaffed-mission-test', 'Issue assignee mission', 'active', 'Finance')
    `,
  ).run();

  try {
    const response = await requestCreateIssue({
      title: "Unstaffed assignee issue",
      mission_id: "issue-unstaffed-mission-test",
      assignee_agent_id: "issue-unstaffed-agent-test",
    });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "Assignee agent is not assigned to this mission." });
    assert.equal(db.prepare("SELECT 1 FROM issues WHERE title = 'Unstaffed assignee issue'").get(), undefined);
  } finally {
    db.prepare("DELETE FROM issues WHERE title = 'Unstaffed assignee issue'").run();
    db.prepare("DELETE FROM mission_agents WHERE mission_id = 'issue-unstaffed-mission-test'").run();
    db.prepare("DELETE FROM missions WHERE id = 'issue-unstaffed-mission-test'").run();
    db.prepare("DELETE FROM agents WHERE id = 'issue-unstaffed-agent-test'").run();
  }
});

test("issue mission updates propagate to linked runs and run messages", async () => {
  const db = getDb();
  db.prepare("DELETE FROM agent_messages WHERE run_id = 'issue-move-run-test'").run();
  db.prepare("DELETE FROM runs WHERE id = 'issue-move-run-test'").run();
  db.prepare("DELETE FROM issues WHERE id = 'issue-move-test'").run();
  db.prepare("DELETE FROM missions WHERE id IN ('issue-move-from-mission-test', 'issue-move-to-mission-test')").run();
  db.prepare("DELETE FROM agents WHERE id IN ('issue-move-sender-test', 'issue-move-recipient-test')").run();
  db.prepare(
    `
    INSERT INTO agents (id, name, role, engine)
    VALUES
      ('issue-move-sender-test', 'Sender', 'Coordinator', 'codex'),
      ('issue-move-recipient-test', 'Recipient', 'Specialist', 'codex')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO missions (id, title, status, team_name)
    VALUES
      ('issue-move-from-mission-test', 'Source mission', 'planning', 'Engineering'),
      ('issue-move-to-mission-test', 'Target mission', 'planning', 'Marketing')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO issues (id, issue_number, title, status, priority, mission_id, labels)
    VALUES ('issue-move-test', 90006, 'Move issue test', 'backlog', 'medium', 'issue-move-from-mission-test', '[]')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, engine, status, prompt, output, tool_calls)
    VALUES ('issue-move-run-test', 'issue-move-sender-test', 'issue-move-from-mission-test', 'issue-move-test', 'codex', 'complete', 'Do work', '', '[]')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
    VALUES ('issue-move-message-test', 'issue-move-sender-test', 'issue-move-recipient-test', 'issue-move-from-mission-test', 'issue-move-run-test', 'Review')
    `,
  ).run();

  try {
    const response = await requestUpdateIssue("issue-move-test", {
      title: "Move issue test",
      status: "backlog",
      priority: "medium",
      mission_id: "issue-move-to-mission-test",
      labels: [],
    });

    assert.equal(response.status, 200);
    const run = db.prepare("SELECT mission_id FROM runs WHERE id = 'issue-move-run-test'").get() as { mission_id: string | null };
    assert.deepEqual(run, { mission_id: "issue-move-to-mission-test" });
    const message = db.prepare("SELECT mission_id FROM agent_messages WHERE id = 'issue-move-message-test'").get() as {
      mission_id: string | null;
    };
    assert.deepEqual(message, { mission_id: "issue-move-to-mission-test" });
  } finally {
    db.prepare("DELETE FROM agent_messages WHERE run_id = 'issue-move-run-test'").run();
    db.prepare("DELETE FROM runs WHERE id = 'issue-move-run-test'").run();
    db.prepare("DELETE FROM issues WHERE id = 'issue-move-test'").run();
    db.prepare("DELETE FROM missions WHERE id IN ('issue-move-from-mission-test', 'issue-move-to-mission-test')").run();
    db.prepare("DELETE FROM agents WHERE id IN ('issue-move-sender-test', 'issue-move-recipient-test')").run();
  }
});

test("parseCommentPayload trims comment bodies and parent ids", () => {
  assert.deepEqual(parseCommentPayload({ body: "  Looks good  ", parentId: "  comment-1  " }), {
    ok: true,
    payload: {
      body: "Looks good",
      parentId: "comment-1",
    },
  });
});

test("parseCommentPayload rejects blank comment bodies", () => {
  assert.deepEqual(parseCommentPayload({ body: "   " }), {
    ok: false,
    error: "Comment body is required.",
  });
});

test("parseCommentPayload rejects oversized comment bodies", () => {
  assert.deepEqual(parseCommentPayload({ body: "a".repeat(10_001) }), {
    ok: false,
    error: "Comment body must be 10000 characters or fewer.",
  });
});

test("formatIssueSyncError preserves provider messages and falls back for unknown errors", () => {
  assert.equal(formatIssueSyncError(new Error("Linear API key is missing.")), "Linear API key is missing.");
  assert.equal(formatIssueSyncError("failed"), "Sync failed.");
  assert.equal(formatIssueSyncError(null, "Linear sync failed."), "Linear sync failed.");
});

test("deleteIssueCommentForIssue clears child reply links before deleting parent comments", () => {
  const db = getDb();
  db.prepare("DELETE FROM issue_comments WHERE issue_id IN ('issue-comment-delete-test', 'issue-comment-cross-child-test')").run();
  db.prepare("DELETE FROM issues WHERE id = 'issue-comment-cross-child-test'").run();
  db.prepare("DELETE FROM issues WHERE id = 'issue-comment-delete-test'").run();
  db.prepare(
    `
    INSERT INTO issues (id, issue_number, title, status, priority, labels)
    VALUES ('issue-comment-delete-test', 90001, 'Comment delete test', 'backlog', 'medium', '[]')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO issues (id, issue_number, title, status, priority, labels)
    VALUES ('issue-comment-cross-child-test', 90003, 'Cross issue child test', 'backlog', 'medium', '[]')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO issue_comments (id, issue_id, parent_id, author_type, body)
    VALUES
      ('comment-parent-delete-test', 'issue-comment-delete-test', NULL, 'user', 'Parent'),
      ('comment-child-delete-test', 'issue-comment-delete-test', 'comment-parent-delete-test', 'user', 'Child'),
      ('comment-cross-child-delete-test', 'issue-comment-cross-child-test', 'comment-parent-delete-test', 'user', 'Cross child')
    `,
  ).run();

  try {
    assert.equal(deleteIssueCommentForIssue("issue-comment-delete-test", "comment-parent-delete-test"), 1);
    const child = db.prepare("SELECT parent_id FROM issue_comments WHERE id = 'comment-child-delete-test'").get() as
      | { parent_id: string | null }
      | undefined;
    assert.deepEqual(child, { parent_id: null });
    const crossChild = db.prepare("SELECT parent_id FROM issue_comments WHERE id = 'comment-cross-child-delete-test'").get() as
      | { parent_id: string | null }
      | undefined;
    assert.deepEqual(crossChild, { parent_id: null });
    assert.equal(deleteIssueCommentForIssue("issue-comment-delete-test", "comment-parent-delete-test"), 0);
  } finally {
    db.prepare("DELETE FROM issue_comments WHERE issue_id IN ('issue-comment-delete-test', 'issue-comment-cross-child-test')").run();
    db.prepare("DELETE FROM issues WHERE id = 'issue-comment-cross-child-test'").run();
    db.prepare("DELETE FROM issues WHERE id = 'issue-comment-delete-test'").run();
  }
});

test("issue deletion detaches cross-issue replies before deleting comments", async () => {
  const db = getDb();
  db.prepare("DELETE FROM issue_comments WHERE issue_id IN ('issue-delete-parent-test', 'issue-delete-child-test')").run();
  db.prepare("DELETE FROM issues WHERE id IN ('issue-delete-parent-test', 'issue-delete-child-test')").run();
  db.prepare(
    `
    INSERT INTO issues (id, issue_number, title, status, priority, labels)
    VALUES
      ('issue-delete-parent-test', 90004, 'Delete parent issue test', 'backlog', 'medium', '[]'),
      ('issue-delete-child-test', 90005, 'Delete child issue test', 'backlog', 'medium', '[]')
    `,
  ).run();
  db.prepare(
    `
    INSERT INTO issue_comments (id, issue_id, parent_id, author_type, body)
    VALUES
      ('issue-delete-parent-comment-test', 'issue-delete-parent-test', NULL, 'user', 'Parent'),
      ('issue-delete-cross-child-comment-test', 'issue-delete-child-test', 'issue-delete-parent-comment-test', 'user', 'Cross child')
    `,
  ).run();

  try {
    const response = await requestDeleteIssue("issue-delete-parent-test");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
    const child = db.prepare("SELECT parent_id FROM issue_comments WHERE id = 'issue-delete-cross-child-comment-test'").get() as
      | { parent_id: string | null }
      | undefined;
    assert.deepEqual(child, { parent_id: null });
  } finally {
    db.prepare("DELETE FROM issue_comments WHERE issue_id IN ('issue-delete-parent-test', 'issue-delete-child-test')").run();
    db.prepare("DELETE FROM issues WHERE id IN ('issue-delete-parent-test', 'issue-delete-child-test')").run();
  }
});

test("issue comment list returns 404 for missing parent issues", async () => {
  const response = await requestIssueComments("missing-issue-comments-test");

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "Issue not found." });
});

test("issue comment list returns an empty list for existing issues with no comments", async () => {
  const db = getDb();
  db.prepare("DELETE FROM issues WHERE id = 'issue-comments-empty-test'").run();
  db.prepare(
    `
    INSERT INTO issues (id, issue_number, title, status, priority, labels)
    VALUES ('issue-comments-empty-test', 90002, 'Empty comments test', 'backlog', 'medium', '[]')
    `,
  ).run();

  try {
    const response = await requestIssueComments("issue-comments-empty-test");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { comments: [] });
  } finally {
    db.prepare("DELETE FROM issues WHERE id = 'issue-comments-empty-test'").run();
  }
});
