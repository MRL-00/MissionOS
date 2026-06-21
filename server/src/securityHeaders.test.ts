import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "express";
import { applySecurityHeaders, securityHeaders } from "./securityHeaders.js";

test("applySecurityHeaders sets browser hardening headers and continues", () => {
  const headers = new Map<string, string>();
  let nextCalled = false;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
  } as Response;

  applySecurityHeaders({} as never, response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  for (const [name, value] of securityHeaders) {
    assert.equal(headers.get(name), value);
  }
});
