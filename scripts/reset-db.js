import { rmSync } from "node:fs";
import path from "node:path";

const dbPath = path.resolve("server/data/missionos.db");
rmSync(dbPath, { force: true });
console.log(`Removed ${dbPath}`);
