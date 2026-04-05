import { httpHealthcheck, httpRun } from "./shared.js";
import type { EngineAdapter } from "./types.js";

export const openclawAdapter: EngineAdapter = {
  id: "openclaw",
  label: "OpenClaw",
  description: "Calls an OpenClaw-compatible webhook.",
  connectionType: "http",
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
  description: "Calls a configurable HTTP agent endpoint.",
  connectionType: "http",
  fields: [
    { key: "apiUrl", label: "API URL", type: "url", required: true },
    { key: "apiKey", label: "API Key", type: "password" },
  ],
  async test(config) {
    const apiUrl = typeof config.apiUrl === "string" ? config.apiUrl : "";
    if (!apiUrl) {
      return { ok: false, message: "API URL is required." };
    }

    const base = apiUrl.replace(/\/+$/u, "");
    const headers =
      typeof config.apiKey === "string" && config.apiKey
        ? {
            Authorization: `Bearer ${config.apiKey}`,
          }
        : null;
    const health = await httpHealthcheck(`${base}/health`, headers ? { headers } : undefined);
    if (health.ok) {
      return health;
    }
    return httpHealthcheck(`${base}/status`, headers ? { headers } : undefined);
  },
  async *run({ prompt, connectionConfig, context }) {
    const apiUrl = typeof connectionConfig.apiUrl === "string" ? connectionConfig.apiUrl : "";
    if (!apiUrl) {
      throw new Error("API URL is required.");
    }

    yield* httpRun(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(typeof connectionConfig.apiKey === "string" && connectionConfig.apiKey
          ? { Authorization: `Bearer ${connectionConfig.apiKey}` }
          : {}),
      },
      body: JSON.stringify({ prompt, context }),
    });
  },
};

export const hermesAdapter: EngineAdapter = {
  id: "hermes",
  label: "Hermes",
  description: "Hermes is scaffolded but expects externally managed SOUL.md and profile files.",
  connectionType: "local",
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
