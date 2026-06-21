import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "express";
import {
  checkAuthRateLimit,
  clearAuthRateLimit,
  insertInitialUser,
  parseLoginPayload,
  parsePasswordPayload,
  parseProfilePayload,
  parseProjectPayload,
  parseProjectResetPayload,
  parseRegisterPayload,
  requireAuth,
  resetAuthRateLimitsForTests,
  validateRegistrationOpen,
  validateProjectResetConfirmation,
  validatePasswordStrength,
  validateTextLength,
} from "./auth.js";
import type { AuthenticatedRequest } from "../serializers.js";
import { resetDatabase } from "../db.js";
import type { UserRow } from "../serializers.js";

function makeAuthResponse() {
  const result = { statusCode: 200, body: null as unknown };
  const response = {
    status(code: number) {
      result.statusCode = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  } as Response;
  return { response, result };
}

test("requireAuth allows non-api and bootstrap/auth setup routes", () => {
  for (const path of ["/", "/api/health", "/api/bootstrap", "/api/auth/register", "/api/auth/login"]) {
    const { response, result } = makeAuthResponse();
    let nextCalled = false;

    requireAuth(
      { path, header: () => undefined } as unknown as AuthenticatedRequest,
      response,
      () => {
        nextCalled = true;
      },
    );

    assert.equal(nextCalled, true);
    assert.equal(result.body, null);
  }
});

test("requireAuth rejects protected api routes without a bearer token", () => {
  const { response, result } = makeAuthResponse();
  let nextCalled = false;

  requireAuth(
    { path: "/api/agents", header: () => undefined } as unknown as AuthenticatedRequest,
    response,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(result.statusCode, 401);
  assert.deepEqual(result.body, { error: "Missing token." });
});

test("requireAuth rejects malformed bearer tokens", () => {
  const { response, result } = makeAuthResponse();
  let nextCalled = false;

  requireAuth(
    { path: "/api/agents", header: () => "Bearer invalid-token" } as unknown as AuthenticatedRequest,
    response,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(result.statusCode, 401);
  assert.deepEqual(result.body, { error: "Invalid token." });
});

test("parseRegisterPayload trims credentials and display names", () => {
  assert.deepEqual(
    parseRegisterPayload({ username: "  alice  ", password: "  long-secret  ", displayName: "  Alice A.  " }),
    {
      ok: true,
      payload: { username: "alice", password: "long-secret", displayName: "Alice A." },
    },
  );
});

test("checkAuthRateLimit blocks repeated attempts within the window", () => {
  resetAuthRateLimitsForTests();

  assert.deepEqual(checkAuthRateLimit("login", "Alice", 1_000, { maxAttempts: 2, windowMs: 10_000 }), { ok: true });
  assert.deepEqual(checkAuthRateLimit("login", "alice", 2_000, { maxAttempts: 2, windowMs: 10_000 }), { ok: true });
  assert.deepEqual(checkAuthRateLimit("login", " ALICE ", 3_000, { maxAttempts: 2, windowMs: 10_000 }), {
    ok: false,
    retryAfterSeconds: 8,
    error: "Too many authentication attempts. Please try again later.",
  });
});

test("checkAuthRateLimit expires old attempts and can be cleared", () => {
  resetAuthRateLimitsForTests();

  assert.deepEqual(checkAuthRateLimit("login", "alice", 1_000, { maxAttempts: 1, windowMs: 10_000 }), { ok: true });
  assert.deepEqual(checkAuthRateLimit("login", "alice", 12_000, { maxAttempts: 1, windowMs: 10_000 }), { ok: true });
  assert.equal(checkAuthRateLimit("login", "alice", 13_000, { maxAttempts: 1, windowMs: 10_000 }).ok, false);
  clearAuthRateLimit("login", "alice");
  assert.deepEqual(checkAuthRateLimit("login", "alice", 14_000, { maxAttempts: 1, windowMs: 10_000 }), { ok: true });
});

test("checkAuthRateLimit caps stored buckets for unique identifiers", () => {
  resetAuthRateLimitsForTests();

  assert.deepEqual(checkAuthRateLimit("login", "alice", 1_000, { maxAttempts: 1, windowMs: 60_000, maxBuckets: 2 }), {
    ok: true,
  });
  assert.deepEqual(checkAuthRateLimit("login", "bob", 2_000, { maxAttempts: 1, windowMs: 60_000, maxBuckets: 2 }), {
    ok: true,
  });
  assert.deepEqual(checkAuthRateLimit("login", "carol", 3_000, { maxAttempts: 1, windowMs: 60_000, maxBuckets: 2 }), {
    ok: true,
  });

  assert.deepEqual(checkAuthRateLimit("login", "alice", 4_000, { maxAttempts: 1, windowMs: 60_000, maxBuckets: 2 }), {
    ok: true,
  });
  assert.equal(checkAuthRateLimit("login", "carol", 5_000, { maxAttempts: 1, windowMs: 60_000, maxBuckets: 2 }).ok, false);
});

test("parseRegisterPayload defaults display names to usernames", () => {
  assert.deepEqual(parseRegisterPayload({ username: "alice", password: "long-secret", displayName: " " }), {
    ok: true,
    payload: { username: "alice", password: "long-secret", displayName: "alice" },
  });
});

test("parseRegisterPayload rejects blank credentials", () => {
  assert.deepEqual(parseRegisterPayload({ username: " ", password: "long-secret" }), {
    ok: false,
    error: "Username and password are required.",
  });
  assert.deepEqual(parseRegisterPayload({ username: "alice", password: " " }), {
    ok: false,
    error: "Username and password are required.",
  });
});

test("parseRegisterPayload rejects short passwords", () => {
  assert.deepEqual(parseRegisterPayload({ username: "alice", password: "short" }), {
    ok: false,
    error: "Password must be at least 8 characters.",
  });
});

test("parseRegisterPayload rejects oversized identity fields", () => {
  assert.deepEqual(parseRegisterPayload({ username: "a".repeat(65), password: "long-password" }), {
    ok: false,
    error: "Username must be 64 characters or fewer.",
  });
  assert.deepEqual(parseRegisterPayload({ username: "alice", password: "long-password", displayName: "a".repeat(121) }), {
    ok: false,
    error: "Display name must be 120 characters or fewer.",
  });
});

test("validatePasswordStrength requires at least eight characters", () => {
  assert.deepEqual(validatePasswordStrength("1234567"), {
    ok: false,
    error: "Password must be at least 8 characters.",
  });
  assert.deepEqual(validatePasswordStrength("a".repeat(257)), {
    ok: false,
    error: "Password must be 256 characters or fewer.",
  });
  assert.deepEqual(validatePasswordStrength("12345678"), { ok: true, payload: null });
});

test("validateTextLength rejects long strings", () => {
  assert.deepEqual(validateTextLength("Field", "abcd", 3), {
    ok: false,
    error: "Field must be 3 characters or fewer.",
  });
  assert.deepEqual(validateTextLength("Field", null, 3), { ok: true, payload: null });
});

test("validateRegistrationOpen closes registration after first account", () => {
  assert.deepEqual(validateRegistrationOpen(false), { ok: true, payload: null });
  assert.deepEqual(validateRegistrationOpen(true), {
    ok: false,
    error: "Registration is closed after the first account is created.",
  });
});

test("insertInitialUser enforces first-account registration inside the insert transaction", () => {
  const db = resetDatabase();
  const firstUser: UserRow = {
    id: "user-first",
    username: "alice",
    password_hash: "hash",
    display_name: "Alice",
    avatar_emoji: "A",
    created_at: "2026-05-07T00:00:00.000Z",
  };
  const secondUser: UserRow = {
    ...firstUser,
    id: "user-second",
    username: "bob",
    display_name: "Bob",
  };

  assert.deepEqual(insertInitialUser(db, firstUser), { ok: true });
  assert.deepEqual(insertInitialUser(db, secondUser), {
    ok: false,
    status: 403,
    error: "Registration is closed after the first account is created.",
  });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 1);
});

test("parseLoginPayload trims credentials", () => {
  assert.deepEqual(parseLoginPayload({ username: "  alice  ", password: "  secret  " }), {
    ok: true,
    payload: { username: "alice", password: "secret" },
  });
});

test("parseLoginPayload rejects missing credentials", () => {
  assert.deepEqual(parseLoginPayload({ username: "alice" }), {
    ok: false,
    error: "Username and password are required.",
  });
});

test("parseLoginPayload rejects oversized credentials", () => {
  assert.deepEqual(parseLoginPayload({ username: "a".repeat(65), password: "long-password" }), {
    ok: false,
    error: "Username must be 64 characters or fewer.",
  });
  assert.deepEqual(parseLoginPayload({ username: "alice", password: "a".repeat(257) }), {
    ok: false,
    error: "Password must be 256 characters or fewer.",
  });
});

test("parseProfilePayload trims optional profile fields", () => {
  assert.deepEqual(parseProfilePayload({ displayName: "  Alice  ", avatarEmoji: "  A  " }), {
    displayName: "Alice",
    avatarEmoji: "A",
  });
  assert.deepEqual(parseProfilePayload({ displayName: " ", avatarEmoji: null }), {
    displayName: null,
    avatarEmoji: null,
  });
});

test("parseProfilePayload rejects oversized profile fields", () => {
  assert.throws(
    () => parseProfilePayload({ displayName: "a".repeat(121), avatarEmoji: "A" }),
    /Display name must be 120 characters or fewer\./,
  );
  assert.throws(
    () => parseProfilePayload({ displayName: "Alice", avatarEmoji: "a".repeat(17) }),
    /Avatar emoji must be 16 characters or fewer\./,
  );
});

test("parsePasswordPayload trims and requires both passwords", () => {
  assert.deepEqual(parsePasswordPayload({ currentPassword: "  old-password  ", newPassword: "  new-password  " }), {
    ok: true,
    payload: { currentPassword: "old-password", newPassword: "new-password" },
  });
  assert.deepEqual(parsePasswordPayload({ currentPassword: "old", newPassword: " " }), {
    ok: false,
    error: "Current and new passwords are required.",
  });
});

test("parsePasswordPayload rejects short new passwords", () => {
  assert.deepEqual(parsePasswordPayload({ currentPassword: "old-password", newPassword: "short" }), {
    ok: false,
    error: "Password must be at least 8 characters.",
  });
});

test("parsePasswordPayload rejects oversized current or new passwords", () => {
  assert.deepEqual(parsePasswordPayload({ currentPassword: "a".repeat(257), newPassword: "new-password" }), {
    ok: false,
    error: "Current password must be 256 characters or fewer.",
  });
  assert.deepEqual(parsePasswordPayload({ currentPassword: "old-password", newPassword: "a".repeat(257) }), {
    ok: false,
    error: "Password must be 256 characters or fewer.",
  });
});

test("parseProjectPayload trims project fields", () => {
  assert.deepEqual(parseProjectPayload({ name: "  Operations  ", description: "  Team orchestration  " }), {
    ok: true,
    payload: { name: "Operations", description: "Team orchestration" },
  });
});

test("parseProjectPayload rejects blank project names", () => {
  assert.deepEqual(parseProjectPayload({ name: " ", description: "Test" }), {
    ok: false,
    error: "Project name is required.",
  });
});

test("parseProjectPayload rejects oversized project fields", () => {
  assert.deepEqual(parseProjectPayload({ name: "a".repeat(121), description: "Test" }), {
    ok: false,
    error: "Project name must be 120 characters or fewer.",
  });
  assert.deepEqual(parseProjectPayload({ name: "Operations", description: "a".repeat(2001) }), {
    ok: false,
    error: "Project description must be 2000 characters or fewer.",
  });
});

test("parseProjectResetPayload trims confirmation names", () => {
  assert.deepEqual(parseProjectResetPayload({ confirmName: "  Operations  " }), {
    ok: true,
    payload: { confirmName: "Operations" },
  });
});

test("parseProjectResetPayload rejects blank confirmations", () => {
  assert.deepEqual(parseProjectResetPayload({ confirmName: " " }), {
    ok: false,
    error: "Project name confirmation is required.",
  });
});

test("validateProjectResetConfirmation requires an existing matching project", () => {
  assert.deepEqual(validateProjectResetConfirmation(null, "Operations"), {
    ok: false,
    error: "No project exists to reset.",
  });
  assert.deepEqual(validateProjectResetConfirmation("Operations", "Sales"), {
    ok: false,
    error: "Project name does not match.",
  });
  assert.deepEqual(validateProjectResetConfirmation("Operations", "Operations"), {
    ok: true,
    payload: { confirmName: "Operations" },
  });
});
