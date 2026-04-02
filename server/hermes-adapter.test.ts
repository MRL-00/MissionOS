import assert from "node:assert/strict";
import { test } from "node:test";
import { hermesAdapterTestExports } from "./adapters/hermes";

test("extractSessionId finds Hermes session ids inside CLI output", () => {
  const sessionId = hermesAdapterTestExports.extractSessionId([
    "┊ 💻 $ git status --short",
    "session_id: 20260402_102901_53ffc1",
  ].join("\n"));

  assert.equal(sessionId, "20260402_102901_53ffc1");
});

test("parseSessionExportOutput reads exported message payloads", () => {
  const messages = hermesAdapterTestExports.parseSessionExportOutput(JSON.stringify({
    id: "20260402_102901_53ffc1",
    source: "cli",
    messages: [
      { id: "m1", role: "user", content: "Implement the fix." },
      { id: "m2", role: "assistant", content: "{\"status\":\"implemented\",\"summary\":\"patched workflow\"}" },
    ],
  }));

  assert.deepEqual(
    messages.map((message) => [message.role, message.content]),
    [
      ["user", "Implement the fix."],
      ["assistant", "{\"status\":\"implemented\",\"summary\":\"patched workflow\"}"],
    ],
  );
});

test("parseSessionExportOutput reads structured assistant content blocks", () => {
  const messages = hermesAdapterTestExports.parseSessionExportOutput(JSON.stringify({
    id: "20260402_130208_ee5f98",
    messages: [
      { id: "m1", role: "user", content: "Return JSON only." },
      {
        id: "m2",
        role: "assistant",
        content: [
          { type: "text", text: "{\"status\":\"implemented\",\"pullRequestUrl\":\"https://example.com/pr/123\"}" },
        ],
      },
    ],
  }));

  assert.deepEqual(
    messages.map((message) => [message.role, message.content]),
    [
      ["user", "Return JSON only."],
      ["assistant", "{\"status\":\"implemented\",\"pullRequestUrl\":\"https://example.com/pr/123\"}"],
    ],
  );
});

test("latestAssistantMessage ignores non-assistant entries and strips Hermes chrome", () => {
  const result = hermesAdapterTestExports.latestAssistantMessage([
    { id: "m1", role: "system", content: "tool output" },
    {
      id: "m2",
      role: "assistant",
      content: [
        "session_id: 20260402_114500_aabbcc",
        "╭─ ⚕ Hermes ──────────────╮",
        "{\"ok\":true}",
      ].join("\n"),
    },
  ]);

  assert.ok(result);
  assert.equal(result.content, "{\"ok\":true}");
});

test("latestTerminalAssistantMessage prefers the final stop turn over intermediate tool-calls turns", () => {
  const result = hermesAdapterTestExports.latestTerminalAssistantMessage([
    { id: "m1", role: "assistant", content: "", finishReason: "tool_calls" },
    { id: "m2", role: "system", content: "{\"output\":\"git status\"}" },
    {
      id: "m3",
      role: "assistant",
      content: "{\"status\":\"implemented\",\"pullRequestUrl\":\"https://example.com/pr/562\"}",
      finishReason: "stop",
    },
  ]);

  assert.ok(result);
  assert.equal(result.content, "{\"status\":\"implemented\",\"pullRequestUrl\":\"https://example.com/pr/562\"}");
});
