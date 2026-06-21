import assert from "node:assert/strict";
import { test } from "node:test";
import { MASKED_SECRET_VALUE } from "./secretConfig.js";
import { serializeAgent, serializeMission } from "./serializers.js";

test("serializeAgent masks engine password fields in connection config", () => {
  assert.deepEqual(
    serializeAgent({
      id: "agent-1",
      name: "Coder",
      role: "Engineer",
      emoji: "🤖",
      color: "#5E4AE3",
      engine: "codex",
      skills: "[]",
      tools: "[]",
      connection_type: "cli",
      connection_config: JSON.stringify({ codexPath: "codex", apiKey: "secret", sandboxMode: "full-auto" }),
      soul_md: "",
      agents_md: "",
      external_config: 0,
      active: 1,
      created_at: "2026-05-07 00:00:00",
      pos_x: 10,
      pos_y: 20,
    }).connection_config,
    { codexPath: "codex", apiKey: MASKED_SECRET_VALUE, sandboxMode: "full-auto" },
  );
});

test("serializeMission defaults missing team names to General", () => {
  assert.equal(
    serializeMission(
      {
        id: "mission-1",
        title: "Launch",
        status: "planning",
        total_issues: 0,
        done_issues: 0,
      },
      [],
    ).team_name,
    "General",
  );
});
