const targetUrl = process.env.MISSIONOS_TARGET_URL;
const username = process.env.MISSIONOS_TARGET_USERNAME;
const password = process.env.MISSIONOS_TARGET_PASSWORD;

if (!targetUrl || !username || !password) {
  console.error("Usage: MISSIONOS_TARGET_URL=https://missionos.example MISSIONOS_TARGET_USERNAME=user MISSIONOS_TARGET_PASSWORD=pass pnpm smoke:target");
  process.exit(1);
}

const baseUrl = targetUrl.replace(/\/+$/u, "");

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

async function requestJson(pathname, { body, expectedStatus = 200, method = "GET", token } = {}) {
  const response = await request(pathname, {
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

async function assertHealth() {
  const response = await request("/api/health");
  if (!response.ok) {
    throw new Error(`/api/health returned ${response.status}`);
  }
  const body = await response.json();
  assertField(body, "ok", true);
}

async function assertAppShell() {
  const response = await request("/");
  if (!response.ok) {
    throw new Error(`/ returned ${response.status}`);
  }
  const body = await response.text();
  if (!body.includes("<title>MissionOS</title>") || !body.includes('<div id="app"></div>')) {
    throw new Error("/ did not return the MissionOS app shell.");
  }
}

async function assertAuthenticatedWorkflow() {
  const login = await requestJson("/api/auth/login", {
    body: { username, password },
    method: "POST",
  });
  assertToken(login.token, "Login");
  assertField(login, "user.username", username);

  const me = await requestJson("/api/auth/me", { token: login.token });
  assertField(me, "user.username", username);

  const project = await requestJson("/api/project", { token: login.token });
  if (!project.project?.name) {
    throw new Error(`/api/project did not return a configured project: ${JSON.stringify(project)}`);
  }

  const engines = await requestJson("/api/engines", { token: login.token });
  assertListIncludes(engines.engines, (engine) => engine?.id === "codex", "Codex engine");

  await requestJson("/api/agents?limit=1", { token: login.token });
  await requestJson("/api/missions?limit=1", { token: login.token });
  await requestJson("/api/issues?limit=1", { token: login.token });
  await requestJson("/api/schedules?limit=1", { token: login.token });

  const docs = await requestJson("/api/docs/tree", { token: login.token });
  assertListIncludes(docs.files, (item) => item?.path === "getting-started.md", "Getting started document");
  const doc = await requestJson("/api/docs/content?path=getting-started.md", { token: login.token });
  assertField(doc, "path", "getting-started.md");
}

try {
  await assertHealth();
  await assertAppShell();
  await assertAuthenticatedWorkflow();
  console.log(`Target smoke passed at ${baseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
