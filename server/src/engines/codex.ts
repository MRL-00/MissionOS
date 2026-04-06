import path from "node:path";
import { fileURLToPath } from "node:url";
import { httpHealthcheck, streamProcess, testCliCommand } from "./shared.js";
import type { EngineAdapter } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
    yield* streamProcess(
      command,
      ["--print", "--dangerously-skip-permissions", "--model", model, prompt],
      cwd ? { cwd } : undefined,
    );
  },
};
