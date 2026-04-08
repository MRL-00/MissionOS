import assert from "node:assert/strict";
import test from "node:test";
import { formatClaudeExitMessage, parseClaudeStreamEvent } from "./claude.js";

function createParserState() {
  return {
    announcedToolUseIds: new Set<string>(),
    assistantTextByMessageId: new Map<string, string>(),
  };
}

test("parseClaudeStreamEvent emits text deltas from Claude content block events", () => {
  const state = createParserState();
  const line = JSON.stringify({
    type: "content_block_delta",
    delta: {
      type: "text_delta",
      text: "Hello",
    },
  });

  assert.equal(parseClaudeStreamEvent(line, state), "Hello");
});

test("parseClaudeStreamEvent announces Claude tool use blocks once", () => {
  const state = createParserState();
  const line = JSON.stringify({
    type: "content_block_start",
    content_block: {
      id: "toolu_123",
      type: "tool_use",
      name: "Bash",
    },
  });

  assert.equal(parseClaudeStreamEvent(line, state), "\n[tool] Bash\n");
  assert.equal(parseClaudeStreamEvent(line, state), null);
});

test("parseClaudeStreamEvent emits only the incremental assistant text", () => {
  const state = createParserState();
  const first = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_1",
      content: [{ type: "text", text: "Plan" }],
    },
  });
  const second = JSON.stringify({
    type: "assistant",
    message: {
      id: "msg_1",
      content: [{ type: "text", text: "Plan done" }],
    },
  });

  assert.equal(parseClaudeStreamEvent(first, state), "Plan");
  assert.equal(parseClaudeStreamEvent(second, state), " done");
});

test("parseClaudeStreamEvent surfaces Claude result errors", () => {
  const state = createParserState();
  const line = JSON.stringify({
    type: "result",
    is_error: true,
    errors: ["Not logged in · Please run /login"],
  });

  assert.equal(parseClaudeStreamEvent(line, state), "Not logged in · Please run /login\n");
});

test("formatClaudeExitMessage explains SIGTERM interruptions", () => {
  assert.equal(
    formatClaudeExitMessage("claude", 143, "SIGTERM", ""),
    "Claude run was interrupted before it finished. This usually means the MissionOS server restarted or the Claude process was terminated externally.",
  );
});
