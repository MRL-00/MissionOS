import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectName = `missionos-smoke-${process.pid}`;
const containerName = `missionos-compose-smoke-${process.pid}`;
const hostPort = String(6100 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${hostPort}`;
const startupTimeoutMs = 30000;
const tempDir = mkdtempSync(path.join(os.tmpdir(), "missionos-compose-smoke-"));
const overridePath = path.join(tempDir, "compose.override.yml");

writeFileSync(
  overridePath,
  [
    "services:",
    "  missionos:",
    `    container_name: ${containerName}`,
    "",
  ].join("\n"),
);

function compose(args) {
  return spawnSync("docker", ["compose", "-p", projectName, "-f", "docker-compose.yml", "-f", overridePath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      JWT_SECRET: "compose-smoke-secret-with-enough-length",
      MISSIONOS_HOST: "127.0.0.1",
      MISSIONOS_PORT: hostPort,
      VITE_DEPLOY_VERSION: "compose-smoke",
    },
  });
}

async function waitForServer(label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the container is ready or timeout expires.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const logs = compose(["logs", "missionos"]);
  throw new Error(`Timed out waiting for Compose smoke ${label} at ${baseUrl}.\n${logs.stdout}${logs.stderr}`);
}

async function requestJson(pathname, { body, expectedStatus = 200, method = "GET", token } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method,
  });
  const responseBody = await response.json().catch(() => null);
  if (response.status !== expectedStatus) {
    throw new Error(`${method} ${pathname} returned ${response.status}, expected ${expectedStatus}: ${JSON.stringify(responseBody)}`);
  }
  return responseBody;
}

function assertField(body, fieldPath, expectedValue) {
  const actualValue = fieldPath.split(".").reduce((value, key) => value?.[key], body);
  if (actualValue !== expectedValue) {
    throw new Error(`Expected ${fieldPath} to be ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
  }
}

function runCompose(args, label) {
  const result = compose(args);
  if (result.status !== 0) {
    throw new Error(`${label} failed.\n${result.stdout}${result.stderr}`);
  }
}

try {
  runCompose(["up", "--build", "--detach"], "Compose startup");
  await waitForServer("startup");

  const registered = await requestJson("/api/auth/register", {
    body: {
      username: "compose-smoke-user",
      password: "compose-smoke-password",
      displayName: "Compose Smoke User",
    },
    expectedStatus: 201,
    method: "POST",
  });
  assertField(registered, "user.username", "compose-smoke-user");

  await requestJson("/api/project", {
    body: { name: "Compose Smoke Project", description: "Verify Docker Compose volume persistence" },
    expectedStatus: 201,
    method: "POST",
    token: registered.token,
  });

  runCompose(["stop", "missionos"], "Compose stop");
  runCompose(["up", "--detach", "--no-build"], "Compose restart");
  await waitForServer("restart");

  const bootstrap = await requestJson("/api/bootstrap");
  assertField(bootstrap, "hasAccount", true);
  assertField(bootstrap, "hasProject", true);

  const login = await requestJson("/api/auth/login", {
    body: { username: "compose-smoke-user", password: "compose-smoke-password" },
    method: "POST",
  });
  const project = await requestJson("/api/project", { token: login.token });
  assertField(project, "project.name", "Compose Smoke Project");

  console.log(`Compose smoke passed at ${baseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  const logs = compose(["logs", "missionos"]);
  if (logs.stdout || logs.stderr) {
    console.error(`${logs.stdout}${logs.stderr}`);
  }
  process.exitCode = 1;
} finally {
  compose(["down", "--volumes", "--remove-orphans", "--timeout", "2"]);
  rmSync(tempDir, { force: true, recursive: true });
}
