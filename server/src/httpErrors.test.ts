import assert from "node:assert/strict";
import { test } from "node:test";
import { formatHttpError } from "./httpErrors.js";

test("formatHttpError returns 400 for malformed JSON parser errors", () => {
  assert.deepEqual(formatHttpError({ type: "entity.parse.failed", status: 400, message: "Unexpected token" }, "production"), {
    status: 400,
    body: { error: "Invalid JSON payload." },
  });
});

test("formatHttpError returns 413 for oversized request bodies", () => {
  assert.deepEqual(formatHttpError({ type: "entity.too.large", status: 413, message: "too large" }, "production"), {
    status: 413,
    body: { error: "Request body is too large." },
  });
});

test("formatHttpError preserves expected client error messages", () => {
  assert.deepEqual(formatHttpError({ status: 404, message: "Not found." }, "production"), {
    status: 404,
    body: { error: "Not found." },
  });
});

test("formatHttpError hides unexpected server error details in production", () => {
  assert.deepEqual(formatHttpError(new Error("database secret leaked"), "production"), {
    status: 500,
    body: { error: "Server error" },
  });
});

test("formatHttpError keeps server error details outside production", () => {
  assert.deepEqual(formatHttpError(new Error("database failed"), "development"), {
    status: 500,
    body: { error: "database failed" },
  });
});
