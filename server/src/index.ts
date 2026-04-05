import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { asFlag, getDb, parseJson, resetDatabase } from "./db.js";
import { getJwtSecret, getPort, loadServerEnv } from "./env.js";
import { engineAdapters, engineMap } from "./engines/index.js";
import {
  testGitHubConnection,
  listGitHubRepos,
  listGitHubIssues,
  createGitHubPR,
  syncGitHubIssuesToLocal,
} from "./github-service.js";
import {
  ensureRepo,
  createFeatureBranch,
  pushBranch,
  makeBranchName,
} from "./git-workspace.js";
import { getNextRunAt, validateCronExpression } from "./schedules.js";

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  avatar_emoji: string | null;
  created_at: string;
};

type AuthenticatedRequest = Request & { user?: UserRow };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const docsRoot = path.join(repoRoot, "docs");

const app = express();
const runSubscribers = new Map<string, Set<Response>>();
const activeScheduledRuns = new Set<string>();
let scheduleLoopTimer: NodeJS.Timeout | null = null;
let scheduleLoopInFlight = false;

loadServerEnv();
getDb();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

function serializeUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarEmoji: row.avatar_emoji ?? "👤",
    createdAt: row.created_at,
  };
}

function serializeAgent(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    emoji: row.emoji,
    color: row.color,
    engine: row.engine,
    skills: parseJson<string[]>(typeof row.skills === "string" ? row.skills : null, []),
    tools: parseJson<string[]>(typeof row.tools === "string" ? row.tools : null, []),
    connection_type: row.connection_type,
    connection_config: parseJson<Record<string, unknown>>(
      typeof row.connection_config === "string" ? row.connection_config : null,
      {},
    ),
    soul_md: row.soul_md,
    agents_md: row.agents_md,
    external_config: asFlag(typeof row.external_config === "number" ? row.external_config : 0),
    active: asFlag(typeof row.active === "number" ? row.active : 0),
    created_at: row.created_at,
    position: {
      x: Number(row.pos_x ?? 0),
      y: Number(row.pos_y ?? 0),
    },
  };
}

function serializeMission(row: Record<string, unknown>, assignedAgents: unknown[]) {
  const totalIssues = Number(row.total_issues ?? 0);
  const doneIssues = Number(row.done_issues ?? 0);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    lead_agent_id: row.lead_agent_id,
    lead_agent_name: row.lead_agent_name,
    lead_agent_emoji: row.lead_agent_emoji,
    linear_project_id: row.linear_project_id,
    github_repo: row.github_repo ?? null,
    github_default_branch: row.github_default_branch ?? "main",
    created_at: row.created_at,
    updated_at: row.updated_at,
    assigned_agents: assignedAgents,
    issue_counts: {
      total: totalIssues,
      complete: doneIssues,
    },
    progress: totalIssues > 0 ? Math.round((doneIssues / totalIssues) * 100) : 0,
    last_active_at: row.last_active_at ?? row.updated_at,
  };
}

function serializeIssue(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignee_agent_id: row.assignee_agent_id,
    mission_id: row.mission_id,
    labels: parseJson<string[]>(typeof row.labels === "string" ? row.labels : null, []),
    source: row.source,
    linear_id: row.linear_id,
    github_id: row.github_id ?? null,
    github_number: row.github_number ?? null,
    github_repo: row.github_repo ?? null,
    github_branch: row.github_branch ?? null,
    github_pr_number: row.github_pr_number ?? null,
    github_pr_url: row.github_pr_url ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    assignee_name: row.assignee_name,
    assignee_emoji: row.assignee_emoji,
    mission_title: row.mission_title,
  };
}

function serializeRun(row: Record<string, unknown>) {
  return {
    id: row.id,
    agent_id: row.agent_id,
    mission_id: row.mission_id,
    issue_id: row.issue_id,
    schedule_id: row.schedule_id ?? null,
    engine: row.engine,
    status: row.status,
    prompt: row.prompt,
    output: row.output,
    tool_calls: parseJson<string[]>(typeof row.tool_calls === "string" ? row.tool_calls : null, []),
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms,
    working_directory: row.working_directory ?? null,
    github_branch: row.github_branch ?? null,
    github_pr_url: row.github_pr_url ?? null,
    agent_name: row.agent_name,
    agent_emoji: row.agent_emoji,
    mission_title: row.mission_title,
    issue_title: row.issue_title,
  };
}

function serializeSchedule(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    agent_id: row.agent_id,
    prompt: row.prompt,
    cron_expression: row.cron_expression,
    enabled: asFlag(typeof row.enabled === "number" ? row.enabled : 0),
    max_runs: typeof row.max_runs === "number" ? row.max_runs : null,
    run_count: Number(row.run_count ?? 0),
    last_run_at: row.last_run_at ?? null,
    next_run_at: row.next_run_at ?? null,
    last_error: row.last_error ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    agent_name: row.agent_name ?? null,
    agent_emoji: row.agent_emoji ?? null,
  };
}

function formatSqliteDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function computeNextRunAt(expression: string, from: Date): string | null {
  const next = getNextRunAt(expression, from);
  return next ? formatSqliteDateTime(next) : null;
}

function normalizeScheduleMaxRuns(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error("max_runs must be a positive whole number.");
  }

  return numeric;
}

function parseScheduleInput(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const cronExpression = typeof body.cron_expression === "string" ? body.cron_expression.trim() : "";
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
  const maxRuns = normalizeScheduleMaxRuns(body.max_runs);

  if (!name) {
    throw new Error("Schedule name is required.");
  }
  if (!agentId) {
    throw new Error("agent_id is required.");
  }
  if (!prompt) {
    throw new Error("prompt is required.");
  }
  if (!cronExpression) {
    throw new Error("cron_expression is required.");
  }

  const cronError = validateCronExpression(cronExpression);
  if (cronError) {
    throw new Error(cronError);
  }

  return { name, agentId, prompt, cronExpression, enabled, maxRuns };
}

function publishRunEvent(runId: string, payload: Record<string, unknown>): void {
  const subscribers = runSubscribers.get(runId);
  if (!subscribers) {
    return;
  }

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const subscriber of subscribers) {
    subscriber.write(data);
  }
}

function getBootstrapState() {
  const db = getDb();
  const hasAccount = Number((db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count) > 0;
  const hasAgents = Number((db.prepare("SELECT COUNT(*) AS count FROM agents").get() as { count: number }).count) > 0;
  const hasProject =
    Number((db.prepare("SELECT COUNT(*) AS count FROM project").get() as { count: number }).count) > 0;
  return { hasAccount, hasAgents, hasProject };
}

function signToken(user: UserRow): string {
  return jwt.sign({ sub: user.id, username: user.username }, getJwtSecret(), { expiresIn: "7d" });
}

function buildRunPrompt(agentRow: Record<string, unknown>, prompt: string): string {
  if (asFlag(typeof agentRow.external_config === "number" ? agentRow.external_config : 0)) {
    return prompt;
  }

  const soul = typeof agentRow.soul_md === "string" ? agentRow.soul_md : "";
  const agents = typeof agentRow.agents_md === "string" ? agentRow.agents_md : "";
  return `[SOUL]\n${soul}\n\n[AGENTS]\n${agents}\n\n[TASK]\n${prompt}`;
}

function listAgents() {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT agents.*, agent_positions.x AS pos_x, agent_positions.y AS pos_y
      FROM agents
      LEFT JOIN agent_positions ON agent_positions.agent_id = agents.id
      ORDER BY agents.created_at ASC
      `,
    )
    .all()
    .map((row) => serializeAgent(row as Record<string, unknown>));
}

function listMissions() {
  const db = getDb();
  const missions = db
    .prepare(
      `
      SELECT
        missions.*,
        lead.name AS lead_agent_name,
        lead.emoji AS lead_agent_emoji,
        COUNT(DISTINCT issues.id) AS total_issues,
        COUNT(DISTINCT CASE WHEN issues.status = 'done' OR issues.status = 'complete' THEN issues.id END) AS done_issues,
        MAX(runs.started_at) AS last_active_at
      FROM missions
      LEFT JOIN agents AS lead ON lead.id = missions.lead_agent_id
      LEFT JOIN issues ON issues.mission_id = missions.id
      LEFT JOIN runs ON runs.mission_id = missions.id
      GROUP BY missions.id
      ORDER BY missions.updated_at DESC
      `,
    )
    .all() as Array<Record<string, unknown>>;

  const assignments = getDb()
    .prepare(
      `
      SELECT mission_agents.mission_id, agents.id, agents.name, agents.role, agents.emoji, agents.color
      FROM mission_agents
      JOIN agents ON agents.id = mission_agents.agent_id
      ORDER BY agents.name COLLATE NOCASE
      `,
    )
    .all() as Array<Record<string, unknown>>;

  const assignmentMap = new Map<string, Array<Record<string, unknown>>>();
  for (const row of assignments) {
    const bucket = assignmentMap.get(String(row.mission_id)) ?? [];
    bucket.push({
      id: row.id,
      name: row.name,
      role: row.role,
      emoji: row.emoji,
      color: row.color,
    });
    assignmentMap.set(String(row.mission_id), bucket);
  }

  return missions.map((row) => serializeMission(row, assignmentMap.get(String(row.id)) ?? []));
}

function listIssues(filters: {
  status?: string | undefined;
  assignee?: string | undefined;
  missionId?: string | undefined;
  q?: string | undefined;
  priority?: string | undefined;
}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("issues.status = ?");
    params.push(filters.status);
  }
  if (filters.assignee) {
    conditions.push("issues.assignee_agent_id = ?");
    params.push(filters.assignee);
  }
  if (filters.missionId) {
    conditions.push("issues.mission_id = ?");
    params.push(filters.missionId);
  }
  if (filters.priority) {
    conditions.push("issues.priority = ?");
    params.push(filters.priority);
  }
  if (filters.q) {
    conditions.push("(issues.title LIKE ? OR issues.description LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(
      `
      SELECT
        issues.*,
        assignee.name AS assignee_name,
        assignee.emoji AS assignee_emoji,
        missions.title AS mission_title
      FROM issues
      LEFT JOIN agents AS assignee ON assignee.id = issues.assignee_agent_id
      LEFT JOIN missions ON missions.id = issues.mission_id
      ${where}
      ORDER BY issues.updated_at DESC
      `,
    )
    .all(...params)
    .map((row) => serializeIssue(row as Record<string, unknown>));
}

function listRuns(filters: {
  agentId?: string | undefined;
  missionId?: string | undefined;
  status?: string | undefined;
  q?: string | undefined;
}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.agentId) {
    conditions.push("runs.agent_id = ?");
    params.push(filters.agentId);
  }
  if (filters.missionId) {
    conditions.push("runs.mission_id = ?");
    params.push(filters.missionId);
  }
  if (filters.status) {
    conditions.push("runs.status = ?");
    params.push(filters.status);
  }
  if (filters.q) {
    conditions.push("(runs.prompt LIKE ? OR runs.output LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(
      `
      SELECT
        runs.*,
        agents.name AS agent_name,
        agents.emoji AS agent_emoji,
        missions.title AS mission_title,
        issues.title AS issue_title
      FROM runs
      LEFT JOIN agents ON agents.id = runs.agent_id
      LEFT JOIN missions ON missions.id = runs.mission_id
      LEFT JOIN issues ON issues.id = runs.issue_id
      ${where}
      ORDER BY runs.started_at DESC
      `,
    )
    .all(...params)
    .map((row) => serializeRun(row as Record<string, unknown>));
}

function listSchedules() {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT
        schedules.*,
        agents.name AS agent_name,
        agents.emoji AS agent_emoji
      FROM schedules
      JOIN agents ON agents.id = schedules.agent_id
      ORDER BY
        schedules.enabled DESC,
        CASE WHEN schedules.next_run_at IS NULL THEN 1 ELSE 0 END,
        schedules.next_run_at ASC,
        schedules.created_at DESC
      `,
    )
    .all()
    .map((row) => serializeSchedule(row as Record<string, unknown>));
}

function readSettingsMap(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function linearRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const settings = readSettingsMap();
  const apiKey = settings.linear_api_key;
  if (!apiKey) {
    throw new Error("Linear API key is not configured.");
  }

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((item) => item.message).join(", ") || response.statusText;
    throw new Error(message);
  }

  if (!payload.data) {
    throw new Error("Linear returned no data.");
  }

  return payload.data;
}

async function syncLinearIssueToLocal(linearIssue: Record<string, unknown>) {
  const db = getDb();
  const id = randomUUID();
  const linearId = String(linearIssue.id);
  const labels =
    Array.isArray(linearIssue.labels) ? linearIssue.labels.map((label) => String((label as { name: string }).name)) : [];
  const existing = db.prepare("SELECT id FROM issues WHERE linear_id = ?").get(linearId) as { id: string } | undefined;
  const issueId = existing?.id ?? id;

  db.prepare(
    `
    INSERT INTO issues (
      id, title, description, status, priority, labels, source, linear_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'linear', ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      priority = excluded.priority,
      labels = excluded.labels,
      source = 'linear',
      linear_id = excluded.linear_id,
      updated_at = datetime('now')
    `,
  ).run(
    issueId,
    String(linearIssue.title ?? "Untitled"),
    typeof linearIssue.description === "string" ? linearIssue.description : null,
    String(linearIssue.status ?? "backlog"),
    String(linearIssue.priority ?? "medium"),
    JSON.stringify(labels),
    linearId,
  );
}

async function patchLinearIssue(
  linearId: string,
  payload: { title?: string | undefined; description?: string | undefined; stateId?: string | undefined },
) {
  try {
    await linearRequest(
      `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
        }
      }
      `,
      { id: linearId, input: payload },
    );
  } catch (error) {
    console.error("Failed to patch Linear issue:", error);
  }
}

function resolveDocFiles(directory: string, prefix = ""): Array<{ path: string; title: string }> {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = readdirSync(directory);
  const files: Array<{ path: string; title: string }> = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...resolveDocFiles(absolutePath, relativePath));
      continue;
    }

    if (entry.endsWith(".md")) {
      files.push({
        path: relativePath.replace(/\\/gu, "/"),
        title: entry.replace(/\.md$/u, "").replace(/-/gu, " "),
      });
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }

  if (
    req.path === "/api/bootstrap" ||
    req.path === "/api/auth/register" ||
    req.path === "/api/auth/login"
  ) {
    next();
    return;
  }

  const authorization = req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing token." });
    return;
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const payload = jwt.verify(token, getJwtSecret()) as { sub: string };
    const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(payload.sub) as UserRow | undefined;
    if (!user) {
      res.status(401).json({ error: "Invalid token." });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token." });
  }
}

app.use(requireAuth);

app.get("/api/bootstrap", (_req, res) => {
  res.json(getBootstrapState());
});

app.post("/api/auth/register", async (req, res) => {
  const { username, password, displayName } = req.body as {
    username?: string;
    password?: string;
    displayName?: string;
  };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: string } | undefined;
  if (existing) {
    res.status(409).json({ error: "Username already exists." });
    return;
  }

  const user: UserRow = {
    id: randomUUID(),
    username,
    password_hash: await bcrypt.hash(password, 12),
    display_name: displayName ?? username,
    avatar_emoji: "👤",
    created_at: new Date().toISOString(),
  };

  db.prepare(
    `
    INSERT INTO users (id, username, password_hash, display_name, avatar_emoji, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(user.id, user.username, user.password_hash, user.display_name, user.avatar_emoji, user.created_at);

  res.status(201).json({ token: signToken(user), user: serializeUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  const user = getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
  if (!user) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }

  res.json({ token: signToken(user), user: serializeUser(user) });
});

app.get("/api/auth/me", (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  res.json({ user: serializeUser(req.user) });
});

app.put("/api/auth/profile", (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const { displayName, avatarEmoji } = req.body as { displayName?: string; avatarEmoji?: string };
  getDb()
    .prepare("UPDATE users SET display_name = ?, avatar_emoji = ? WHERE id = ?")
    .run(displayName ?? req.user.display_name, avatarEmoji ?? req.user.avatar_emoji, req.user.id);
  const updated = getDb().prepare("SELECT * FROM users WHERE id = ?").get(req.user.id) as UserRow;
  res.json({ user: serializeUser(updated) });
});

app.put("/api/auth/password", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new passwords are required." });
    return;
  }

  const ok = await bcrypt.compare(currentPassword, req.user.password_hash);
  if (!ok) {
    res.status(400).json({ error: "Current password is incorrect." });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, req.user.id);
  res.json({ ok: true });
});

app.get("/api/project", (_req, res) => {
  const project = getDb().prepare("SELECT * FROM project LIMIT 1").get() ?? null;
  res.json({ project });
});

app.post("/api/project", (req, res) => {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name) {
    res.status(400).json({ error: "Project name is required." });
    return;
  }

  const db = getDb();
  db.prepare("DELETE FROM project").run();
  const project = {
    id: randomUUID(),
    name,
    description: description ?? null,
  };
  db.prepare("INSERT INTO project (id, name, description) VALUES (?, ?, ?)").run(project.id, project.name, project.description);
  res.status(201).json({ project });
});

app.delete("/api/project", (_req, res) => {
  resetDatabase();
  res.json({ ok: true, bootstrap: getBootstrapState() });
});

app.get("/api/engines", (_req, res) => {
  res.json({
    engines: engineAdapters.map(({ test: _test, run: _run, ...definition }) => definition),
  });
});

app.post("/api/engines/:id/test", async (req, res) => {
  const adapter = engineMap.get(req.params.id);
  if (!adapter) {
    res.status(404).json({ error: "Unknown engine." });
    return;
  }

  const startedAt = Date.now();
  const result = await adapter.test((req.body as { config?: Record<string, unknown> }).config ?? {});
  res.json({
    ...result,
    latency_ms: Date.now() - startedAt,
  });
});

app.get("/api/agents", (_req, res) => {
  res.json({ agents: listAgents() });
});

app.post("/api/agents", (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (typeof body.name !== "string" || !body.name || typeof body.engine !== "string" || !body.engine) {
    res.status(400).json({ error: "Agent name and engine are required." });
    return;
  }

  const id = randomUUID();
  getDb()
    .prepare(
      `
      INSERT INTO agents (
        id, name, role, emoji, color, engine, skills, tools, connection_type, connection_config,
        soul_md, agents_md, external_config, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      body.name,
      typeof body.role === "string" ? body.role : null,
      typeof body.emoji === "string" ? body.emoji : "🤖",
      typeof body.color === "string" ? body.color : "#5E4AE3",
      body.engine,
      JSON.stringify(Array.isArray(body.skills) ? body.skills : []),
      JSON.stringify(Array.isArray(body.tools) ? body.tools : []),
      typeof body.connection_type === "string" ? body.connection_type : null,
      JSON.stringify(typeof body.connection_config === "object" && body.connection_config ? body.connection_config : {}),
      typeof body.soul_md === "string" ? body.soul_md : "",
      typeof body.agents_md === "string" ? body.agents_md : "",
      body.external_config ? 1 : 0,
      body.active === false ? 0 : 1,
    );

  getDb().prepare("INSERT OR IGNORE INTO agent_positions (agent_id, x, y) VALUES (?, 0, 0)").run(id);

  const agent = listAgents().find((item) => item.id === id);
  res.status(201).json({ agent });
});

app.put("/api/agents/:id", (req, res) => {
  const body = req.body as Record<string, unknown>;
  getDb()
    .prepare(
      `
      UPDATE agents
      SET
        name = ?,
        role = ?,
        emoji = ?,
        color = ?,
        engine = ?,
        skills = ?,
        tools = ?,
        connection_type = ?,
        connection_config = ?,
        soul_md = ?,
        agents_md = ?,
        external_config = ?,
        active = ?
      WHERE id = ?
      `,
    )
    .run(
      body.name,
      typeof body.role === "string" ? body.role : null,
      typeof body.emoji === "string" ? body.emoji : "🤖",
      typeof body.color === "string" ? body.color : "#5E4AE3",
      body.engine,
      JSON.stringify(Array.isArray(body.skills) ? body.skills : []),
      JSON.stringify(Array.isArray(body.tools) ? body.tools : []),
      typeof body.connection_type === "string" ? body.connection_type : null,
      JSON.stringify(typeof body.connection_config === "object" && body.connection_config ? body.connection_config : {}),
      typeof body.soul_md === "string" ? body.soul_md : "",
      typeof body.agents_md === "string" ? body.agents_md : "",
      body.external_config ? 1 : 0,
      body.active === false ? 0 : 1,
      req.params.id,
    );

  const agent = listAgents().find((item) => item.id === req.params.id);
  res.json({ agent });
});

app.delete("/api/agents/:id", (req, res) => {
  getDb().prepare("DELETE FROM agents WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/agents/:id/test", async (req, res) => {
  const row = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: "Agent not found." });
    return;
  }

  const adapter = engineMap.get(String(row.engine));
  if (!adapter) {
    res.status(400).json({ ok: false, message: `Unsupported engine: ${row.engine}` });
    return;
  }

  const startedAt = Date.now();
  const result = await adapter.test(parseJson<Record<string, unknown>>(String(row.connection_config ?? "{}"), {}));
  res.json({ ...result, latency_ms: Date.now() - startedAt });
});

app.get("/api/agents/:id/runs", (req, res) => {
  res.json({ runs: listRuns({ agentId: req.params.id }) });
});

app.get("/api/relationships", (_req, res) => {
  const relationships = getDb()
    .prepare("SELECT * FROM agent_relationships ORDER BY parent_id, child_id")
    .all();
  res.json({ relationships });
});

app.post("/api/relationships", (req, res) => {
  const { parent_id: parentId, child_id: childId } = req.body as { parent_id?: string; child_id?: string };
  if (!parentId || !childId) {
    res.status(400).json({ error: "parent_id and child_id are required." });
    return;
  }

  const relationship = {
    id: randomUUID(),
    parent_id: parentId,
    child_id: childId,
  };

  getDb()
    .prepare("INSERT INTO agent_relationships (id, parent_id, child_id) VALUES (?, ?, ?)")
    .run(relationship.id, relationship.parent_id, relationship.child_id);
  res.status(201).json({ relationship });
});

app.delete("/api/relationships/:id", (req, res) => {
  getDb().prepare("DELETE FROM agent_relationships WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.put("/api/positions", (req, res) => {
  const positions = Array.isArray(req.body) ? req.body : (req.body as { positions?: unknown[] }).positions;
  if (!Array.isArray(positions)) {
    res.status(400).json({ error: "Positions payload must be an array." });
    return;
  }

  const insert = getDb().prepare(
    `
    INSERT INTO agent_positions (agent_id, x, y)
    VALUES (?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET x = excluded.x, y = excluded.y
    `,
  );
  const transaction = getDb().transaction((items: unknown[]) => {
    for (const item of items as Array<{ agent_id: string; x: number; y: number }>) {
      insert.run(item.agent_id, item.x, item.y);
    }
  });
  transaction(positions);
  res.json({ ok: true });
});

app.get("/api/missions", (_req, res) => {
  res.json({ missions: listMissions() });
});

app.post("/api/missions", (req, res) => {
  const {
    title,
    description,
    lead_agent_id: leadAgentId,
    linear_project_id: linearProjectId,
    github_repo: githubRepo,
    github_default_branch: githubDefaultBranch,
  } = req.body as {
    title?: string;
    description?: string;
    lead_agent_id?: string;
    linear_project_id?: string;
    github_repo?: string;
    github_default_branch?: string;
  };
  if (!title) {
    res.status(400).json({ error: "Mission title is required." });
    return;
  }

  const id = randomUUID();
  getDb()
    .prepare(
      `
      INSERT INTO missions (id, title, description, status, lead_agent_id, linear_project_id, github_repo, github_default_branch, updated_at)
      VALUES (?, ?, ?, 'planning', ?, ?, ?, ?, datetime('now'))
      `,
    )
    .run(id, title, description ?? null, leadAgentId ?? null, linearProjectId ?? null, githubRepo ?? null, githubDefaultBranch ?? "main");

  if (leadAgentId) {
    getDb().prepare("INSERT OR IGNORE INTO mission_agents (mission_id, agent_id) VALUES (?, ?)").run(id, leadAgentId);
  }

  const mission = listMissions().find((item) => item.id === id);
  res.status(201).json({ mission });
});

app.put("/api/missions/:id", (req, res) => {
  const {
    title,
    description,
    status,
    lead_agent_id: leadAgentId,
    linear_project_id: linearProjectId,
    github_repo: githubRepo,
    github_default_branch: githubDefaultBranch,
  } = req.body as {
    title?: string;
    description?: string;
    status?: string;
    lead_agent_id?: string;
    linear_project_id?: string;
    github_repo?: string;
    github_default_branch?: string;
  };

  getDb()
    .prepare(
      `
      UPDATE missions
      SET title = ?, description = ?, status = ?, lead_agent_id = ?, linear_project_id = ?,
          github_repo = ?, github_default_branch = ?, updated_at = datetime('now')
      WHERE id = ?
      `,
    )
    .run(title, description ?? null, status ?? "planning", leadAgentId ?? null, linearProjectId ?? null,
      githubRepo ?? null, githubDefaultBranch ?? "main", req.params.id);

  if (leadAgentId) {
    getDb().prepare("INSERT OR IGNORE INTO mission_agents (mission_id, agent_id) VALUES (?, ?)").run(req.params.id, leadAgentId);
  }

  const mission = listMissions().find((item) => item.id === req.params.id);
  res.json({ mission });
});

app.delete("/api/missions/:id", (req, res) => {
  getDb().prepare("DELETE FROM missions WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/missions/:id/agents", (req, res) => {
  const { agent_id: agentId } = req.body as { agent_id?: string };
  if (!agentId) {
    res.status(400).json({ error: "agent_id is required." });
    return;
  }

  getDb().prepare("INSERT OR IGNORE INTO mission_agents (mission_id, agent_id) VALUES (?, ?)").run(req.params.id, agentId);
  res.status(201).json({ ok: true });
});

app.delete("/api/missions/:id/agents/:agentId", (req, res) => {
  getDb().prepare("DELETE FROM mission_agents WHERE mission_id = ? AND agent_id = ?").run(req.params.id, req.params.agentId);
  res.json({ ok: true });
});

async function createRunRecord(input: {
  agentId: string;
  prompt: string;
  missionId?: string | null | undefined;
  issueId?: string | null | undefined;
  scheduleId?: string | null | undefined;
}) {
  const db = getDb();
  const agentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | undefined;
  if (!agentRow) {
    throw new Error("Agent not found.");
  }

  const adapter = engineMap.get(String(agentRow.engine));
  if (!adapter) {
    throw new Error(`Unsupported engine: ${String(agentRow.engine)}`);
  }

  // Resolve GitHub workspace if issue belongs to a GitHub-linked mission
  let workingDirectory: string | null = null;
  let githubBranch: string | null = null;

  const missionId = input.missionId ?? null;
  const issueId = input.issueId ?? null;
  const scheduleId = input.scheduleId ?? null;

  if (issueId && missionId) {
    const mission = db.prepare("SELECT github_repo, github_default_branch FROM missions WHERE id = ?").get(missionId) as {
      github_repo: string | null;
      github_default_branch: string | null;
    } | undefined;

    if (mission?.github_repo) {
      const [owner, repo] = mission.github_repo.split("/");
      if (owner && repo) {
        try {
          const issue = db.prepare("SELECT title FROM issues WHERE id = ?").get(issueId) as { title: string } | undefined;
          const branchName = makeBranchName(issueId, issue?.title ?? "work");
          workingDirectory = await ensureRepo(owner, repo, issueId);
          await createFeatureBranch(workingDirectory, branchName, mission.github_default_branch ?? "main");
          githubBranch = branchName;
        } catch (error) {
          console.error("[github] Failed to prepare workspace:", error);
        }
      }
    }
  }

  const runId = randomUUID();
  db.prepare(
    `
    INSERT INTO runs (id, agent_id, mission_id, issue_id, schedule_id, engine, status, prompt, output, tool_calls, started_at, working_directory, github_branch)
    VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '', '[]', datetime('now'), ?, ?)
    `,
  ).run(runId, input.agentId, missionId, issueId, scheduleId, String(agentRow.engine), input.prompt, workingDirectory, githubBranch);

  void executeRun(runId);
  return runId;
}

async function triggerScheduleRun(scheduleId: string, reason: "cron" | "manual") {
  const db = getDb();
  const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Schedule not found.");
  }

  const isEnabled = asFlag(typeof row.enabled === "number" ? row.enabled : 0);
  const cronExpression = String(row.cron_expression ?? "");
  const maxRuns = typeof row.max_runs === "number" ? row.max_runs : null;
  const runCount = Number(row.run_count ?? 0);

  if (reason === "cron" && !isEnabled) {
    return { run: null, schedule: listSchedules().find((entry) => entry.id === scheduleId) ?? null };
  }

  if (maxRuns !== null && runCount >= maxRuns) {
    db.prepare(
      `
      UPDATE schedules
      SET enabled = 0, next_run_at = NULL, updated_at = datetime('now')
      WHERE id = ?
      `,
    ).run(scheduleId);
    return { run: null, schedule: listSchedules().find((entry) => entry.id === scheduleId) ?? null };
  }

  try {
    const runId = await createRunRecord({
      agentId: String(row.agent_id),
      prompt: String(row.prompt ?? ""),
      scheduleId,
    });
    const nextRunCount = runCount + 1;
    const reachedLimit = maxRuns !== null && nextRunCount >= maxRuns;
    const nextEnabled = reachedLimit ? false : isEnabled;
    const nextRunAt = nextEnabled ? computeNextRunAt(cronExpression, new Date()) : null;

    db.prepare(
      `
      UPDATE schedules
      SET
        run_count = ?,
        last_run_at = datetime('now'),
        next_run_at = ?,
        last_error = NULL,
        enabled = ?,
        updated_at = datetime('now')
      WHERE id = ?
      `,
    ).run(nextRunCount, nextRunAt, nextEnabled ? 1 : 0, scheduleId);

    return {
      run: listRuns({}).find((item) => item.id === runId) ?? null,
      schedule: listSchedules().find((entry) => entry.id === scheduleId) ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start scheduled run.";
    const nextRunAt = isEnabled ? computeNextRunAt(cronExpression, new Date()) : null;
    db.prepare(
      `
      UPDATE schedules
      SET next_run_at = ?, last_error = ?, updated_at = datetime('now')
      WHERE id = ?
      `,
    ).run(nextRunAt, message, scheduleId);
    throw error;
  }
}

async function pollSchedules(): Promise<void> {
  if (scheduleLoopInFlight) {
    return;
  }

  scheduleLoopInFlight = true;
  try {
    const dueSchedules = getDb()
      .prepare(
        `
        SELECT id
        FROM schedules
        WHERE enabled = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= datetime('now')
        ORDER BY next_run_at ASC
        `,
      )
      .all() as Array<{ id: string }>;

    for (const schedule of dueSchedules) {
      if (activeScheduledRuns.has(schedule.id)) {
        continue;
      }
      activeScheduledRuns.add(schedule.id);
      try {
        await triggerScheduleRun(schedule.id, "cron");
      } catch (error) {
        console.error(`[schedules] Failed to trigger ${schedule.id}:`, error);
      } finally {
        activeScheduledRuns.delete(schedule.id);
      }
    }
  } finally {
    scheduleLoopInFlight = false;
  }
}

function startScheduleLoop(): void {
  if (scheduleLoopTimer) {
    clearInterval(scheduleLoopTimer);
  }
  scheduleLoopTimer = setInterval(() => {
    void pollSchedules();
  }, 30_000);
  void pollSchedules();
}

async function processAgentDirectives(runId: string, fromAgentId: string, missionId: string | null, output: string) {
  const directivePattern = /@agent:([^:]+):\s*([^\n]+)/gu;
  const db = getDb();
  const fromAgent = db.prepare("SELECT * FROM agents WHERE id = ?").get(fromAgentId) as Record<string, unknown> | undefined;
  if (!fromAgent) {
    return;
  }

  for (const match of output.matchAll(directivePattern)) {
    const agentName = match[1]?.trim();
    const message = match[2]?.trim();
    if (!agentName || !message) {
      continue;
    }

    const target = db
      .prepare("SELECT * FROM agents WHERE lower(name) = lower(?) LIMIT 1")
      .get(agentName) as Record<string, unknown> | undefined;
    if (!target || String(target.id) === fromAgentId) {
      continue;
    }

    db.prepare(
      `
      INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(randomUUID(), fromAgentId, String(target.id), missionId, runId, message);

    if (missionId) {
      await createRunRecord({
        agentId: String(target.id),
        prompt: `Mission handoff from ${String(fromAgent.name)}: ${message}`,
        missionId,
      });
    }
  }
}

async function executeRun(runId: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  if (!row) {
    return;
  }

  const agentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(String(row.agent_id)) as Record<string, unknown> | undefined;
  if (!agentRow) {
    db.prepare("UPDATE runs SET status = 'failed', output = ? WHERE id = ?").run("Agent not found.", runId);
    publishRunEvent(runId, { type: "error", message: "Agent not found." });
    return;
  }

  const adapter = engineMap.get(String(agentRow.engine));
  if (!adapter) {
    db.prepare("UPDATE runs SET status = 'failed', output = ? WHERE id = ?").run("Engine not supported.", runId);
    publishRunEvent(runId, { type: "error", message: "Engine not supported." });
    return;
  }

  const startedAt = Date.now();
  let output = "";

  // Merge working directory into connection config if set
  const baseConfig = parseJson<Record<string, unknown>>(String(agentRow.connection_config ?? "{}"), {});
  const workingDir = typeof row.working_directory === "string" ? row.working_directory : null;
  const connectionConfig = workingDir ? { ...baseConfig, workingDirectory: workingDir } : baseConfig;

  try {
    const fullPrompt = buildRunPrompt(agentRow, String(row.prompt ?? ""));
    for await (const chunk of adapter.run({
      prompt: fullPrompt,
      connectionConfig,
      agent: {
        id: String(agentRow.id),
        name: String(agentRow.name),
        tools: parseJson<string[]>(String(agentRow.tools ?? "[]"), []),
      },
      context: {
        missionId: row.mission_id,
        issueId: row.issue_id,
      },
    })) {
      output += chunk;
      db.prepare("UPDATE runs SET output = ? WHERE id = ?").run(output, runId);
      publishRunEvent(runId, { type: "chunk", chunk, output });
    }

    db.prepare(
      `
      UPDATE runs
      SET status = 'complete', output = ?, finished_at = datetime('now'), duration_ms = ?
      WHERE id = ?
      `,
    ).run(output, Date.now() - startedAt, runId);
    publishRunEvent(runId, { type: "complete", output, duration_ms: Date.now() - startedAt });
    await processAgentDirectives(runId, String(agentRow.id), (row.mission_id as string | null) ?? null, output);

    // After successful run, push branch and create PR if GitHub-linked
    const ghBranch = typeof row.github_branch === "string" ? row.github_branch : null;
    if (workingDir && ghBranch && row.mission_id) {
      try {
        const mission = db.prepare("SELECT github_repo, github_default_branch FROM missions WHERE id = ?").get(String(row.mission_id)) as {
          github_repo: string | null;
          github_default_branch: string | null;
        } | undefined;

        if (mission?.github_repo) {
          const [owner, repo] = mission.github_repo.split("/");
          if (owner && repo) {
            await pushBranch(workingDir, ghBranch);
            const issue = row.issue_id
              ? (db.prepare("SELECT title, github_number FROM issues WHERE id = ?").get(String(row.issue_id)) as { title: string; github_number: number | null } | undefined)
              : undefined;

            const prTitle = issue?.title ? `[Agent] ${issue.title}` : `[Agent] ${ghBranch}`;
            const ghIssueRef = issue?.github_number ? `\n\nCloses #${issue.github_number}` : "";
            const prBody = `Automated changes by agent **${String(agentRow.name)}**.${ghIssueRef}`;
            const baseBranch = mission.github_default_branch ?? "main";

            const pr = await createGitHubPR(owner, repo, ghBranch, baseBranch, prTitle, prBody);
            db.prepare("UPDATE runs SET github_pr_url = ? WHERE id = ?").run(pr.html_url, runId);

            if (row.issue_id) {
              db.prepare("UPDATE issues SET github_pr_number = ?, github_pr_url = ?, github_branch = ? WHERE id = ?")
                .run(pr.number, pr.html_url, ghBranch, String(row.issue_id));
            }

            publishRunEvent(runId, { type: "pr_created", pr_url: pr.html_url, pr_number: pr.number });
          }
        }
      } catch (prError) {
        console.error("[github] Failed to push/create PR:", prError);
        publishRunEvent(runId, { type: "pr_error", message: prError instanceof Error ? prError.message : "PR creation failed." });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run failed.";
    const failedOutput = `${output}${output ? "\n\n" : ""}[error] ${message}`;
    db.prepare(
      `
      UPDATE runs
      SET status = 'failed', output = ?, finished_at = datetime('now'), duration_ms = ?
      WHERE id = ?
      `,
    ).run(failedOutput, Date.now() - startedAt, runId);
    publishRunEvent(runId, { type: "error", message, output: failedOutput });
  }
}

app.post("/api/missions/:id/start", async (req, res) => {
  const mission = getDb().prepare("SELECT * FROM missions WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
  if (!mission) {
    res.status(404).json({ error: "Mission not found." });
    return;
  }

  const leadAgentId = typeof mission.lead_agent_id === "string" ? mission.lead_agent_id : null;
  if (!leadAgentId) {
    res.status(400).json({ error: "Mission has no lead agent." });
    return;
  }

  getDb().prepare("UPDATE missions SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  const assignedAgents = getDb()
    .prepare(
      `
      SELECT agents.name
      FROM mission_agents
      JOIN agents ON agents.id = mission_agents.agent_id
      WHERE mission_agents.mission_id = ?
      ORDER BY agents.name COLLATE NOCASE
      `,
    )
    .all(req.params.id) as Array<{ name: string }>;

  const runId = await createRunRecord({
    agentId: leadAgentId,
    missionId: req.params.id,
    prompt: `You are leading mission: ${String(mission.title)}. Goal: ${String(
      mission.description ?? "",
    )}. Your team: ${assignedAgents.map((item) => item.name).join(", ")}. Begin planning.`,
  });

  res.json({ ok: true, runId });
});

app.get("/api/issues", (req, res) => {
  res.json({
    issues: listIssues({
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      assignee: typeof req.query.assignee === "string" ? req.query.assignee : undefined,
      missionId: typeof req.query.mission_id === "string" ? req.query.mission_id : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      priority: typeof req.query.priority === "string" ? req.query.priority : undefined,
    }),
  });
});

app.post("/api/issues", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (typeof body.title !== "string" || !body.title) {
    res.status(400).json({ error: "Issue title is required." });
    return;
  }

  const id = randomUUID();
  getDb().prepare(
    `
    INSERT INTO issues (
      id, title, description, status, priority, assignee_agent_id, mission_id, labels, source, linear_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
  ).run(
    id,
    body.title,
    typeof body.description === "string" ? body.description : null,
    typeof body.status === "string" ? body.status : "backlog",
    typeof body.priority === "string" ? body.priority : "medium",
    typeof body.assignee_agent_id === "string" ? body.assignee_agent_id : null,
    typeof body.mission_id === "string" ? body.mission_id : null,
    JSON.stringify(Array.isArray(body.labels) ? body.labels : []),
    typeof body.source === "string" ? body.source : "native",
    typeof body.linear_id === "string" ? body.linear_id : null,
  );

  if (typeof body.linear_id === "string" && body.linear_id) {
    await patchLinearIssue(body.linear_id, {
      title: String(body.title),
      description: typeof body.description === "string" ? body.description : undefined,
    });
  }

  const issue = listIssues({}).find((item) => item.id === id);
  res.status(201).json({ issue });
});

app.put("/api/issues/:id", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  getDb().prepare(
    `
    UPDATE issues
    SET
      title = ?,
      description = ?,
      status = ?,
      priority = ?,
      assignee_agent_id = ?,
      mission_id = ?,
      labels = ?,
      source = ?,
      linear_id = ?,
      updated_at = datetime('now')
    WHERE id = ?
    `,
  ).run(
    body.title,
    typeof body.description === "string" ? body.description : null,
    typeof body.status === "string" ? body.status : "backlog",
    typeof body.priority === "string" ? body.priority : "medium",
    typeof body.assignee_agent_id === "string" ? body.assignee_agent_id : null,
    typeof body.mission_id === "string" ? body.mission_id : null,
    JSON.stringify(Array.isArray(body.labels) ? body.labels : []),
    typeof body.source === "string" ? body.source : "native",
    typeof body.linear_id === "string" ? body.linear_id : null,
    req.params.id,
  );

  if (typeof body.linear_id === "string" && body.linear_id) {
    await patchLinearIssue(body.linear_id, {
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
    });
  }

  const issue = listIssues({}).find((item) => item.id === req.params.id);
  res.json({ issue });
});

app.delete("/api/issues/:id", (req, res) => {
  getDb().prepare("DELETE FROM issues WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.get("/api/issues/:id/comments", (_req, res) => {
  const comments = getDb()
    .prepare(
      `
      SELECT
        issue_comments.*,
        users.display_name AS user_display_name,
        users.avatar_emoji AS user_avatar_emoji,
        agents.name AS agent_name,
        agents.emoji AS agent_emoji
      FROM issue_comments
      LEFT JOIN users ON users.id = issue_comments.author_id AND issue_comments.author_type = 'user'
      LEFT JOIN agents ON agents.id = issue_comments.author_id AND issue_comments.author_type = 'agent'
      WHERE issue_comments.issue_id = ?
      ORDER BY issue_comments.created_at ASC
      `,
    )
    .all(_req.params.id)
    .map((row) => ({
      ...(row as Record<string, unknown>),
      author_name:
        (row as { author_type: string; user_display_name?: string; agent_name?: string }).author_type === "agent"
          ? (row as { agent_name?: string }).agent_name
          : (row as { user_display_name?: string }).user_display_name,
      author_emoji:
        (row as { author_type: string; user_avatar_emoji?: string; agent_emoji?: string }).author_type === "agent"
          ? (row as { agent_emoji?: string }).agent_emoji
          : (row as { user_avatar_emoji?: string }).user_avatar_emoji,
    }));
  res.json({ comments });
});

app.post("/api/issues/:id/comments", (req: AuthenticatedRequest, res) => {
  const { body, parentId } = req.body as { body?: string; parentId?: string };
  if (!body || !req.user) {
    res.status(400).json({ error: "Comment body is required." });
    return;
  }

  const comment = {
    id: randomUUID(),
    issue_id: req.params.id,
    parent_id: parentId ?? null,
    author_type: "user",
    author_id: req.user.id,
    body,
  };
  getDb()
    .prepare(
      `
      INSERT INTO issue_comments (id, issue_id, parent_id, author_type, author_id, body)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(comment.id, comment.issue_id, comment.parent_id, comment.author_type, comment.author_id, comment.body);
  res.status(201).json({ comment });
});

app.delete("/api/issues/:id/comments/:commentId", (req, res) => {
  getDb().prepare("DELETE FROM issue_comments WHERE id = ?").run(req.params.commentId);
  res.json({ ok: true });
});

app.post("/api/issues/sync-linear", async (_req, res) => {
  const data = await linearRequest<{
    issues: {
      nodes: Array<Record<string, unknown>>;
    };
  }>(`
    query MissionOSIssues {
      issues(first: 100) {
        nodes {
          id
          title
          description
          priorityLabel
          state {
            name
          }
          labels {
            nodes {
              name
            }
          }
        }
      }
    }
  `);

  for (const issue of data.issues.nodes) {
    await syncLinearIssueToLocal({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      status: (issue.state as { name?: string } | null)?.name ?? "backlog",
      priority: issue.priorityLabel ?? "medium",
      labels: (issue.labels as { nodes?: Array<{ name: string }> } | null)?.nodes ?? [],
    });
  }

  res.json({ ok: true, issues: listIssues({}) });
});

app.get("/api/linear/issues", async (_req, res) => {
  const data = await linearRequest<{
    issues: {
      nodes: Array<Record<string, unknown>>;
    };
  }>(`
    query MissionOSLinearIssues {
      issues(first: 100) {
        nodes {
          id
          title
          description
          priorityLabel
          state {
            name
          }
          labels {
            nodes {
              name
            }
          }
        }
      }
    }
  `);

  res.json({
    issues: data.issues.nodes.map((issue) => ({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      status: (issue.state as { name?: string } | null)?.name ?? "backlog",
      priority: issue.priorityLabel ?? "medium",
      labels: (issue.labels as { nodes?: Array<{ name: string }> } | null)?.nodes?.map((item) => item.name) ?? [],
      source: "linear",
      linear_id: issue.id,
    })),
  });
});

app.get("/api/linear/teams", async (_req, res) => {
  const data = await linearRequest<{
    teams: {
      nodes: Array<{ id: string; name: string; key: string }>;
    };
  }>(`
    query MissionOSTeams {
      teams {
        nodes {
          id
          name
          key
        }
      }
    }
  `);

  res.json({ teams: data.teams.nodes });
});

app.post("/api/linear/test", async (_req, res) => {
  const data = await linearRequest<{
    viewer: {
      id: string;
      organization: { name: string };
    };
  }>(`
    query MissionOSViewer {
      viewer {
        id
        organization {
          name
        }
      }
    }
  `);

  res.json({ ok: true, workspace: data.viewer.organization.name });
});

// ── GitHub integration routes ────────────────────────────────────────────

app.post("/api/github/test", async (_req, res) => {
  try {
    const result = await testGitHubConnection();
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Connection failed." });
  }
});

app.get("/api/github/repos", async (req, res) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : undefined;
    const repos = await listGitHubRepos(query);
    res.json({ repos });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to fetch repos." });
  }
});

app.get("/api/github/repos/:owner/:repo/issues", async (req, res) => {
  try {
    const issues = await listGitHubIssues(req.params.owner, req.params.repo);
    res.json({ issues });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to fetch issues." });
  }
});

app.post("/api/issues/sync-github", async (req, res) => {
  const missionId = typeof req.query.mission_id === "string" ? req.query.mission_id : (req.body as { mission_id?: string }).mission_id;
  if (!missionId) {
    res.status(400).json({ error: "mission_id is required." });
    return;
  }

  const mission = getDb().prepare("SELECT github_repo FROM missions WHERE id = ?").get(missionId) as { github_repo: string | null } | undefined;
  if (!mission?.github_repo) {
    res.status(400).json({ error: "Mission has no linked GitHub repository." });
    return;
  }

  const [owner, repo] = mission.github_repo.split("/");
  if (!owner || !repo) {
    res.status(400).json({ error: "Invalid github_repo format. Expected owner/repo." });
    return;
  }

  try {
    const synced = await syncGitHubIssuesToLocal(owner, repo, missionId);
    const issues = listIssues({ missionId });
    res.json({ ok: true, synced, issues });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Sync failed." });
  }
});

app.get("/api/schedules", (_req, res) => {
  res.json({ schedules: listSchedules() });
});

app.post("/api/schedules", (req, res) => {
  try {
    const input = parseScheduleInput(req.body as Record<string, unknown>);
    const agent = getDb().prepare("SELECT id FROM agents WHERE id = ?").get(input.agentId) as { id: string } | undefined;
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }

    const schedule = {
      id: randomUUID(),
      name: input.name,
      agent_id: input.agentId,
      prompt: input.prompt,
      cron_expression: input.cronExpression,
      enabled: input.enabled,
      max_runs: input.maxRuns,
      next_run_at: input.enabled ? computeNextRunAt(input.cronExpression, new Date()) : null,
    };

    getDb().prepare(
      `
      INSERT INTO schedules (
        id, name, agent_id, prompt, cron_expression, enabled, max_runs, next_run_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
    ).run(
      schedule.id,
      schedule.name,
      schedule.agent_id,
      schedule.prompt,
      schedule.cron_expression,
      schedule.enabled ? 1 : 0,
      schedule.max_runs,
      schedule.next_run_at,
    );

    res.status(201).json({ schedule: listSchedules().find((entry) => entry.id === schedule.id) ?? null });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid schedule payload." });
  }
});

app.put("/api/schedules/:id", (req, res) => {
  const existing = getDb().prepare("SELECT * FROM schedules WHERE id = ?").get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: "Schedule not found." });
    return;
  }

  try {
    const input = parseScheduleInput(req.body as Record<string, unknown>);
    const agent = getDb().prepare("SELECT id FROM agents WHERE id = ?").get(input.agentId) as { id: string } | undefined;
    if (!agent) {
      res.status(404).json({ error: "Agent not found." });
      return;
    }

    const runCount = Number(existing.run_count ?? 0);
    const reachedLimit = input.maxRuns !== null && runCount >= input.maxRuns;
    const enabled = input.enabled && !reachedLimit;
    const nextRunAt = enabled ? computeNextRunAt(input.cronExpression, new Date()) : null;
    const limitError = reachedLimit ? "Run limit reached. Increase max runs or run manually." : null;

    getDb().prepare(
      `
      UPDATE schedules
      SET
        name = ?,
        agent_id = ?,
        prompt = ?,
        cron_expression = ?,
        enabled = ?,
        max_runs = ?,
        next_run_at = ?,
        last_error = ?,
        updated_at = datetime('now')
      WHERE id = ?
      `,
    ).run(
      input.name,
      input.agentId,
      input.prompt,
      input.cronExpression,
      enabled ? 1 : 0,
      input.maxRuns,
      nextRunAt,
      limitError,
      req.params.id,
    );

    res.json({ schedule: listSchedules().find((entry) => entry.id === req.params.id) ?? null });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid schedule payload." });
  }
});

app.delete("/api/schedules/:id", (req, res) => {
  const result = getDb().prepare("DELETE FROM schedules WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Schedule not found." });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/schedules/:id/run", async (req, res) => {
  try {
    const result = await triggerScheduleRun(req.params.id, "manual");
    if (!result.schedule) {
      res.status(404).json({ error: "Schedule not found." });
      return;
    }
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to run schedule." });
  }
});

app.get("/api/runs", (req, res) => {
  res.json({
    runs: listRuns({
      agentId: typeof req.query.agent_id === "string" ? req.query.agent_id : undefined,
      missionId: typeof req.query.mission_id === "string" ? req.query.mission_id : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
    }),
  });
});

app.post("/api/runs", async (req, res) => {
  const { agent_id: rawAgentId, prompt: rawPrompt, mission_id: missionId, issue_id: issueId } = req.body as {
    agent_id?: string;
    prompt?: string;
    mission_id?: string;
    issue_id?: string;
  };
  const agentId = typeof rawAgentId === "string" ? rawAgentId.trim() : "";
  const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
  if (!agentId || !prompt) {
    res.status(400).json({ error: "agent_id and prompt are required." });
    return;
  }

  const runId = await createRunRecord({ agentId, prompt, missionId, issueId });
  const run = listRuns({}).find((item) => item.id === runId);
  res.status(201).json({ run });
});

app.get("/api/runs/:id", (req, res) => {
  const run = listRuns({}).find((item) => item.id === req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  res.json({ run });
});

app.get("/api/runs/:id/stream", (req, res) => {
  const run = getDb().prepare("SELECT id, output, status FROM runs WHERE id = ?").get(req.params.id) as
    | { id: string; output: string; status: string }
    | undefined;
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "snapshot", output: run.output, status: run.status })}\n\n`);

  const subscribers = runSubscribers.get(run.id) ?? new Set<Response>();
  subscribers.add(res);
  runSubscribers.set(run.id, subscribers);

  req.on("close", () => {
    const current = runSubscribers.get(run.id);
    current?.delete(res);
    if (current && current.size === 0) {
      runSubscribers.delete(run.id);
    }
  });
});

app.get("/api/agent-messages", (req, res) => {
  let missionId = typeof req.query.mission_id === "string" ? req.query.mission_id : undefined;
  if (missionId === "active") {
    const active = getDb()
      .prepare("SELECT id FROM missions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1")
      .get() as { id: string } | undefined;
    missionId = active?.id;
  }

  const conditions = missionId ? "WHERE agent_messages.mission_id = ?" : "";
  const params = missionId ? [missionId] : [];
  const messages = getDb()
    .prepare(
      `
      SELECT
        agent_messages.*,
        sender.name AS from_agent_name,
        sender.emoji AS from_agent_emoji,
        recipient.name AS to_agent_name,
        recipient.emoji AS to_agent_emoji
      FROM agent_messages
      LEFT JOIN agents AS sender ON sender.id = agent_messages.from_agent_id
      LEFT JOIN agents AS recipient ON recipient.id = agent_messages.to_agent_id
      ${conditions}
      ORDER BY agent_messages.created_at DESC
      LIMIT 100
      `,
    )
    .all(...params);
  res.json({ messages });
});

app.post("/api/agent-messages", (req, res) => {
  const { from_agent_id: fromAgentId, to_agent_id: toAgentId, mission_id: missionId, run_id: runId, message } = req.body as {
    from_agent_id?: string;
    to_agent_id?: string;
    mission_id?: string;
    run_id?: string;
    message?: string;
  };
  if (!fromAgentId || !toAgentId || !message) {
    res.status(400).json({ error: "from_agent_id, to_agent_id and message are required." });
    return;
  }

  const payload = {
    id: randomUUID(),
    from_agent_id: fromAgentId,
    to_agent_id: toAgentId,
    mission_id: missionId ?? null,
    run_id: runId ?? null,
    message,
  };
  getDb()
    .prepare(
      `
      INSERT INTO agent_messages (id, from_agent_id, to_agent_id, mission_id, run_id, message)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(payload.id, payload.from_agent_id, payload.to_agent_id, payload.mission_id, payload.run_id, payload.message);
  res.status(201).json({ agent_message: payload });
});

app.get("/api/settings", (_req, res) => {
  const settings = getDb().prepare("SELECT key, value FROM settings ORDER BY key ASC").all();
  res.json({ settings, settingsMap: readSettingsMap() });
});

app.put("/api/settings", (req, res) => {
  const settings = Array.isArray(req.body) ? req.body : (req.body as { settings?: unknown[] }).settings;
  if (!Array.isArray(settings)) {
    res.status(400).json({ error: "Settings payload must be an array." });
    return;
  }

  const statement = getDb().prepare(
    `
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
  );
  const transaction = getDb().transaction((items: unknown[]) => {
    for (const item of items as Array<{ key: string; value: string }>) {
      statement.run(item.key, item.value);
    }
  });
  transaction(settings);
  res.json({ ok: true, settingsMap: readSettingsMap() });
});

app.get("/api/search", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.json({ agents: [], missions: [], issues: [], runs: [], comments: [] });
    return;
  }

  const term = `%${q}%`;
  const db = getDb();
  const agents = db.prepare("SELECT id, name, role FROM agents WHERE name LIKE ? OR role LIKE ? LIMIT 10").all(term, term);
  const missions = db
    .prepare("SELECT id, title, description FROM missions WHERE title LIKE ? OR description LIKE ? LIMIT 10")
    .all(term, term);
  const issues = db
    .prepare("SELECT id, title, description FROM issues WHERE title LIKE ? OR description LIKE ? LIMIT 10")
    .all(term, term);
  const runs = db
    .prepare(
      `
      SELECT id, prompt, substr(coalesce(output, ''), max(length(output) - 500, 1), 500) AS output
      FROM runs
      WHERE prompt LIKE ? OR output LIKE ?
      LIMIT 10
      `,
    )
    .all(term, term);
  const comments = db
    .prepare("SELECT id, issue_id, body FROM issue_comments WHERE body LIKE ? LIMIT 10")
    .all(term);

  res.json({ agents, missions, issues, runs, comments });
});

app.get("/api/docs/tree", (_req, res) => {
  res.json({ files: resolveDocFiles(docsRoot) });
});

app.get("/api/docs/content", (req, res) => {
  const requestedPath = typeof req.query.path === "string" ? req.query.path : "";
  const safePath = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+?/u, "");
  const absolutePath = path.join(docsRoot, safePath);
  if (!absolutePath.startsWith(docsRoot) || !existsSync(absolutePath)) {
    res.status(404).json({ error: "Document not found." });
    return;
  }

  res.json({
    path: safePath,
    content: readFileSync(absolutePath, "utf8"),
  });
});

app.post("/api/feedback", (req, res) => {
  const { type, message } = req.body as { type?: string; message?: string };
  if (!type || !message) {
    res.status(400).json({ error: "Feedback type and message are required." });
    return;
  }

  const feedback = {
    id: randomUUID(),
    type,
    message,
  };
  getDb().prepare("INSERT INTO feedback (id, type, message) VALUES (?, ?, ?)").run(feedback.id, feedback.type, feedback.message);
  res.status(201).json({ feedback });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Server error";
  console.error(error);
  res.status(500).json({ error: message });
});

startScheduleLoop();

app.listen(getPort(), () => {
  console.log(`MissionOS server listening on http://localhost:${getPort()}`);
});
