import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { hermesAdapter, openclawAdapter } from "./remote.js";

async function withServer(
  handler: http.RequestListener,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

test("openclawAdapter requires a webhook URL before health checks or runs", async () => {
  assert.deepEqual(await openclawAdapter.test({}), {
    ok: false,
    message: "Webhook URL is required.",
  });

  await assert.rejects(
    async () => {
      for await (const _chunk of openclawAdapter.run({
        prompt: "ship it",
        connectionConfig: {},
        agent: { id: "agent-1", name: "Agent", tools: [] },
      })) {
        // Exhaust the generator so validation errors are surfaced.
      }
    },
    /Webhook URL is required/u,
  );
});

test("openclawAdapter sends auth headers and agent payloads to the webhook", async () => {
  const requests: Array<{ url: string | undefined; authorization: string | undefined; body: string }> = [];

  await withServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });

      response.end(request.url === "/health" ? "ok" : "queued");
    });
  }, async (baseUrl) => {
    const health = await openclawAdapter.test({ webhookUrl: `${baseUrl}/`, apiKey: "secret" });
    assert.equal(health.ok, true);

    const chunks: string[] = [];
    for await (const chunk of openclawAdapter.run({
      prompt: "implement task",
      connectionConfig: { webhookUrl: baseUrl, apiKey: "secret" },
      agent: { id: "agent-1", name: "Agent", tools: ["read", "write"] },
    })) {
      chunks.push(chunk);
    }

    assert.equal(chunks.join(""), "queued");
    assert.equal(requests[0]?.url, "/health");
    assert.equal(requests[0]?.authorization, "Bearer secret");
    assert.equal(requests[1]?.url, "/");
    assert.equal(requests[1]?.authorization, "Bearer secret");
    assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), {
      agent: { id: "agent-1", name: "Agent", tools: ["read", "write"] },
      prompt: "implement task",
      tools: ["read", "write"],
    });
  });
});

test("hermesAdapter reports that local Hermes execution is externally managed", async () => {
  assert.equal((await hermesAdapter.test({})).ok, false);

  const chunks: string[] = [];
  for await (const chunk of hermesAdapter.run({
    prompt: "implement task",
    connectionConfig: {},
    agent: { id: "agent-1", name: "Agent", tools: [] },
  })) {
    chunks.push(chunk);
  }

  assert.match(chunks.join(""), /not implemented/u);
});
