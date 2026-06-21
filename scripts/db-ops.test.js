import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function runScript(scriptName, args, env) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts", scriptName), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function createDatabase(filePath) {
  const database = new Database(filePath);
  try {
    database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    database.prepare("INSERT INTO items (name) VALUES (?)").run("release");
  } finally {
    database.close();
  }
}

function readItemNames(filePath) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return database.prepare("SELECT name FROM items ORDER BY id").all().map((row) => row.name);
  } finally {
    database.close();
  }
}

test("backup-db writes a valid SQLite backup to the requested destination", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "missionos-db-backup-"));
  try {
    const sourcePath = path.join(tempDir, "source.db");
    const backupPath = path.join(tempDir, "nested", "backup.db");
    createDatabase(sourcePath);

    const result = runScript("backup-db.js", [backupPath], { MISSIONOS_DB_PATH: sourcePath });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(readItemNames(backupPath), ["release"]);
    assert.match(result.stdout, /Backed up/u);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("backup-db fails clearly when the configured database is missing", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "missionos-db-missing-"));
  try {
    const result = runScript("backup-db.js", [path.join(tempDir, "backup.db")], {
      MISSIONOS_DB_PATH: path.join(tempDir, "missing.db"),
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Database not found/u);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("restore-db requires --force and replaces sqlite sidecar files", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "missionos-db-restore-"));
  try {
    const backupPath = path.join(tempDir, "backup.db");
    const destinationPath = path.join(tempDir, "data", "missionos.db");
    createDatabase(backupPath);
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, "old");
    writeFileSync(`${destinationPath}-shm`, "old");
    writeFileSync(`${destinationPath}-wal`, "old");

    const refused = runScript("restore-db.js", [backupPath], { MISSIONOS_DB_PATH: destinationPath });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Refusing to restore without --force/u);

    const restored = runScript("restore-db.js", [backupPath, "--force"], { MISSIONOS_DB_PATH: destinationPath });

    assert.equal(restored.status, 0, restored.stderr || restored.stdout);
    assert.deepEqual(readItemNames(destinationPath), ["release"]);
    assert.equal(existsSync(`${destinationPath}-shm`), false);
    assert.equal(existsSync(`${destinationPath}-wal`), false);
    assert.match(restored.stdout, /Restored/u);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("restore-db rejects corrupt backup files before replacing the destination", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "missionos-db-corrupt-"));
  try {
    const backupPath = path.join(tempDir, "corrupt.db");
    const destinationPath = path.join(tempDir, "missionos.db");
    writeFileSync(backupPath, "not sqlite");
    createDatabase(destinationPath);

    const result = runScript("restore-db.js", [backupPath, "--force"], { MISSIONOS_DB_PATH: destinationPath });

    assert.notEqual(result.status, 0);
    assert.deepEqual(readItemNames(destinationPath), ["release"]);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("reset-db removes the configured database and sqlite sidecar files", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "missionos-db-reset-"));
  try {
    const databasePath = path.join(tempDir, "missionos.db");
    createDatabase(databasePath);
    writeFileSync(`${databasePath}-shm`, "sidecar");
    writeFileSync(`${databasePath}-wal`, "sidecar");

    const result = runScript("reset-db.js", [], { MISSIONOS_DB_PATH: databasePath });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(databasePath), false);
    assert.equal(existsSync(`${databasePath}-shm`), false);
    assert.equal(existsSync(`${databasePath}-wal`), false);
    assert.match(result.stdout, /Removed/u);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("clean-test-data removes only isolated test databases and sidecars", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "missionos-clean-test-data-"));
  try {
    const removableFiles = [
      "missionos-test-123.db",
      "missionos-test-123.db-shm",
      "missionos-test-123.db-wal",
    ];
    const preservedFiles = [
      "missionos.db",
      "missionos.db-wal",
      "missionos-test-123.sqlite",
      "notes.txt",
    ];

    for (const fileName of [...removableFiles, ...preservedFiles]) {
      writeFileSync(path.join(tempDir, fileName), "data");
    }

    const result = runScript("clean-test-data.js", [], { MISSIONOS_DATA_DIR: tempDir });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Removed 3 test database files/u);
    for (const fileName of removableFiles) {
      assert.equal(existsSync(path.join(tempDir, fileName)), false, `${fileName} should be removed`);
    }
    for (const fileName of preservedFiles) {
      assert.equal(existsSync(path.join(tempDir, fileName)), true, `${fileName} should be preserved`);
    }
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("clean-test-data succeeds when the data directory is missing", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "missionos-clean-missing-"));
  try {
    const missingDir = path.join(tempDir, "missing");
    const result = runScript("clean-test-data.js", [], { MISSIONOS_DATA_DIR: missingDir });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});
