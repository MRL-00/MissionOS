import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { dbPath, getDatabaseIndexStatements, getDatabasePragmaStatements, getDatabaseResetPaths } from "./db.js";

test("getDatabaseResetPaths includes sqlite sidecar files", () => {
  assert.deepEqual(getDatabaseResetPaths("/tmp/missionos.db"), [
    "/tmp/missionos.db",
    "/tmp/missionos.db-shm",
    "/tmp/missionos.db-wal",
  ]);
});

test("dbPath isolates node test worker databases", () => {
  if (process.env.NODE_TEST_CONTEXT) {
    assert.equal(path.basename(dbPath), `missionos-test-${process.pid}.db`);
  } else {
    assert.equal(path.basename(dbPath), "missionos.db");
  }
});

test("getDatabaseIndexStatements covers production list and reference paths", () => {
  const statements = getDatabaseIndexStatements();
  const joined = statements.join("\n");

  assert.equal(new Set(statements).size, statements.length);
  for (const table of ["agents", "missions", "issues", "runs", "agent_messages", "schedules"]) {
    assert.match(joined, new RegExp(` ON ${table}\\(`));
  }
  assert.match(joined, /missions\(team_name, updated_at DESC\)/);
  assert.match(joined, /runs\(agent_id, started_at DESC\)/);
  assert.match(joined, /schedules\(enabled, next_run_at\)/);
});

test("getDatabasePragmaStatements enables production sqlite runtime settings", () => {
  assert.deepEqual(getDatabasePragmaStatements(), [
    "journal_mode = WAL",
    "synchronous = NORMAL",
    "foreign_keys = ON",
    "busy_timeout = 5000",
  ]);
});
