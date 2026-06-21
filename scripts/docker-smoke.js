import { spawn, spawnSync } from "node:child_process";

const image = process.env.MISSIONOS_DOCKER_IMAGE ?? "missionos:ci";
const hostPort = String(5300 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${hostPort}`;
const startupTimeoutMs = 20000;

const containerName = `missionos-smoke-${process.pid}`;

function docker(args) {
  return spawnSync("docker", args, { encoding: "utf8" });
}

const imageInspect = docker(["image", "inspect", image]);
if (imageInspect.status !== 0) {
  console.error(
    `Docker image ${image} was not found locally. Build it first with: docker build --build-arg VITE_DEPLOY_VERSION=ci -t ${image} .`,
  );
  process.exit(1);
}

docker(["rm", "--force", containerName]);

const run = spawnSync(
  "docker",
  [
    "run",
    "--detach",
    "--name",
    containerName,
    "--publish",
    `127.0.0.1:${hostPort}:3001`,
    "--env",
    "JWT_SECRET=docker-smoke-secret-with-enough-length",
    image,
  ],
  { encoding: "utf8" },
);

if (run.status !== 0) {
  console.error(run.stderr || run.stdout);
  process.exit(run.status ?? 1);
}

async function waitForContainer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    const inspect = docker(["inspect", "--format", "{{.State.Running}}", containerName]);
    if (inspect.status !== 0 || inspect.stdout.trim() !== "true") {
      const logs = docker(["logs", containerName]);
      throw new Error(`Docker container exited before smoke checks completed.\n${logs.stdout}${logs.stderr}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the container is ready or the timeout expires.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const logs = docker(["logs", containerName]);
  throw new Error(`Timed out waiting for Docker smoke container at ${baseUrl}.\n${logs.stdout}${logs.stderr}`);
}

async function assertHealth() {
  const response = await fetch(`${baseUrl}/api/health`);
  if (!response.ok) {
    throw new Error(`/api/health returned ${response.status}`);
  }

  const body = await response.json();
  if (body?.ok !== true) {
    throw new Error(`/api/health returned unexpected body: ${JSON.stringify(body)}`);
  }
}

async function assertAppShell() {
  const response = await fetch(baseUrl);
  if (!response.ok) {
    throw new Error(`/ returned ${response.status}`);
  }

  const expectedHeaders = {
    "cache-control": "no-cache, max-age=0, must-revalidate",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
  for (const [name, expectedValue] of Object.entries(expectedHeaders)) {
    const actualValue = response.headers.get(name);
    if (actualValue !== expectedValue) {
      throw new Error(`/ returned unexpected ${name} header: ${actualValue ?? "<missing>"}`);
    }
  }

  const body = await response.text();
  if (!body.includes("<title>MissionOS</title>") || !body.includes('<div id="app"></div>')) {
    throw new Error("/ did not return the built MissionOS app shell.");
  }
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

async function readSseSnapshot(pathname, token) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${pathname} stream returned ${response.status}`);
  }
  const text = await response.text();
  const line = text.split("\n").find((entry) => entry.startsWith("data:"));
  if (!line) {
    throw new Error(`${pathname} did not return an SSE data event.`);
  }
  return JSON.parse(line.replace(/^data:\s?/u, ""));
}

function assertField(body, fieldPath, expectedValue) {
  const actualValue = fieldPath.split(".").reduce((value, key) => value?.[key], body);
  if (actualValue !== expectedValue) {
    throw new Error(`Expected ${fieldPath} to be ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
  }
}

function assertToken(value, label) {
  if (typeof value !== "string" || value.length < 32) {
    throw new Error(`${label} did not return a valid token.`);
  }
}

async function waitForRun(token, runId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await requestJson(`/api/runs/${encodeURIComponent(runId)}`, { token });
    if (response.run?.status === "complete" || response.run?.status === "failed") {
      return response.run;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for run ${runId} to finish.`);
}

function assertListIncludes(list, predicate, label) {
  if (!Array.isArray(list) || !list.some(predicate)) {
    throw new Error(`${label} was not found in ${JSON.stringify(list)}`);
  }
}

function assertListExcludes(list, predicate, label) {
  if (!Array.isArray(list)) {
    throw new Error(`${label} list was not an array: ${JSON.stringify(list)}`);
  }
  if (list.some(predicate)) {
    throw new Error(`${label} was unexpectedly found in ${JSON.stringify(list)}`);
  }
}

async function assertCoreTeamWorkflow(token) {
  const savedSettings = await requestJson("/api/settings", {
    body: [
      {
        key: "engine.codex",
        value: JSON.stringify({ codexPath: "/bin/echo", apiKey: "docker-smoke-secret" }),
      },
    ],
    method: "PUT",
    token,
  });
  const savedCodexSettings = JSON.parse(savedSettings.settingsMap["engine.codex"] ?? "{}");
  assertField(savedCodexSettings, "apiKey", "__missionos_configured_secret__");

  const engineTest = await requestJson("/api/engines/codex/test", {
    body: { config: { codexPath: "/bin/echo", apiKey: "__missionos_configured_secret__" } },
    method: "POST",
    token,
  });
  assertField(engineTest, "ok", true);

  const agent = await requestJson("/api/agents", {
    body: {
      name: "Docker Smoke Agent",
      role: "Release verification",
      emoji: "DS",
      color: "#5E4AE3",
      engine: "codex",
      skills: ["verification"],
      tools: ["smoke"],
      connection_config: { codexPath: "/bin/echo", apiKey: "agent-docker-secret" },
      external_config: true,
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });
  assertField(agent, "agent.connection_config.apiKey", "__missionos_configured_secret__");

  const agentConnectionTest = await requestJson(`/api/agents/${encodeURIComponent(agent.agent.id)}/test`, {
    method: "POST",
    token,
  });
  assertField(agentConnectionTest, "ok", true);

  const deactivatedAgent = await requestJson(`/api/agents/${encodeURIComponent(agent.agent.id)}`, {
    body: {
      name: "Docker Smoke Agent",
      role: "Release verification",
      emoji: "DS",
      color: "#5E4AE3",
      engine: "codex",
      skills: ["verification"],
      tools: ["smoke"],
      connection_config: { codexPath: "/bin/echo", apiKey: "__missionos_configured_secret__" },
      external_config: true,
      active: false,
    },
    method: "PUT",
    token,
  });
  assertField(deactivatedAgent, "agent.active", false);

  await requestJson(`/api/agents/${encodeURIComponent(agent.agent.id)}`, {
    body: {
      name: "Docker Smoke Agent",
      role: "Release verification",
      emoji: "DS",
      color: "#5E4AE3",
      engine: "codex",
      skills: ["verification"],
      tools: ["smoke"],
      connection_config: { codexPath: "/bin/echo", apiKey: "__missionos_configured_secret__" },
      external_config: true,
      active: true,
    },
    method: "PUT",
    token,
  });

  const mission = await requestJson("/api/missions", {
    body: {
      title: "Docker Smoke Mission",
      description: "Validate Docker core workflow",
      team_name: "Release",
      lead_agent_id: agent.agent.id,
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });

  const missionStart = await requestJson(`/api/missions/${encodeURIComponent(mission.mission.id)}/start`, {
    method: "POST",
    token,
  });
  assertField(missionStart, "ok", true);
  const completedMissionStartRun = await waitForRun(token, missionStart.runId);
  if (completedMissionStartRun.status !== "complete" || !String(completedMissionStartRun.output ?? "").includes("Begin planning")) {
    throw new Error(`Docker mission start run did not complete with expected output: ${JSON.stringify(completedMissionStartRun)}`);
  }
  const missions = await requestJson("/api/missions?limit=10", { token });
  assertListIncludes(missions.missions, (item) => item?.id === mission.mission.id && item?.status === "active", "Started mission");

  const issue = await requestJson("/api/issues", {
    body: {
      title: "Docker Smoke Issue",
      description: "Validate Docker issue creation",
      status: "todo",
      priority: "medium",
      assignee_agent_id: agent.agent.id,
      mission_id: mission.mission.id,
      labels: ["smoke"],
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });

  const updatedIssue = await requestJson(`/api/issues/${encodeURIComponent(issue.issue.id)}`, {
    body: {
      title: "Docker Smoke Issue Updated",
      description: "Validate Docker issue update and filtering",
      status: "in_progress",
      priority: "high",
      assignee_agent_id: agent.agent.id,
      mission_id: mission.mission.id,
      labels: ["smoke", "updated"],
      estimation: "1h",
    },
    method: "PUT",
    token,
  });
  assertField(updatedIssue, "issue.title", "Docker Smoke Issue Updated");
  assertField(updatedIssue, "issue.status", "in_progress");
  assertField(updatedIssue, "issue.priority", "high");

  const filteredIssues = await requestJson(
    `/api/issues?mission_id=${encodeURIComponent(mission.mission.id)}&status=in_progress&priority=high&q=${encodeURIComponent("Updated")}&limit=10`,
    { token },
  );
  assertListIncludes(filteredIssues.issues, (item) => item?.id === issue.issue.id, "Updated filtered issue");

  const deletedIssue = await requestJson("/api/issues", {
    body: {
      title: "Docker Smoke Delete Issue",
      description: "Validate Docker issue deletion",
      status: "todo",
      priority: "low",
      assignee_agent_id: agent.agent.id,
      mission_id: mission.mission.id,
      labels: ["smoke-delete"],
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });
  await requestJson(`/api/issues/${encodeURIComponent(deletedIssue.issue.id)}`, {
    method: "DELETE",
    token,
  });
  const deletedIssueSearch = await requestJson(`/api/issues?q=${encodeURIComponent("Docker Smoke Delete Issue")}&limit=10`, { token });
  assertListExcludes(deletedIssueSearch.issues, (item) => item?.id === deletedIssue.issue.id, "Deleted issue");

  const schedule = await requestJson("/api/schedules", {
    body: {
      name: "Docker Smoke Schedule",
      mission_id: mission.mission.id,
      agent_id: agent.agent.id,
      prompt: "Run a Docker smoke check",
      cron_expression: "0 9 * * *",
      enabled: false,
      max_runs: 1,
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });

  const search = await requestJson("/api/search?q=Docker%20Smoke", { token });
  assertListIncludes(search.agents, (item) => item?.id === agent.agent.id, "Agent search result");
  assertListIncludes(search.missions, (item) => item?.id === mission.mission.id, "Mission search result");
  assertListIncludes(search.issues, (item) => item?.id === issue.issue.id, "Issue search result");

  const schedules = await requestJson(`/api/schedules?mission_id=${encodeURIComponent(mission.mission.id)}&limit=10`, { token });
  assertListIncludes(schedules.schedules, (item) => item?.id === schedule.schedule.id, "Created schedule");

  const scheduleRun = await requestJson(`/api/schedules/${encodeURIComponent(schedule.schedule.id)}/run`, {
    expectedStatus: 201,
    method: "POST",
    token,
  });
  const completedScheduleRun = await waitForRun(token, scheduleRun.run.id);
  if (completedScheduleRun.status !== "complete" || !String(completedScheduleRun.output ?? "").includes("Run a Docker smoke check")) {
    throw new Error(`Docker schedule run did not complete with expected output: ${JSON.stringify(completedScheduleRun)}`);
  }

  const run = await requestJson("/api/runs", {
    body: {
      agent_id: agent.agent.id,
      mission_id: mission.mission.id,
      issue_id: issue.issue.id,
      prompt: "Docker Smoke run",
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });
  const completedRun = await waitForRun(token, run.run.id);
  if (completedRun.status !== "complete" || !String(completedRun.output ?? "").includes("Docker Smoke run")) {
    throw new Error(`Docker smoke run did not complete with expected output: ${JSON.stringify(completedRun)}`);
  }
  const runSnapshot = await readSseSnapshot(`/api/runs/${encodeURIComponent(run.run.id)}/stream`, token);
  assertField(runSnapshot, "type", "snapshot");
  assertField(runSnapshot, "status", "complete");

  const completedMission = await requestJson(`/api/missions/${encodeURIComponent(mission.mission.id)}`, {
    body: {
      title: "Docker Smoke Mission",
      description: "Validate Docker core workflow",
      status: "complete",
      team_name: "Release",
      lead_agent_id: agent.agent.id,
    },
    method: "PUT",
    token,
  });
  assertField(completedMission, "mission.status", "complete");
}

async function assertFirstRunFlow() {
  const initialBootstrap = await requestJson("/api/bootstrap");
  assertField(initialBootstrap, "hasAccount", false);
  assertField(initialBootstrap, "hasProject", false);
  assertField(initialBootstrap, "hasAgents", false);

  await requestJson("/api/project", { expectedStatus: 401 });

  const password = "docker-smoke-password";
  const registered = await requestJson("/api/auth/register", {
    body: {
      username: "smoke-user",
      password,
      displayName: "Smoke User",
    },
    expectedStatus: 201,
    method: "POST",
  });
  assertToken(registered.token, "Registration");
  assertField(registered, "user.username", "smoke-user");
  assertField(registered, "user.displayName", "Smoke User");

  const afterRegistrationBootstrap = await requestJson("/api/bootstrap");
  assertField(afterRegistrationBootstrap, "hasAccount", true);
  assertField(afterRegistrationBootstrap, "hasProject", false);

  const project = await requestJson("/api/project", {
    body: { name: "Docker Smoke Project", description: "Docker first-run smoke" },
    expectedStatus: 201,
    method: "POST",
    token: registered.token,
  });
  assertField(project, "project.name", "Docker Smoke Project");

  const login = await requestJson("/api/auth/login", {
    body: { username: "smoke-user", password },
    method: "POST",
  });
  assertToken(login.token, "Login");

  await assertCoreTeamWorkflow(login.token);

  const reset = await requestJson("/api/project", {
    body: { confirmName: "Docker Smoke Project" },
    method: "DELETE",
    token: login.token,
  });
  assertField(reset, "ok", true);
  assertField(reset, "bootstrap.hasAccount", false);
  assertField(reset, "bootstrap.hasProject", false);
}

try {
  await waitForContainer();
  await assertHealth();
  await assertAppShell();
  await assertFirstRunFlow();
  console.log(`Docker smoke passed at ${baseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  const logs = docker(["logs", containerName]);
  if (logs.stdout || logs.stderr) {
    console.error(`${logs.stdout}${logs.stderr}`);
  }
  process.exitCode = 1;
} finally {
  const stop = spawn("docker", ["stop", "--time", "2", containerName], { stdio: "ignore" });
  await new Promise((resolve) => stop.once("exit", resolve));
  const remove = spawn("docker", ["rm", "--force", containerName], { stdio: "ignore" });
  await new Promise((resolve) => remove.once("exit", resolve));
}
