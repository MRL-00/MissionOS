import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ProviderConnector } from "../src/mission/types";
import { syncProviderConnector } from "./provider-connectors";

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
    syncIntervalMs: 0,
    authMode: "none",
    tokenConfigured: false,
    capabilities: {
      agents: true,
      schedules: true,
      activeWork: true,
      launch: true,
      subscribe: false,
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
