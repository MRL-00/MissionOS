import { execFile } from "node:child_process";
import type { ProviderAgentRecord } from "../../src/mission/types";
import type { AdapterConfigField, AdapterModule, AdapterTestResult } from "./types";

function runCommand(command: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function configCliPath(config: Record<string, unknown>): string {
  return typeof config.cliPath === "string" && config.cliPath.trim() ? config.cliPath.trim() : "codex";
}

export const codexLocalAdapter: AdapterModule = {
  type: "codex-local",
  label: "Codex",

  configFields(): AdapterConfigField[] {
    return [
      { key: "cliPath", label: "CLI path", type: "text", placeholder: "codex", hint: "Path to the Codex CLI binary" },
      { key: "workingDirectory", label: "Working directory", type: "text", placeholder: "/path/to/project", hint: "Default cwd for spawned sessions" },
    ];
  },

  defaultConfig(): Record<string, unknown> {
    return {
      cliPath: "codex",
      workingDirectory: "",
    };
  },

  async testConnection(config): Promise<AdapterTestResult> {
    const cliPath = configCliPath(config);
    const start = Date.now();

    const which = await runCommand("which", [cliPath]);
    if (!which.ok) {
      return { ok: false, message: `"${cliPath}" not found in PATH.`, latencyMs: Date.now() - start };
    }

    const version = await runCommand(cliPath, ["--version"]);
    if (!version.ok) {
      return { ok: false, message: `"${cliPath}" found but --version failed: ${version.stderr}`, latencyMs: Date.now() - start };
    }

    return { ok: true, message: `Codex CLI ${version.stdout}`, latencyMs: Date.now() - start };
  },

  async syncAgents(): Promise<ProviderAgentRecord[]> {
    return [];
  },
};
