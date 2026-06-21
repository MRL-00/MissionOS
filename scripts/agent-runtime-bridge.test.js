import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function bridgeUrl(port, pathname) {
  return `http://127.0.0.1:${port}${pathname}`;
}

async function waitForHealth(port, bridgeProcess) {
  const deadline = Date.now() + 5_000;
  let lastError;

  while (Date.now() < deadline) {
    if (bridgeProcess.exitCode !== null) {
      throw new Error(`Bridge exited before becoming healthy with code ${bridgeProcess.exitCode}`);
    }

    try {
      const response = await fetch(bridgeUrl(port, "/health"));
      if (response.ok) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for bridge health");
}

async function stopBridge(bridgeProcess) {
  if (bridgeProcess.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => {
    bridgeProcess.once("exit", resolve);
  });
  bridgeProcess.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);

  if (bridgeProcess.exitCode === null) {
    bridgeProcess.kill("SIGKILL");
    await exited;
  }
}

test("agent runtime bridge reports health and handles spawn requests", async () => {
  const port = 42_000 + Math.floor(Math.random() * 1_000);
  const output = [];
  const bridgeProcess = spawn(process.execPath, ["--import", "tsx", "scripts/agent-runtime-bridge.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AGENT_BRIDGE_CODEX_COMMAND: `${process.execPath} -e "process.exit(0)"`,
      AGENT_BRIDGE_HOST: "127.0.0.1",
      AGENT_BRIDGE_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  bridgeProcess.stdout.on("data", (chunk) => output.push(chunk.toString()));
  bridgeProcess.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    const healthResponse = await waitForHealth(port, bridgeProcess);
    const health = await healthResponse.json();

    assert.equal(health.ok, true);
    assert.equal(health.host, "127.0.0.1");
    assert.equal(health.port, port);
    assert.deepEqual(health.configuredProviders, ["codex"]);

    const invalidResponse = await fetch(bridgeUrl(port, "/api/office/spawn"), {
      body: JSON.stringify({ provider: "codex" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(await invalidResponse.json(), { error: "Invalid spawn payload" });

    const launchResponse = await fetch(bridgeUrl(port, "/api/office/spawn"), {
      body: JSON.stringify({
        officeAgentId: "agent-1",
        officeAgentName: "Codex Agent",
        officeAgentRole: "Engineer",
        provider: "codex",
        task: "Verify bridge launch",
        message: "Run a no-op command",
        launchProfile: "test",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const launchBody = await launchResponse.json();

    assert.equal(launchResponse.status, 200);
    assert.equal(launchBody.ok, true);
    assert.equal(launchBody.provider, "codex");
    assert.equal(launchBody.officeAgentId, "agent-1");
    assert.equal(launchBody.launchProfile, "test");
    assert.equal(typeof launchBody.pid, "number");

    const missingProviderResponse = await fetch(bridgeUrl(port, "/api/office/spawn"), {
      body: JSON.stringify({
        officeAgentId: "agent-2",
        officeAgentName: "Claude Agent",
        officeAgentRole: "Engineer",
        provider: "claude",
        task: "Verify missing provider",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const missingProviderBody = await missingProviderResponse.json();

    assert.equal(missingProviderResponse.status, 500);
    assert.match(missingProviderBody.error, /AGENT_BRIDGE_CLAUDE_COMMAND/u);
  } finally {
    await stopBridge(bridgeProcess);
  }

  assert.doesNotMatch(output.join(""), /EADDRINUSE|UnhandledPromiseRejection/u);
});
