import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = process.env.MISSIONOS_DB_PATH ?? path.join(repoRoot, "server", "data", "missionos.db");
const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
const defaultDestination = path.join(repoRoot, "backups", `missionos-${timestamp}.db`);
const destinationPath = path.resolve(process.argv[2] ?? defaultDestination);

if (!existsSync(sourcePath)) {
  console.error(`Database not found at ${sourcePath}`);
  process.exit(1);
}

mkdirSync(path.dirname(destinationPath), { recursive: true });

const database = new Database(sourcePath, { readonly: true, fileMustExist: true });
try {
  await database.backup(destinationPath);
  console.log(`Backed up ${sourcePath} to ${destinationPath}`);
} finally {
  database.close();
}
