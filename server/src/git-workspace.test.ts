import assert from "node:assert/strict";
import { test } from "node:test";
import { formatIssueKey, makeBranchName } from "./git-workspace.js";

test("formatIssueKey uses configured prefix and zero-padded issue number", () => {
  assert.equal(formatIssueKey(1, "EPIC", "939827d2-844a-43c6-8a57-70fc126c3b8d"), "EPIC-001");
  assert.equal(formatIssueKey(27, "off ice", "939827d2-844a-43c6-8a57-70fc126c3b8d"), "OFFICE-027");
});

test("formatIssueKey falls back to a short uppercase id when issue number is missing", () => {
  assert.equal(formatIssueKey(null, "EPIC", "939827d2-844a-43c6-8a57-70fc126c3b8d"), "939827D2");
});

test("makeBranchName includes agent name, issue key, and slugged title", () => {
  assert.equal(makeBranchName("Claudy", "EPIC-001", "Update image source"), "claudy/EPIC-001/update-image-source");
});
