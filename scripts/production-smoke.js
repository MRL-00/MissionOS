import { spawn } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = String(4300 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;
const startupTimeoutMs = 15000;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(repoRoot, "server", "data");

const server = spawn("node", ["server/dist/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: port,
    NODE_ENV: "production",
    NODE_TEST_CONTEXT: "production-smoke",
    JWT_SECRET: "production-smoke-secret-with-enough-length",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
const serverExit = new Promise((resolve) => {
  server.once("exit", resolve);
});

server.stdout.on("data", (chunk) => {
  output += String(chunk);
});
server.stderr.on("data", (chunk) => {
  output += String(chunk);
});

async function stopServer() {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([serverExit, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (server.exitCode === null) {
      server.kill("SIGKILL");
      await serverExit;
    }
  }
}

function cleanSmokeDatabase() {
  if (!server.pid) {
    return;
  }

  const pattern = new RegExp(`^missionos-test-${server.pid}\\.db(?:-(?:shm|wal))?$`, "u");
  try {
    for (const entry of readdirSync(dataDir)) {
      if (pattern.test(entry)) {
        rmSync(path.join(dataDir, entry), { force: true });
      }
    }
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (server.exitCode !== null) {
      throw new Error(`Production server exited before smoke checks completed.\n${output}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the server is ready or the timeout expires.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for production server at ${baseUrl}.\n${output}`);
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

async function assertCoreTeamWorkflow(token) {
  const savedSettings = await requestJson("/api/settings", {
    body: [
      {
        key: "engine.codex",
        value: JSON.stringify({ codexPath: "/bin/echo", apiKey: "production-smoke-secret" }),
      },
    ],
    method: "PUT",
    token,
  });
  const savedCodexSettings = JSON.parse(savedSettings.settingsMap["engine.codex"] ?? "{}");
  assertField(savedCodexSettings, "codexPath", "/bin/echo");
  assertField(savedCodexSettings, "apiKey", "__missionos_configured_secret__");

  const reloadedSettings = await requestJson("/api/settings", { token });
  const reloadedCodexSettings = JSON.parse(reloadedSettings.settingsMap["engine.codex"] ?? "{}");
  assertField(reloadedCodexSettings, "apiKey", "__missionos_configured_secret__");

  const engines = await requestJson("/api/engines", { token });
  assertListIncludes(engines.engines, (engine) => engine?.id === "codex", "Codex engine");

  const engineTest = await requestJson("/api/engines/codex/test", {
    body: { config: { codexPath: "/bin/echo", apiKey: "__missionos_configured_secret__" } },
    method: "POST",
    token,
  });
  assertField(engineTest, "ok", true);

  const agent = await requestJson("/api/agents", {
    body: {
      name: "Smoke Agent",
      role: "Release verification",
      emoji: "SA",
      color: "#5E4AE3",
      engine: "codex",
      skills: ["verification"],
      tools: ["smoke"],
      connection_config: { codexPath: "/bin/echo", apiKey: "agent-smoke-secret" },
      external_config: true,
      soul_md: "Verify MissionOS release readiness.",
      agents_md: "Coordinate with the smoke mission team.",
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });
  assertField(agent, "agent.name", "Smoke Agent");
  assertField(agent, "agent.connection_config.apiKey", "__missionos_configured_secret__");

  const agentConnectionTest = await requestJson(`/api/agents/${encodeURIComponent(agent.agent.id)}/test`, {
    method: "POST",
    token,
  });
  assertField(agentConnectionTest, "ok", true);

  const deactivatedAgent = await requestJson(`/api/agents/${encodeURIComponent(agent.agent.id)}`, {
    body: {
      name: "Smoke Agent Edited",
      role: "Release verification edited",
      emoji: "SA",
      color: "#5E4AE3",
      engine: "codex",
      skills: ["verification", "editing"],
      tools: ["smoke"],
      connection_config: { codexPath: "/bin/echo", apiKey: "__missionos_configured_secret__" },
      external_config: true,
      active: false,
      soul_md: "Verify MissionOS release readiness.",
      agents_md: "Coordinate with the smoke mission team.",
    },
    method: "PUT",
    token,
  });
  assertField(deactivatedAgent, "agent.name", "Smoke Agent Edited");
  assertField(deactivatedAgent, "agent.active", false);
  assertField(deactivatedAgent, "agent.connection_config.apiKey", "__missionos_configured_secret__");

  const reactivatedAgent = await requestJson(`/api/agents/${encodeURIComponent(agent.agent.id)}`, {
    body: {
      name: "Smoke Agent",
      role: "Release verification",
      emoji: "SA",
      color: "#5E4AE3",
      engine: "codex",
      skills: ["verification"],
      tools: ["smoke"],
      connection_config: { codexPath: "/bin/echo", apiKey: "__missionos_configured_secret__" },
      external_config: true,
      active: true,
      soul_md: "Verify MissionOS release readiness.",
      agents_md: "Coordinate with the smoke mission team.",
    },
    method: "PUT",
    token,
  });
  assertField(reactivatedAgent, "agent.active", true);

  const agents = await requestJson("/api/agents?limit=10", { token });
  assertListIncludes(agents.agents, (item) => item?.id === agent.agent.id, "Created agent");

  const mission = await requestJson("/api/missions", {
    body: {
      title: "Smoke Mission",
      description: "Validate production core workflow",
      team_name: "Release",
      lead_agent_id: agent.agent.id,
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });
  assertField(mission, "mission.title", "Smoke Mission");

  const missions = await requestJson("/api/missions?limit=10", { token });
  assertListIncludes(missions.missions, (item) => item?.id === mission.mission.id, "Created mission");

  const missionStart = await requestJson(`/api/missions/${encodeURIComponent(mission.mission.id)}/start`, {
    method: "POST",
    token,
  });
  assertField(missionStart, "ok", true);
  const completedMissionStartRun = await waitForRun(token, missionStart.runId);
  if (completedMissionStartRun.status !== "complete" || !String(completedMissionStartRun.output ?? "").includes("Begin planning")) {
    throw new Error(`Mission start run did not complete with expected output: ${JSON.stringify(completedMissionStartRun)}`);
  }
  const activeMissions = await requestJson("/api/missions?limit=10", { token });
  assertListIncludes(activeMissions.missions, (item) => item?.id === mission.mission.id && item?.status === "active", "Started mission");

  const issue = await requestJson("/api/issues", {
    body: {
      title: "Smoke Issue",
      description: "Validate issue creation from production smoke",
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
  assertField(issue, "issue.title", "Smoke Issue");

  const issues = await requestJson(`/api/issues?mission_id=${encodeURIComponent(mission.mission.id)}&limit=10`, { token });
  assertListIncludes(issues.issues, (item) => item?.id === issue.issue.id, "Created issue");

  const updatedIssue = await requestJson(`/api/issues/${encodeURIComponent(issue.issue.id)}`, {
    body: {
      title: "Smoke Issue Updated",
      description: "Validate issue update and filtering from production smoke",
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
  assertField(updatedIssue, "issue.title", "Smoke Issue Updated");
  assertField(updatedIssue, "issue.status", "in_progress");
  assertField(updatedIssue, "issue.priority", "high");

  const filteredIssues = await requestJson(
    `/api/issues?mission_id=${encodeURIComponent(mission.mission.id)}&status=in_progress&priority=high&q=${encodeURIComponent("Updated")}&limit=10`,
    { token },
  );
  assertListIncludes(filteredIssues.issues, (item) => item?.id === issue.issue.id, "Updated filtered issue");

  const deletedIssue = await requestJson("/api/issues", {
    body: {
      title: "Smoke Delete Issue",
      description: "Validate issue deletion from production smoke",
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
  const deletedIssueSearch = await requestJson(`/api/issues?q=${encodeURIComponent("Smoke Delete Issue")}&limit=10`, { token });
  assertListExcludes(deletedIssueSearch.issues, (item) => item?.id === deletedIssue.issue.id, "Deleted issue");

  const comment = await requestJson(`/api/issues/${encodeURIComponent(issue.issue.id)}/comments`, {
    body: { body: "Smoke comment" },
    expectedStatus: 201,
    method: "POST",
    token,
  });
  assertField(comment, "comment.body", "Smoke comment");

  const comments = await requestJson(`/api/issues/${encodeURIComponent(issue.issue.id)}/comments?limit=10`, { token });
  assertListIncludes(comments.comments, (item) => item?.id === comment.comment.id, "Created issue comment");

  const schedule = await requestJson("/api/schedules", {
    body: {
      name: "Smoke Schedule",
      mission_id: mission.mission.id,
      agent_id: agent.agent.id,
      prompt: "Run a release smoke check",
      cron_expression: "0 9 * * *",
      enabled: false,
      max_runs: 1,
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });
  assertField(schedule, "schedule.name", "Smoke Schedule");

  const schedules = await requestJson(`/api/schedules?mission_id=${encodeURIComponent(mission.mission.id)}&limit=10`, { token });
  assertListIncludes(schedules.schedules, (item) => item?.id === schedule.schedule.id, "Created schedule");

  const scheduleRun = await requestJson(`/api/schedules/${encodeURIComponent(schedule.schedule.id)}/run`, {
    expectedStatus: 201,
    method: "POST",
    token,
  });
  assertField(scheduleRun, "schedule.id", schedule.schedule.id);
  const completedScheduleRun = await waitForRun(token, scheduleRun.run.id);
  if (completedScheduleRun.status !== "complete" || !String(completedScheduleRun.output ?? "").includes("Run a release smoke check")) {
    throw new Error(`Schedule run did not complete with expected output: ${JSON.stringify(completedScheduleRun)}`);
  }

  const run = await requestJson("/api/runs", {
    body: {
      agent_id: agent.agent.id,
      mission_id: mission.mission.id,
      issue_id: issue.issue.id,
      prompt: "Smoke run",
    },
    expectedStatus: 201,
    method: "POST",
    token,
  });
  assertField(run, "run.agent_id", agent.agent.id);
  const completedRun = await waitForRun(token, run.run.id);
  if (completedRun.status !== "complete" || !String(completedRun.output ?? "").includes("Smoke run")) {
    throw new Error(`Smoke run did not complete with expected output: ${JSON.stringify(completedRun)}`);
  }
  const runSnapshot = await readSseSnapshot(`/api/runs/${encodeURIComponent(run.run.id)}/stream`, token);
  assertField(runSnapshot, "type", "snapshot");
  assertField(runSnapshot, "status", "complete");

  const search = await requestJson("/api/search?q=Smoke", { token });
  assertListIncludes(search.agents, (item) => item?.id === agent.agent.id, "Agent search result");
  assertListIncludes(search.missions, (item) => item?.id === mission.mission.id, "Mission search result");
  assertListIncludes(search.issues, (item) => item?.id === issue.issue.id, "Issue search result");
  assertListIncludes(search.comments, (item) => item?.id === comment.comment.id, "Comment search result");
  assertListIncludes(search.runs, (item) => item?.id === run.run.id, "Run search result");

  const docs = await requestJson("/api/docs/tree", { token });
  assertListIncludes(docs.files, (item) => item?.path === "getting-started.md", "Getting started document");
  const doc = await requestJson("/api/docs/content?path=getting-started.md", { token });
  assertField(doc, "path", "getting-started.md");
  if (typeof doc.content !== "string" || !doc.content.includes("MissionOS")) {
    throw new Error("Getting started document did not include expected MissionOS content.");
  }

  const feedback = await requestJson("/api/feedback", {
    body: { type: "smoke", message: "Production smoke feedback" },
    expectedStatus: 201,
    method: "POST",
    token,
  });
  assertField(feedback, "feedback.type", "smoke");
  assertField(feedback, "feedback.message", "Production smoke feedback");

  const completedMission = await requestJson(`/api/missions/${encodeURIComponent(mission.mission.id)}`, {
    body: {
      title: "Smoke Mission",
      description: "Validate production core workflow",
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

  const password = "production-smoke-password";
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

  await requestJson("/api/auth/register", {
    body: {
      username: "second-user",
      password,
      displayName: "Second User",
    },
    expectedStatus: 403,
    method: "POST",
  });

  const me = await requestJson("/api/auth/me", { token: registered.token });
  assertField(me, "user.username", "smoke-user");

  const profile = await requestJson("/api/auth/profile", {
    body: { displayName: "Smoke Operator", avatarEmoji: "SO" },
    method: "PUT",
    token: registered.token,
  });
  assertField(profile, "user.displayName", "Smoke Operator");
  assertField(profile, "user.avatarEmoji", "SO");

  const project = await requestJson("/api/project", {
    body: { name: "Smoke Project", description: "Production first-run smoke" },
    expectedStatus: 201,
    method: "POST",
    token: registered.token,
  });
  assertField(project, "project.name", "Smoke Project");
  assertField(project, "project.description", "Production first-run smoke");

  const afterProjectBootstrap = await requestJson("/api/bootstrap");
  assertField(afterProjectBootstrap, "hasProject", true);

  const projectReload = await requestJson("/api/project", { token: registered.token });
  assertField(projectReload, "project.name", "Smoke Project");

  await assertCoreTeamWorkflow(registered.token);

  const login = await requestJson("/api/auth/login", {
    body: { username: "smoke-user", password },
    method: "POST",
  });
  assertToken(login.token, "Login");
  assertField(login, "user.username", "smoke-user");

  const newPassword = "production-smoke-new-password";
  await requestJson("/api/auth/password", {
    body: { currentPassword: password, newPassword },
    method: "PUT",
    token: login.token,
  });
  await requestJson("/api/auth/login", {
    body: { username: "smoke-user", password },
    expectedStatus: 401,
    method: "POST",
  });
  const relogin = await requestJson("/api/auth/login", {
    body: { username: "smoke-user", password: newPassword },
    method: "POST",
  });
  assertToken(relogin.token, "Login after password change");

  await requestJson("/api/project", {
    body: { confirmName: "Wrong Project" },
    expectedStatus: 400,
    method: "DELETE",
    token: relogin.token,
  });
  const reset = await requestJson("/api/project", {
    body: { confirmName: "Smoke Project" },
    method: "DELETE",
    token: relogin.token,
  });
  assertField(reset, "ok", true);
  assertField(reset, "bootstrap.hasAccount", false);
  assertField(reset, "bootstrap.hasProject", false);
  assertField(reset, "bootstrap.hasAgents", false);
}

try {
  await waitForServer();
  await assertHealth();
  await assertAppShell();
  await assertFirstRunFlow();
  console.log(`Production smoke passed at ${baseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await stopServer();
  cleanSmokeDatabase();
}
