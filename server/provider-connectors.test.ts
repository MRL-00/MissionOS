import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ProviderConnector } from "../src/mission/types";
import { syncProviderConnector, syncProviderConnectorWithLookup } from "./provider-connectors";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function baseConnector(provider: ProviderConnector["provider"], baseUrl: string): ProviderConnector {
  return {
    id: provider,
    provider,
    label: "Hermes Agent",
    enabled: true,
    baseUrl,
    websocketUrl: undefined,
    runtimeBaseUrl: baseUrl,
    authMode: "none",
    tokenConfigured: false,
    capabilities: {
      agents: true,
      schedules: true,
      activeWork: true,
      launch: true,
      subscribe: true,
    },
    health: {
      provider,
      status: "idle",
      checkedAt: Date.now(),
      activeAgents: 0,
      schedules: 0,
      message: "idle",
    },
    lastSyncAt: undefined,
  };
}

test("syncProviderConnector returns disabled health when connector is disabled", async () => {
  const connector = baseConnector("hermes", "hermes");
  connector.enabled = false;

  const result = await syncProviderConnector(connector);

  assert.equal(result.health.status, "disabled");
  assert.equal(result.agents.length, 0);
  assert.equal(result.schedules.length, 0);
});

test("syncProviderConnector supports enabled local CLI connectors without a baseUrl", async () => {
  const connector = baseConnector("claude-local", "");
  const result = await syncProviderConnectorWithLookup(connector, () => ({
    type: "claude-local",
    label: "Claude Code",
    configFields: () => [],
    defaultConfig: () => ({ cliPath: "claude" }),
    testConnection: async () => ({ ok: true, message: "Claude CLI 1.2.3", latencyMs: 12 }),
    syncAgents: async () => [],
  }));

  assert.equal(result.health.status, "ok");
  assert.equal(result.health.message, "Claude CLI 1.2.3");
  assert.equal(result.agents.length, 0);
  assert.equal(result.schedules.length, 0);
});
