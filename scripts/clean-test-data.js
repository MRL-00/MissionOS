import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.MISSIONOS_DATA_DIR ?? path.join(repoRoot, "server", "data");

let removed = 0;

try {
  for (const entry of readdirSync(dataDir)) {
    if (/^missionos-test-.*\.db(?:-(?:shm|wal))?$/u.test(entry)) {
      rmSync(path.join(dataDir, entry), { force: true });
      removed += 1;
    }
  }
} catch (error) {
  if (!error || typeof error !== "object" || error.code !== "ENOENT") {
    throw error;
  }
}

if (removed > 0) {
  console.log(`Removed ${removed} test database file${removed === 1 ? "" : "s"}.`);
}
