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
    provider,
    label: provider === "openclaw" ? "OpenClaw" : "Hermes Agent",
    enabled: true,
    baseUrl,
    websocketUrl: undefined,
    runtimeBaseUrl: baseUrl,
    syncIntervalMs: 5000,
    authMode: "none",
    tokenConfigured: false,
    capabilities: {
      agents: true,
      schedules: true,
      activeWork: true,
      launch: true,
      subscribe: provider === "openclaw",
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

test("syncProviderConnector normalizes OpenClaw sessions, roster, and schedules", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith("/health")) {
      return jsonResponse({ ok: true });
    }
    if (url.includes("/api/sessions")) {
      return jsonResponse({
        sessions: [
          {
            sessionKey: "agent:pickle",
            agentId: "pickle",
            status: "active",
            task: "Review mission metrics",
            label: "Pickle main",
          },
        ],
      });
    }
    if (url.endsWith("/api/agents")) {
      return jsonResponse({
        agents: [
          {
            id: "pickle",
            name: "Pickle",
            role: "Orchestrator",
            status: "working",
          },
          {
            id: "zoe",
            name: "Zoe",
            role: "Engineer",
            status: "idle",
          },
        ],
      });
    }
    if (url.endsWith("/api/schedules")) {
      return jsonResponse({
        schedules: [
          {
            id: "daily-review",
            name: "Daily Review",
            recurrence: "0 9 * * 1-5",
            nextRunAt: "2026-03-30T09:00:00.000Z",
            status: "scheduled",
            agentId: "pickle",
          },
        ],
      });
    }

    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  const result = await syncProviderConnector(baseConnector("openclaw", "http://openclaw.local"));

  assert.equal(result.health.status, "ok");
  assert.equal(result.agents.length, 2);
  assert.equal(result.agents[0]?.externalId, "pickle");
  assert.equal(result.agents[0]?.task, "Review mission metrics");
  assert.equal(result.schedules.length, 1);
  assert.equal(result.schedules[0]?.name, "Daily Review");
});

test("syncProviderConnector merges Hermes active work into roster entries", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith("/health")) {
      return jsonResponse({ ok: true });
    }
    if (url.endsWith("/api/agents")) {
      return jsonResponse({
        agents: [
          {
            id: "atlas",
            name: "Atlas",
            role: "Planner",
            status: "idle",
          },
        ],
      });
    }
    if (url.endsWith("/api/active-work")) {
      return jsonResponse({
        agents: [
          {
            id: "atlas",
            name: "Atlas",
            status: "running",
            task: "Triage Linear backlog",
          },
        ],
      });
    }
    if (url.endsWith("/api/schedules")) {
      return jsonResponse({ schedules: [] });
    }

    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  const result = await syncProviderConnector(baseConnector("hermes", "http://hermes.local"));

  assert.equal(result.health.status, "ok");
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0]?.status, "working");
  assert.equal(result.agents[0]?.task, "Triage Linear backlog");
});

test("syncProviderConnector sends bearer tokens from connector config", async () => {
  const authorizationHeaders: string[] = [];

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    authorizationHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");

    const url = String(_input);
    if (url.endsWith("/health")) {
      return jsonResponse({ ok: true });
    }
    if (url.includes("/api/sessions")) {
      return jsonResponse({ sessions: [] });
    }
    if (url.endsWith("/api/agents") || url.endsWith("/api/schedules")) {
      return jsonResponse({ agents: [], schedules: [] });
    }

    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  await syncProviderConnector({
    ...baseConnector("openclaw", "http://openclaw.local"),
    authMode: "bearer",
    tokenConfigured: true,
    token: "openclaw-secret",
  });

  assert.ok(authorizationHeaders.length > 0);
  assert.ok(authorizationHeaders.every((value) => value === "Bearer openclaw-secret"));
});

test("syncProviderConnector parses OpenClaw tool invocation session results", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith("/health")) {
      return jsonResponse({ ok: true });
    }
    if (url.includes("/api/sessions") || url.endsWith("/api/agents") || url.endsWith("/api/schedules")) {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (url.endsWith("/tools/invoke")) {
      return jsonResponse({
        ok: true,
        result: {
          details: {
            count: 1,
            sessions: [
              {
                key: "agent:main:cron:abc123",
                label: "Cron: The Office",
                status: "running",
                messages: [
                  {
                    role: "assistant",
                    content: [
                      { type: "text", text: "Done." },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });
    }

    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  const result = await syncProviderConnector(baseConnector("openclaw", "http://openclaw.local"));

  assert.equal(result.health.status, "ok");
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0]?.externalId, "main");
  assert.equal(result.agents[0]?.status, "working");
  assert.equal(result.agents[0]?.task, "Done.");
});

test("syncProviderConnector retries OpenClaw sessions with a wider activity window", async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/health")) {
      return jsonResponse({ ok: true });
    }
    if (url.includes("/api/sessions") || url.endsWith("/api/agents") || url.endsWith("/api/schedules")) {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (url.endsWith("/tools/invoke")) {
      const body = typeof init?.body === "string" ? init.body : "";
      const payload = JSON.parse(body) as { args?: { activeMinutes?: number } };
      const activeMinutes = payload.args?.activeMinutes ?? 0;

      return jsonResponse({
        ok: true,
        result: {
          details: {
            count: activeMinutes >= 60 ? 1 : 0,
            sessions: activeMinutes >= 60
              ? [
                  {
                    key: "agent:main:cron:abc123",
                    label: "Cron: The Office",
                    status: "running",
                    messages: [
                      {
                        role: "assistant",
                        content: [
                          { type: "text", text: "Done." },
                        ],
                      },
                    ],
                  },
                ]
              : [],
          },
        },
      });
    }

    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  const result = await syncProviderConnector(baseConnector("openclaw", "http://openclaw.local"));

  assert.equal(result.health.status, "ok");
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0]?.externalId, "main");
});
