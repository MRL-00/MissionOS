import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destinationPath = process.env.MISSIONOS_DB_PATH ?? path.join(repoRoot, "server", "data", "missionos.db");
const backupPath = process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[1] && argument !== process.argv[0]);
const force = process.argv.includes("--force");

if (!backupPath) {
  console.error("Usage: pnpm db:restore <backup-file> --force");
  process.exit(1);
}

if (!force) {
  console.error("Refusing to restore without --force. Stop MissionOS and run: pnpm db:restore <backup-file> --force");
  process.exit(1);
}

const sourcePath = path.resolve(backupPath);
if (!existsSync(sourcePath)) {
  console.error(`Backup not found at ${sourcePath}`);
  process.exit(1);
}

const backup = new Database(sourcePath, { readonly: true, fileMustExist: true });
try {
  const result = backup.prepare("PRAGMA integrity_check").get();
  if (!result || Object.values(result)[0] !== "ok") {
    throw new Error(`Backup integrity check failed for ${sourcePath}`);
  }
} finally {
  backup.close();
}

mkdirSync(path.dirname(destinationPath), { recursive: true });
for (const filePath of [destinationPath, `${destinationPath}-shm`, `${destinationPath}-wal`]) {
  rmSync(filePath, { force: true });
}
copyFileSync(sourcePath, destinationPath);
console.log(`Restored ${destinationPath} from ${sourcePath}`);
