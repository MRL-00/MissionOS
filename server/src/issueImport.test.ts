import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeImportedIssueDescription,
  normalizeImportedIssueLabels,
  normalizeImportedIssueTitle,
} from "./issueImport.js";

test("normalizeImportedIssueTitle trims, defaults, and caps imported titles", () => {
  assert.equal(normalizeImportedIssueTitle("  External task  "), "External task");
  assert.equal(normalizeImportedIssueTitle("   "), "Untitled");
  assert.equal(normalizeImportedIssueTitle("a".repeat(200)), "a".repeat(180));
});

test("normalizeImportedIssueDescription trims blanks to null and caps imported descriptions", () => {
  assert.equal(normalizeImportedIssueDescription("  Details  "), "Details");
  assert.equal(normalizeImportedIssueDescription("   "), null);
  assert.equal(normalizeImportedIssueDescription("a".repeat(10_500)), "a".repeat(10_000));
});

test("normalizeImportedIssueLabels accepts provider label shapes and applies app bounds", () => {
  const labels = normalizeImportedIssueLabels([
    "  engineering  ",
    { name: "a".repeat(80) },
    { name: "sales" },
    null,
    ...Array.from({ length: 30 }, (_, index) => `label-${index}`),
  ]);

  assert.equal(labels.length, 20);
  assert.deepEqual(labels.slice(0, 3), ["engineering", "a".repeat(60), "sales"]);
});
