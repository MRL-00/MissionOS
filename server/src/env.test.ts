import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCorsOrigins, parsePort, resolveJwtSecret } from "./env.js";

test("resolveJwtSecret uses configured secrets", () => {
  assert.equal(resolveJwtSecret("  real-production-secret-32-characters  ", "production"), "real-production-secret-32-characters");
});

test("resolveJwtSecret allows the development fallback outside production", () => {
  assert.equal(resolveJwtSecret(undefined, "development"), "missionos-dev-secret");
  assert.equal(resolveJwtSecret(" ", undefined), "missionos-dev-secret");
});

test("resolveJwtSecret requires JWT_SECRET in production", () => {
  assert.throws(() => resolveJwtSecret(undefined, "production"), /JWT_SECRET must be configured in production\./);
  assert.throws(() => resolveJwtSecret(" ", "production"), /JWT_SECRET must be configured in production\./);
});

test("resolveJwtSecret rejects weak production secrets", () => {
  assert.throws(
    () => resolveJwtSecret("short-secret", "production"),
    /JWT_SECRET must be at least 32 characters in production\./,
  );
  assert.equal(resolveJwtSecret("short-secret", "development"), "short-secret");
});

test("parsePort accepts valid TCP ports", () => {
  assert.equal(parsePort("1"), 1);
  assert.equal(parsePort("3001"), 3001);
  assert.equal(parsePort("65535"), 65535);
});

test("parsePort falls back for invalid ports", () => {
  assert.equal(parsePort(undefined), 3001);
  assert.equal(parsePort("0"), 3001);
  assert.equal(parsePort("65536"), 3001);
  assert.equal(parsePort("1.5"), 3001);
  assert.equal(parsePort("abc"), 3001);
});

test("parseCorsOrigins is permissive by default outside production", () => {
  assert.equal(parseCorsOrigins(undefined, "development"), true);
  assert.equal(parseCorsOrigins("*", "development"), true);
});

test("parseCorsOrigins disables wildcard CORS by default in production", () => {
  assert.equal(parseCorsOrigins(undefined, "production"), false);
  assert.equal(parseCorsOrigins("*", "production"), false);
});

test("parseCorsOrigins parses explicit allowed origins", () => {
  assert.deepEqual(
    parseCorsOrigins(" https://app.example.com,https://mission.example.com ", "production"),
    ["https://app.example.com", "https://mission.example.com"],
  );
});
