import { describe, expect, it } from "vitest";
import { describeEngineVersion, engineConnectionGuide, seedEngineConfig } from "./engineConfig";
import type { EngineConnectionResult, EngineDefinition } from "@/mission/appTypes";

const cursorEngine: EngineDefinition = {
  id: "cursor",
  label: "Cursor",
  description: "Calls a local Cursor runtime over HTTP.",
  connectionType: "http",
  fields: [
    { key: "host", label: "Host", type: "text", defaultValue: "localhost", required: true },
    { key: "port", label: "Port", type: "number", defaultValue: 8765, required: true },
  ],
};

describe("engineConfig helpers", () => {
  it("seeds missing fields from engine defaults while preserving saved config", () => {
    expect(seedEngineConfig(cursorEngine, "{\"host\":\"192.168.1.42\"}")).toEqual({
      host: "192.168.1.42",
      port: 8765,
    });
  });

  it("describes LAN support for HTTP engines", () => {
    expect(engineConnectionGuide(cursorEngine).body).toContain("192.168.1.42");
  });

  it("reports update availability when version metadata is present", () => {
    const result: EngineConnectionResult = {
      ok: true,
      message: "Codex CLI 0.23.0",
      latency_ms: 120,
      currentVersion: "0.23.0",
      latestVersion: "0.24.0",
      updateAvailable: true,
      upgradeCommand: "npm install -g @openai/codex",
    };

    expect(describeEngineVersion(result)).toBe("Installed 0.23.0. Update available: 0.24.0.");
  });
});
