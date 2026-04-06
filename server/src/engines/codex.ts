import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { httpHealthcheck, streamProcess, testCliCommand, trackChildProcess } from "./shared.js";
import type { EngineAdapter } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

type ClaudeStreamEvent = {
  type?: unknown;
  subtype?: unknown;
  message?: {
    id?: unknown;
    content?: unknown;
  };
  content_block?: {
    id?: unknown;
    type?: unknown;
    name?: unknown;
  };
  delta?: {
    type?: unknown;
    text?: unknown;
    thinking?: unknown;
  };
  result?: unknown;
  errors?: unknown;
  is_error?: unknown;
};

type ClaudeParserState = {
  announcedToolUseIds: Set<string>;
  assistantTextByMessageId: Map<string, string>;
};

function isToolUseType(value: unknown): boolean {
  return value === "tool_use" || value === "server_tool_use" || value === "mcp_tool_use";
}

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return [];
      }
      const text = "text" in block && typeof block.text === "string" ? block.text : "";
      return text ? [text] : [];
    })
    .join("");
}

function extractToolAnnouncements(content: unknown, state: ClaudeParserState): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const announcements: string[] = [];
  for (const [index, block] of content.entries()) {
    if (!block || typeof block !== "object" || !isToolUseType(("type" in block ? block.type : undefined))) {
      continue;
    }

    const id =
      "id" in block && typeof block.id === "string" && block.id
        ? block.id
        : `${String(("type" in block ? block.type : "tool_use") ?? "tool_use")}:${String(("name" in block ? block.name : "tool") ?? "tool")}:${index}`;
    if (state.announcedToolUseIds.has(id)) {
      continue;
    }

    state.announcedToolUseIds.add(id);
    const toolName = "name" in block && typeof block.name === "string" && block.name ? block.name : "tool";
    announcements.push(`\n[tool] ${toolName}\n`);
  }

  return announcements;
}

export function parseClaudeStreamEvent(line: string, state: ClaudeParserState): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let event: ClaudeStreamEvent;
  try {
    event = JSON.parse(trimmed) as ClaudeStreamEvent;
  } catch {
    return `${line}${line.endsWith("\n") ? "" : "\n"}`;
  }

  if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
    return event.delta.text;
  }

  if (event.type === "content_block_start" && event.content_block && isToolUseType(event.content_block.type)) {
    const id =
      typeof event.content_block.id === "string" && event.content_block.id
        ? event.content_block.id
        : `${String(event.content_block.type)}:${String(event.content_block.name ?? "tool")}`;
    if (state.announcedToolUseIds.has(id)) {
      return null;
    }

    state.announcedToolUseIds.add(id);
    const toolName = typeof event.content_block.name === "string" && event.content_block.name ? event.content_block.name : "tool";
    return `\n[tool] ${toolName}\n`;
  }

  if (event.type === "assistant" && event.message) {
    const messageId =
      typeof event.message.id === "string" && event.message.id ? event.message.id : "__assistant__";
    const nextText = extractTextContent(event.message.content);
    const previousText = state.assistantTextByMessageId.get(messageId) ?? "";
    state.assistantTextByMessageId.set(messageId, nextText);

    const deltaText = nextText.startsWith(previousText) ? nextText.slice(previousText.length) : nextText;
    const toolAnnouncements = extractToolAnnouncements(event.message.content, state);
    const combined = `${toolAnnouncements.join("")}${deltaText}`;
    return combined || null;
  }

  if (event.type === "result") {
    if (typeof event.result === "string" && event.result.trim()) {
      return `${event.result}${event.result.endsWith("\n") ? "" : "\n"}`;
    }

    if (event.is_error === true && Array.isArray(event.errors) && event.errors.length > 0) {
      const message = event.errors.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).join("\n");
      return message ? `${message}${message.endsWith("\n") ? "" : "\n"}` : null;
    }
  }

  return null;
}

async function* streamClaudeProcess(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; cwd?: string; stdin?: string },
): AsyncGenerator<string> {
  const child = spawn(command, args, {
    env: options?.env,
    cwd: options?.cwd,
    stdio: [options?.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
  });

  if (options?.stdin !== undefined && child.stdin) {
    child.stdin.write(options.stdin);
    child.stdin.end();
  }

  const untrackChild = trackChildProcess(child);

  const queue: string[] = [];
  const waiters: Array<() => void> = [];
  const parserState: ClaudeParserState = {
    announcedToolUseIds: new Set<string>(),
    assistantTextByMessageId: new Map<string, string>(),
  };
  let stdoutBuffer = "";
  let stderr = "";
  let done = false;
  let failure: Error | null = null;

  const release = () => {
    const waiter = waiters.shift();
    waiter?.();
  };

  const push = (chunk: string) => {
    queue.push(chunk);
    release();
  };

  child.stdout?.on("data", (data) => {
    stdoutBuffer += String(data);
    const lines = stdoutBuffer.split(/\r?\n/u);
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const parsed = parseClaudeStreamEvent(line, parserState);
      if (parsed) {
        push(parsed);
      }
    }
  });

  child.stderr?.on("data", (data) => {
    stderr += String(data);
  });

  child.on("error", (error) => {
    failure = error;
    done = true;
    release();
  });

  child.on("close", (code) => {
    untrackChild();
    if (stdoutBuffer.trim()) {
      const parsed = parseClaudeStreamEvent(stdoutBuffer, parserState);
      if (parsed) {
        push(parsed);
      }
    }

    if (code !== 0 && !failure) {
      failure = new Error(stderr.trim() || `${command} exited with code ${code ?? -1}`);
    }

    done = true;
    release();
  });

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => waiters.push(resolve));
      continue;
    }

    const next = queue.shift();
    if (next) {
      yield next;
    }
  }

  if (failure) {
    if (stderr.trim()) {
      yield stderr.trim();
    }
    throw failure;
  }
}

export const codexAdapter: EngineAdapter = {
  id: "codex",
  label: "Codex",
  description: "Runs the local Codex CLI.",
  connectionType: "cli",
  fields: [
    { key: "codexPath", label: "Codex Path", type: "text", defaultValue: "codex", required: true },
    { key: "apiKey", label: "OpenAI API Key", type: "password" },
    { key: "sandboxMode", label: "Sandbox Mode", type: "text", defaultValue: "full-auto" },
  ],
  async test(config) {
    const command = typeof config.codexPath === "string" && config.codexPath ? config.codexPath : "codex";
    return testCliCommand(command, ["--version"], {
      label: "Codex CLI",
      latestPackageName: "@openai/codex",
      upgradeCommand: "npm install -g @openai/codex",
    });
  },
  async *run({ prompt, connectionConfig }) {
    const command =
      typeof connectionConfig.codexPath === "string" && connectionConfig.codexPath
        ? connectionConfig.codexPath
        : "codex";
    const apiKey =
      typeof connectionConfig.apiKey === "string" && connectionConfig.apiKey ? connectionConfig.apiKey : undefined;
    const cwd =
      typeof connectionConfig.workingDirectory === "string" && connectionConfig.workingDirectory
        ? connectionConfig.workingDirectory
        : repoRoot;

    const sandboxMode =
      typeof connectionConfig.sandboxMode === "string" && connectionConfig.sandboxMode.trim()
        ? connectionConfig.sandboxMode.trim().toLowerCase()
        : "full-auto";
    const sandboxArgs: string[] =
      sandboxMode === "read-only" ? ["--sandbox", "read-only"] : ["--full-auto"];

    yield* streamProcess(command, ["exec", ...sandboxArgs, "--color", "never", "--cd", cwd, prompt], {
      env: {
        ...process.env,
        ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
      },
      stdin: "",
    });
  },
};

export const cursorAdapter: EngineAdapter = {
  id: "cursor",
  label: "Cursor",
  description: "Calls a local Cursor runtime over HTTP.",
  connectionType: "http",
  fields: [
    { key: "host", label: "Host", type: "text", defaultValue: "localhost", required: true },
    { key: "port", label: "Port", type: "number", defaultValue: 8765, required: true },
  ],
  async test(config) {
    const host = typeof config.host === "string" && config.host ? config.host : "localhost";
    const port = typeof config.port === "number" ? config.port : Number(config.port ?? 8765);
    return httpHealthcheck(`http://${host}:${port}/health`);
  },
  async *run({ prompt, connectionConfig, context }) {
    const host = typeof connectionConfig.host === "string" && connectionConfig.host ? connectionConfig.host : "localhost";
    const port =
      typeof connectionConfig.port === "number" ? connectionConfig.port : Number(connectionConfig.port ?? 8765);
    const response = await fetch(`http://${host}:${port}/v1/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, context }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }

    yield text;
  },
};

export const claudeCodeAdapter: EngineAdapter = {
  id: "claude-code",
  label: "Claude Code",
  description: "Runs the Claude CLI locally.",
  connectionType: "cli",
  fields: [
    { key: "claudePath", label: "Claude Path", type: "text", defaultValue: "claude", required: true },
    { key: "model", label: "Model", type: "text", defaultValue: "claude-opus-4-5" },
  ],
  async test(config) {
    const command = typeof config.claudePath === "string" && config.claudePath ? config.claudePath : "claude";
    return testCliCommand(command, ["--version"], {
      label: "Claude CLI",
      latestPackageName: "@anthropic-ai/claude-code",
      upgradeCommand: "npm install -g @anthropic-ai/claude-code",
    });
  },
  async *run({ prompt, connectionConfig }) {
    const command =
      typeof connectionConfig.claudePath === "string" && connectionConfig.claudePath
        ? connectionConfig.claudePath
        : "claude";
    const model =
      typeof connectionConfig.model === "string" && connectionConfig.model
        ? connectionConfig.model
        : "claude-opus-4-5";
    const cwd =
      typeof connectionConfig.workingDirectory === "string" && connectionConfig.workingDirectory
        ? connectionConfig.workingDirectory
        : undefined;
    yield* streamClaudeProcess(
      command,
      [
        "--print",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--dangerously-skip-permissions",
        "--model",
        model,
        "-",
      ],
      { ...(cwd ? { cwd } : {}), stdin: prompt },
    );
  },
};
