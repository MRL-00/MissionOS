import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineDefinition } from "./engines/types.js";
import {
  MASKED_SECRET_VALUE,
  maskEngineConfig,
  mergeMaskedEngineConfig,
  normalizeSettingsSecretsForSave,
  sanitizeSettingsMap,
} from "./secretConfig.js";

const engines = new Map<string, EngineDefinition>([
  [
    "codex",
    {
      id: "codex",
      label: "Codex",
      description: "Codex",
      connectionType: "cli",
      fields: [
        { key: "codexPath", label: "Path", type: "text" },
        { key: "apiKey", label: "API Key", type: "password" },
      ],
    },
  ],
]);

test("maskEngineConfig masks only configured password fields", () => {
  assert.deepEqual(maskEngineConfig("codex", { codexPath: "codex", apiKey: "secret", model: "o3" }, engines), {
    codexPath: "codex",
    apiKey: MASKED_SECRET_VALUE,
    model: "o3",
  });
  assert.deepEqual(maskEngineConfig("codex", { apiKey: "" }, engines), { apiKey: "" });
});

test("mergeMaskedEngineConfig preserves existing masked password fields", () => {
  assert.deepEqual(
    mergeMaskedEngineConfig("codex", { codexPath: "codex", apiKey: MASKED_SECRET_VALUE }, { apiKey: "old-secret" }, engines),
    { codexPath: "codex", apiKey: "old-secret" },
  );
  assert.deepEqual(
    mergeMaskedEngineConfig("codex", { codexPath: "codex", apiKey: "new-secret" }, { apiKey: "old-secret" }, engines),
    { codexPath: "codex", apiKey: "new-secret" },
  );
});

test("sanitizeSettingsMap masks engine config password fields", () => {
  assert.deepEqual(
    sanitizeSettingsMap({ "engine.codex": JSON.stringify({ codexPath: "codex", apiKey: "secret" }), issue_prefix: "OPS" }, engines),
    { "engine.codex": JSON.stringify({ codexPath: "codex", apiKey: MASKED_SECRET_VALUE }), issue_prefix: "OPS" },
  );
});

test("normalizeSettingsSecretsForSave preserves unchanged engine secrets", () => {
  assert.deepEqual(
    normalizeSettingsSecretsForSave(
      [{ key: "engine.codex", value: JSON.stringify({ codexPath: "codex", apiKey: MASKED_SECRET_VALUE }) }],
      { "engine.codex": JSON.stringify({ codexPath: "codex", apiKey: "old-secret" }) },
      engines,
    ),
    [{ key: "engine.codex", value: JSON.stringify({ codexPath: "codex", apiKey: "old-secret" }) }],
  );
});
