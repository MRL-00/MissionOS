import { rmSync } from "node:fs";
import path from "node:path";

const dbPath = path.resolve(process.env.MISSIONOS_DB_PATH ?? "server/data/missionos.db");
for (const filePath of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
  rmSync(filePath, { force: true });
  console.log(`Removed ${filePath}`);
}
