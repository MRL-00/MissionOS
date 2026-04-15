import type { EngineConnectionResult, EngineDefinition } from "@/mission/appTypes";

function parseSavedConfig(savedConfigText: string | undefined): Record<string, unknown> | null {
  if (!savedConfigText?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(savedConfigText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function seedEngineConfig(engine: EngineDefinition, savedConfigText?: string): Record<string, unknown> {
  const fieldDefaults = Object.fromEntries(
    engine.fields.map((field) => [field.key, field.defaultValue ?? ""]),
  );
  return {
    ...fieldDefaults,
    ...(parseSavedConfig(savedConfigText) ?? {}),
  };
}

export function serializeEngineConfig(engine: EngineDefinition, savedConfigText?: string): string {
  return JSON.stringify(seedEngineConfig(engine, savedConfigText), null, 2);
}

export function engineConnectionGuide(engine: EngineDefinition): { title: string; body: string } {
  switch (engine.id) {
    case "cursor":
      return {
        title: "LAN support",
        body: "Replace `host` with the other machine's IP address, for example `192.168.1.42`, and keep `port` aligned with that runtime's `/health` endpoint.",
      };
    case "openclaw":
      return {
        title: "LAN support",
        body: "Use the full remote webhook URL, for example `http://192.168.1.42:8787`. The test button calls `<webhookUrl>/health`.",
      };
    case "pi":
      return {
        title: "Runs locally",
        body: "Pi runs on the same machine as the MissionOS server. Install with `npm install -g @mariozechner/pi-coding-agent` and run `pi` to verify it works. Remote LAN execution needs a bridge or HTTP service on the other machine.",
      };
    case "codex":
      return {
        title: "Runs locally",
        body: "Codex is executed on the same machine as the MissionOS server. If you need another computer on the LAN, put a bridge or HTTP wrapper on that machine and point this flow at that endpoint instead.",
      };
    case "claude-code":
      return {
        title: "Runs locally",
        body: "Claude Code runs on the same machine as the MissionOS server. Remote LAN execution needs a bridge or HTTP service on the other machine; this onboarding flow does not launch the CLI over the network directly.",
      };
    case "hermes":
      return {
        title: "Externally managed",
        body: "Hermes is scaffolded only. Its profile files and runtime are managed outside this onboarding flow.",
      };
    default:
      return {
        title: "Connection setup",
        body: "Fill the provider-specific fields below and use Test Connection before finishing onboarding.",
      };
  }
}

export function describeEngineVersion(result: EngineConnectionResult | null | undefined): string | null {
  if (!result?.currentVersion) {
    return null;
  }

  if (result.updateAvailable && result.latestVersion) {
    return `Installed ${result.currentVersion}. Update available: ${result.latestVersion}.`;
  }

  if (result.latestVersion) {
    return `Installed ${result.currentVersion}. Up to date.`;
  }

  return `Installed ${result.currentVersion}.`;
}
