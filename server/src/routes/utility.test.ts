import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { getDb } from "../db.js";
import {
  MASKED_SETTING_VALUE,
  escapeLikeTerm,
  isAllowedSettingKey,
  normalizeSettingsForSave,
  parseFeedbackPayload,
  parseSearchQuery,
  parseSettingsPayload,
  registerUtilityRoutes,
  resolveDocContentPath,
  sanitizeSettingsMap,
} from "./utility.js";

async function requestSearch(query: string): Promise<{ status: number; body: unknown }> {
  const docsRoot = mkdtempSync(path.join(tmpdir(), "missionos-search-docs-"));
  const app = express();
  app.use(express.json());
  registerUtilityRoutes(app, docsRoot);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, () => resolve(nextServer));
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/search?q=${encodeURIComponent(query)}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    rmSync(docsRoot, { recursive: true, force: true });
  }
}

test("parseSettingsPayload accepts array and object-wrapped payloads", () => {
  assert.deepEqual(parseSettingsPayload([{ key: " issue_prefix ", value: "OPS" }]), {
    ok: true,
    settings: [{ key: "issue_prefix", value: "OPS" }],
  });
  assert.deepEqual(parseSettingsPayload({ settings: [{ key: "theme", value: "dark" }] }), {
    ok: false,
    error: "Setting 1 key is not supported.",
  });
});

test("isAllowedSettingKey accepts product and engine settings only", () => {
  assert.equal(isAllowedSettingKey("issue_prefix"), true);
  assert.equal(isAllowedSettingKey("github_pat"), true);
  assert.equal(isAllowedSettingKey("engine.codex"), true);
  assert.equal(isAllowedSettingKey("engine.unknown"), false);
  assert.equal(isAllowedSettingKey("theme"), false);
});

test("parseSettingsPayload coerces non-string values to empty strings", () => {
  assert.deepEqual(parseSettingsPayload([{ key: "github_pat", value: null }]), {
    ok: true,
    settings: [{ key: "github_pat", value: "" }],
  });
});

test("parseSettingsPayload rejects malformed payloads", () => {
  assert.deepEqual(parseSettingsPayload({ settings: "bad" }), {
    ok: false,
    error: "Settings payload must be an array.",
  });
  assert.deepEqual(parseSettingsPayload([null]), {
    ok: false,
    error: "Setting 1 must be an object.",
  });
  assert.deepEqual(parseSettingsPayload([{ key: " " }]), {
    ok: false,
    error: "Setting 1 requires a key.",
  });
});

test("parseSettingsPayload rejects oversized settings payloads", () => {
  assert.deepEqual(parseSettingsPayload(Array.from({ length: 201 }, (_, index) => ({ key: `setting-${index}`, value: "" }))), {
    ok: false,
    error: "Settings payload must include 200 or fewer entries.",
  });
  assert.deepEqual(parseSettingsPayload([{ key: "a".repeat(121), value: "" }]), {
    ok: false,
    error: "Setting 1 key must be 120 characters or fewer.",
  });
  assert.deepEqual(parseSettingsPayload([{ key: "setting", value: "a".repeat(20_001) }]), {
    ok: false,
    error: "Setting 1 key is not supported.",
  });
  assert.deepEqual(parseSettingsPayload([{ key: "issue_prefix", value: "a".repeat(20_001) }]), {
    ok: false,
    error: "Setting 1 value must be 20000 characters or fewer.",
  });
});

test("sanitizeSettingsMap masks configured top-level secrets", () => {
  assert.deepEqual(
    sanitizeSettingsMap({
      github_pat: "ghp_secret",
      linear_api_key: "lin_secret",
      issue_prefix: "OPS",
      theme: "dark",
    }),
    {
      github_pat: MASKED_SETTING_VALUE,
      linear_api_key: MASKED_SETTING_VALUE,
      issue_prefix: "OPS",
    },
  );
});

test("sanitizeSettingsMap removes unsupported legacy settings", () => {
  assert.deepEqual(
    sanitizeSettingsMap({
      "engine.codex": JSON.stringify({ apiKey: "secret" }),
      "engine.unknown": JSON.stringify({ apiKey: "secret" }),
      unsupported_key: "value",
      usage_currency: "USD",
    }),
    {
      "engine.codex": JSON.stringify({ apiKey: MASKED_SETTING_VALUE }),
      usage_currency: "USD",
    },
  );
});

test("normalizeSettingsForSave preserves unchanged masked secrets", () => {
  assert.deepEqual(
    normalizeSettingsForSave(
      [
        { key: "github_pat", value: MASKED_SETTING_VALUE },
        { key: "linear_api_key", value: "new-linear-key" },
        { key: "issue_prefix", value: "OPS" },
      ],
      { github_pat: "old-github-key", linear_api_key: "old-linear-key" },
    ),
    [
      { key: "github_pat", value: "old-github-key" },
      { key: "linear_api_key", value: "new-linear-key" },
      { key: "issue_prefix", value: "OPS" },
    ],
  );
});

test("parseFeedbackPayload trims feedback fields", () => {
  assert.deepEqual(parseFeedbackPayload({ type: "  bug  ", message: "  Broken flow  " }), {
    ok: true,
    payload: { type: "bug", message: "Broken flow" },
  });
});

test("parseFeedbackPayload rejects blank feedback", () => {
  assert.deepEqual(parseFeedbackPayload({ type: "bug", message: " " }), {
    ok: false,
    error: "Feedback type and message are required.",
  });
});

test("parseFeedbackPayload rejects oversized feedback fields", () => {
  assert.deepEqual(parseFeedbackPayload({ type: "a".repeat(81), message: "Broken flow" }), {
    ok: false,
    error: "Feedback type must be 80 characters or fewer.",
  });
  assert.deepEqual(parseFeedbackPayload({ type: "bug", message: "a".repeat(5_001) }), {
    ok: false,
    error: "Feedback message must be 5000 characters or fewer.",
  });
});

test("parseSearchQuery trims, limits, and wraps search terms", () => {
  assert.deepEqual(parseSearchQuery("  launch  "), {
    raw: "launch",
    likeTerm: "%launch%",
  });
  assert.deepEqual(parseSearchQuery("x".repeat(150)), {
    raw: "x".repeat(100),
    likeTerm: `%${"x".repeat(100)}%`,
  });
});

test("parseSearchQuery rejects blank and non-string terms", () => {
  assert.equal(parseSearchQuery("   "), null);
  assert.equal(parseSearchQuery(["launch"]), null);
});

test("escapeLikeTerm escapes sqlite wildcard characters", () => {
  assert.equal(escapeLikeTerm(String.raw`100%_done\ok`), String.raw`100\%\_done\\ok`);
});

test("search matches missions by team name", async () => {
  const db = getDb();
  db.prepare("DELETE FROM missions WHERE id = 'search-team-mission-test'").run();
  db.prepare(
    `
    INSERT INTO missions (id, title, description, status, team_name)
    VALUES ('search-team-mission-test', 'Quarter close', 'Reconcile ledgers', 'planning', 'Finance')
    `,
  ).run();

  try {
    const response = await requestSearch("Finance");

    assert.equal(response.status, 200);
    const body = response.body as { missions: Array<{ id: string; team_name: string }> };
    assert.deepEqual(body.missions.filter((mission) => mission.id === "search-team-mission-test"), [
      { id: "search-team-mission-test", title: "Quarter close", description: "Reconcile ledgers", team_name: "Finance" },
    ]);
  } finally {
    db.prepare("DELETE FROM missions WHERE id = 'search-team-mission-test'").run();
  }
});

test("resolveDocContentPath accepts markdown files inside docs root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "missionos-docs-"));
  try {
    mkdirSync(path.join(root, "guides"));
    writeFileSync(path.join(root, "guides", "setup.md"), "# Setup");

    assert.deepEqual(resolveDocContentPath(root, "guides/setup.md"), {
      safePath: "guides/setup.md",
      absolutePath: realpathSync(path.join(root, "guides", "setup.md")),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveDocContentPath rejects non-markdown files and directories", () => {
  const root = mkdtempSync(path.join(tmpdir(), "missionos-docs-"));
  try {
    mkdirSync(path.join(root, "guides"));
    writeFileSync(path.join(root, "guides", "setup.txt"), "Setup");

    assert.equal(resolveDocContentPath(root, "guides/setup.txt"), null);
    assert.equal(resolveDocContentPath(root, "guides"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveDocContentPath keeps traversal attempts inside docs root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "missionos-docs-"));
  try {
    writeFileSync(path.join(root, "safe.md"), "# Safe");

    assert.deepEqual(resolveDocContentPath(root, "../safe.md"), {
      safePath: "safe.md",
      absolutePath: realpathSync(path.join(root, "safe.md")),
    });
    assert.equal(resolveDocContentPath(root, "../package.json"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveDocContentPath rejects markdown symlinks outside docs root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "missionos-docs-"));
  const outside = mkdtempSync(path.join(tmpdir(), "missionos-docs-outside-"));
  try {
    writeFileSync(path.join(outside, "secret.md"), "# Secret");
    symlinkSync(path.join(outside, "secret.md"), path.join(root, "linked.md"));

    assert.equal(resolveDocContentPath(root, "linked.md"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
