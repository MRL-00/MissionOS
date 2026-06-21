import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { httpHealthcheck, httpRun, streamProcess } from "./shared.js";

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

test("httpHealthcheck returns version metadata from JSON responses", async () => {
  await withServer((_, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ version: "1.2.3", latestVersion: "1.2.4" }));
  }, async (baseUrl) => {
    const result = await httpHealthcheck(`${baseUrl}/health`);

    assert.equal(result.ok, true);
    assert.equal(result.currentVersion, "1.2.3");
    assert.equal(result.latestVersion, "1.2.4");
    assert.equal(result.updateAvailable, true);
  });
});

test("httpHealthcheck includes failure status and response text", async () => {
  await withServer((_, response) => {
    response.statusCode = 503;
    response.statusMessage = "Service Unavailable";
    response.end("offline");
  }, async (baseUrl) => {
    const result = await httpHealthcheck(`${baseUrl}/health`);

    assert.equal(result.ok, false);
    assert.equal(result.message, "503 Service Unavailable: offline");
  });
});

test("httpRun yields successful response text and rejects errors", async () => {
  await withServer((request, response) => {
    if (request.url === "/fail") {
      response.statusCode = 400;
      response.statusMessage = "Bad Request";
      response.end("invalid");
      return;
    }

    response.end("accepted");
  }, async (baseUrl) => {
    const chunks: string[] = [];
    for await (const chunk of httpRun(`${baseUrl}/run`, { method: "POST" })) {
      chunks.push(chunk);
    }

    assert.deepEqual(chunks, ["accepted"]);
    await assert.rejects(
      async () => {
        for await (const _chunk of httpRun(`${baseUrl}/fail`, { method: "POST" })) {
          // Exhaust the generator so the request error is surfaced.
        }
      },
      /400 Bad Request: invalid/u,
    );
  });
});

test("streamProcess ignores EPIPE when a successful command closes stdin early", async () => {
  const chunks: string[] = [];
  for await (const chunk of streamProcess(process.execPath, ["-e", "process.exit(0)"], {
    stdin: "x".repeat(1_000_000),
  })) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, []);
});
