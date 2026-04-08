import { httpHealthcheck, httpRun, streamProcess, testCliCommand } from "./shared.js";
import type { EngineAdapter } from "./types.js";

export const openclawAdapter: EngineAdapter = {
  id: "openclaw",
  label: "OpenClaw",
  description: "Calls an OpenClaw-compatible webhook.",
  connectionType: "http",
  comingSoon: true,
  fields: [
    { key: "webhookUrl", label: "Webhook URL", type: "url", required: true },
    { key: "apiKey", label: "API Key", type: "password" },
  ],
  async test(config) {
    const webhookUrl = typeof config.webhookUrl === "string" ? config.webhookUrl : "";
    if (!webhookUrl) {
      return { ok: false, message: "Webhook URL is required." };
    }

    const headers =
      typeof config.apiKey === "string" && config.apiKey
        ? {
            Authorization: `Bearer ${config.apiKey}`,
          }
        : null;

    return httpHealthcheck(
      `${webhookUrl.replace(/\/+$/u, "")}/health`,
      headers ? { headers } : undefined,
    );
  },
  async *run({ prompt, connectionConfig, agent }) {
    const webhookUrl = typeof connectionConfig.webhookUrl === "string" ? connectionConfig.webhookUrl : "";
    if (!webhookUrl) {
      throw new Error("Webhook URL is required.");
    }

    yield* httpRun(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(typeof connectionConfig.apiKey === "string" && connectionConfig.apiKey
          ? { Authorization: `Bearer ${connectionConfig.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        agent,
        prompt,
        tools: agent.tools,
      }),
    });
  },
};

export const piAdapter: EngineAdapter = {
  id: "pi",
  label: "Pi",
  description: "Runs the Pi coding agent CLI locally.",
  connectionType: "cli",
  fields: [
    { key: "piPath", label: "Pi Path", type: "text", defaultValue: "pi", required: true },
    { key: "model", label: "Model", type: "text" },
  ],
  async test(config) {
    const command = typeof config.piPath === "string" && config.piPath ? config.piPath : "pi";
    return testCliCommand(command, ["--version"], {
      label: "Pi CLI",
      latestPackageName: "@mariozechner/pi-coding-agent",
      upgradeCommand: "npm install -g @mariozechner/pi-coding-agent",
    });
  },
  async *run({ prompt, connectionConfig }) {
    const command =
      typeof connectionConfig.piPath === "string" && connectionConfig.piPath
        ? connectionConfig.piPath
        : "pi";
    const model =
      typeof connectionConfig.model === "string" && connectionConfig.model
        ? connectionConfig.model
        : undefined;

    const args = ["-p"];
    if (model) {
      args.push("--model", model);
    }
    args.push(prompt);

    yield* streamProcess(command, args);
  },
};

export const hermesAdapter: EngineAdapter = {
  id: "hermes",
  label: "Hermes",
  description: "Hermes is scaffolded but expects externally managed SOUL.md and profile files.",
  connectionType: "local",
  comingSoon: true,
  fields: [
    { key: "profilePath", label: "Profile Path", type: "text", placeholder: "/path/to/hermes/profile" },
  ],
  async test() {
    return {
      ok: false,
      message: "Hermes adapter is stubbed. Hermes manages its own SOUL.md and profile files externally.",
    };
  },
  async *run() {
    yield "Hermes adapter is not implemented yet. Hermes manages its own SOUL.md and profile files externally.";
  },
};
