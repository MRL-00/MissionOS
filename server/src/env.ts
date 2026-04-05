import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(serverRoot, ".env");

let loaded = false;

export function loadServerEnv(): void {
  if (loaded) {
    return;
  }

  loaded = true;

  if (!existsSync(envPath)) {
    return;
  }

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/gu, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function getJwtSecret(): string {
  loadServerEnv();
  return process.env.JWT_SECRET ?? "missionos-dev-secret";
}

export function getPort(): number {
  const value = Number(process.env.PORT ?? 3001);
  return Number.isFinite(value) ? value : 3001;
}
