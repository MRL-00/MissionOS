import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = path.join(serverRoot, "data");
const databaseFileName = process.env.NODE_TEST_CONTEXT ? `missionos-test-${process.pid}.db` : "missionos.db";
export const dbPath = path.join(dataDir, databaseFileName);

let db: Database.Database | null = null;

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_emoji TEXT DEFAULT '👤',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  emoji TEXT DEFAULT '🤖',
  color TEXT DEFAULT '#5E4AE3',
  engine TEXT NOT NULL,
  skills TEXT DEFAULT '[]',
  tools TEXT DEFAULT '[]',
  connection_type TEXT,
  connection_config TEXT,
  soul_md TEXT,
  agents_md TEXT,
  external_config INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_relationships (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  child_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE(parent_id, child_id)
);

CREATE TABLE IF NOT EXISTS agent_positions (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  x REAL DEFAULT 0,
  y REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'planning',
  team_name TEXT DEFAULT 'General',
  color TEXT,
  lead_agent_id TEXT REFERENCES agents(id),
  linear_project_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mission_agents (
  mission_id TEXT REFERENCES missions(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (mission_id, agent_id)
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  issue_number INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'backlog',
  priority TEXT DEFAULT 'medium',
  assignee_agent_id TEXT REFERENCES agents(id),
  mission_id TEXT REFERENCES missions(id),
  labels TEXT DEFAULT '[]',
  source TEXT DEFAULT 'native',
  linear_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issue_comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT REFERENCES issues(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES issue_comments(id),
  author_type TEXT DEFAULT 'user',
  author_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  mission_id TEXT REFERENCES missions(id),
  issue_id TEXT REFERENCES issues(id),
  schedule_id TEXT,
  engine TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  prompt TEXT,
  output TEXT,
  tool_calls TEXT DEFAULT '[]',
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT REFERENCES agents(id),
  to_agent_id TEXT REFERENCES agents(id),
  mission_id TEXT REFERENCES missions(id),
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mission_id TEXT REFERENCES missions(id),
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  max_runs INTEGER,
  run_count INTEGER DEFAULT 0,
  last_run_at TEXT,
  next_run_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

function ensureSchema(database: Database.Database): void {
  for (const sql of getDatabasePragmaStatements()) {
    database.pragma(sql);
  }
  database.exec(schema);
}

function runMigrations(database: Database.Database): void {
  const migrations = [
    "ALTER TABLE missions ADD COLUMN github_repo TEXT",
    "ALTER TABLE missions ADD COLUMN github_default_branch TEXT DEFAULT 'main'",
    "ALTER TABLE missions ADD COLUMN team_name TEXT DEFAULT 'General'",
    "ALTER TABLE issues ADD COLUMN github_id INTEGER",
    "ALTER TABLE issues ADD COLUMN github_number INTEGER",
    "ALTER TABLE issues ADD COLUMN github_repo TEXT",
    "ALTER TABLE issues ADD COLUMN github_branch TEXT",
    "ALTER TABLE issues ADD COLUMN github_pr_number INTEGER",
    "ALTER TABLE issues ADD COLUMN github_pr_url TEXT",
    "ALTER TABLE runs ADD COLUMN schedule_id TEXT",
    "ALTER TABLE runs ADD COLUMN working_directory TEXT",
    "ALTER TABLE runs ADD COLUMN github_branch TEXT",
    "ALTER TABLE runs ADD COLUMN github_pr_url TEXT",
    "ALTER TABLE missions ADD COLUMN color TEXT",
    "ALTER TABLE issues ADD COLUMN issue_number INTEGER",
    "ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(id)",
    "ALTER TABLE runs ADD COLUMN plan_step_id TEXT",
    "ALTER TABLE runs ADD COLUMN execution_plan TEXT",
    "ALTER TABLE issues ADD COLUMN estimation TEXT",
    "ALTER TABLE schedules ADD COLUMN mission_id TEXT REFERENCES missions(id)",
  ];

  for (const sql of migrations) {
    try {
      database.exec(sql);
    } catch {
      // Column already exists — safe to ignore
    }
  }

  for (const sql of getDatabaseIndexStatements()) {
    database.exec(sql);
  }

  // Backfill issue_number for any issues missing one
  try {
    const rows = database.prepare(
      "SELECT id FROM issues WHERE issue_number IS NULL ORDER BY created_at ASC"
    ).all() as { id: string }[];
    if (rows.length > 0) {
      const maxRow = database.prepare(
        "SELECT COALESCE(MAX(issue_number), 0) AS m FROM issues"
      ).get() as { m: number };
      let next = maxRow.m + 1;
      const stmt = database.prepare("UPDATE issues SET issue_number = ? WHERE id = ?");
      for (const row of rows) {
        stmt.run(next++, row.id);
      }
    }
  } catch {
    // ignore
  }
}

export function getDatabaseIndexStatements(): string[] {
  return [
    "CREATE INDEX IF NOT EXISTS idx_agents_active_created ON agents(active, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_agents_engine ON agents(engine)",
    "CREATE INDEX IF NOT EXISTS idx_agent_relationships_child ON agent_relationships(child_id)",
    "CREATE INDEX IF NOT EXISTS idx_missions_status_updated ON missions(status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_missions_team_updated ON missions(team_name, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_missions_lead_agent ON missions(lead_agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_mission_agents_agent ON mission_agents(agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_issues_mission_updated ON issues(mission_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_issues_assignee_updated ON issues(assignee_agent_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_issues_status_priority ON issues(status, priority)",
    "CREATE INDEX IF NOT EXISTS idx_issues_source_linear ON issues(source, linear_id)",
    "CREATE INDEX IF NOT EXISTS idx_issues_github_repo_number ON issues(github_repo, github_number)",
    "CREATE INDEX IF NOT EXISTS idx_runs_agent_started ON runs(agent_id, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_runs_mission_started ON runs(mission_id, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_runs_issue_started ON runs(issue_id, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_runs_status_started ON runs(status, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_runs_schedule_started ON runs(schedule_id, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_runs_parent_started ON runs(parent_run_id, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_agent_messages_mission_created ON agent_messages(mission_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_agent_messages_run ON agent_messages(run_id)",
    "CREATE INDEX IF NOT EXISTS idx_agent_messages_sender ON agent_messages(from_agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient ON agent_messages(to_agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_issue_comments_issue_created ON issue_comments(issue_id, created_at ASC)",
    "CREATE INDEX IF NOT EXISTS idx_issue_comments_parent ON issue_comments(parent_id)",
    "CREATE INDEX IF NOT EXISTS idx_schedules_agent ON schedules(agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_schedules_mission ON schedules(mission_id)",
    "CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at)",
  ];
}

export function getDatabasePragmaStatements(): string[] {
  return [
    "journal_mode = WAL",
    "synchronous = NORMAL",
    "foreign_keys = ON",
    "busy_timeout = 5000",
  ];
}

export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  mkdirSync(dataDir, { recursive: true });
  db = new Database(dbPath);
  ensureSchema(db);
  runMigrations(db);
  return db;
}

export function getDatabaseResetPaths(databasePath: string): string[] {
  return [databasePath, `${databasePath}-shm`, `${databasePath}-wal`];
}

export function resetDatabase(): Database.Database {
  if (db) {
    db.close();
    db = null;
  }

  for (const filePath of getDatabaseResetPaths(dbPath)) {
    rmSync(filePath, { force: true });
  }
  return getDb();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function asFlag(value: number | null | undefined): boolean {
  return value === 1;
}
