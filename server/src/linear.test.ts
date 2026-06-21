import assert from "node:assert/strict";
import { test } from "node:test";
import { getDb } from "./db.js";
import { normalizeLinearIssuePriority, normalizeLinearIssueStatus, syncLinearIssueToLocal } from "./linear.js";

test("normalizeLinearIssueStatus maps Linear state names to app statuses", () => {
  assert.equal(normalizeLinearIssueStatus("Todo"), "todo");
  assert.equal(normalizeLinearIssueStatus("To Do"), "todo");
  assert.equal(normalizeLinearIssueStatus("In Progress"), "in_progress");
  assert.equal(normalizeLinearIssueStatus("In Review"), "in_review");
  assert.equal(normalizeLinearIssueStatus("Done"), "done");
  assert.equal(normalizeLinearIssueStatus("Canceled"), "backlog");
});

test("normalizeLinearIssuePriority keeps supported priorities only", () => {
  assert.equal(normalizeLinearIssuePriority("High"), "high");
  assert.equal(normalizeLinearIssuePriority("No priority"), "medium");
});

test("syncLinearIssueToLocal stores normalized imported issue values", async () => {
  const db = getDb();
  db.prepare("DELETE FROM issues WHERE linear_id = 'linear-normalized-test'").run();

  try {
    await syncLinearIssueToLocal({
      id: "linear-normalized-test",
      title: `  ${"a".repeat(200)}  `,
      description: "b".repeat(10_500),
      status: "In Progress",
      priority: "High",
      labels: [{ name: "c".repeat(80) }, { name: "finance" }],
    });

    const issue = db.prepare("SELECT title, description, status, priority, labels FROM issues WHERE linear_id = 'linear-normalized-test'").get() as
      | { title: string; description: string; status: string; priority: string; labels: string }
      | undefined;
    assert.deepEqual(issue, {
      title: "a".repeat(180),
      description: "b".repeat(10_000),
      status: "in_progress",
      priority: "high",
      labels: JSON.stringify(["c".repeat(60), "finance"]),
    });
  } finally {
    db.prepare("DELETE FROM issues WHERE linear_id = 'linear-normalized-test'").run();
  }
});
