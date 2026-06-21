import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(serverRoot, ".env");
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

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
  return resolveJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV);
}

export function getPort(): number {
  return parsePort(process.env.PORT);
}

export function getCorsOrigin(): boolean | string[] {
  return parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS, process.env.NODE_ENV);
}

export function resolveJwtSecret(value: string | undefined, nodeEnv: string | undefined): string {
  const secret = value?.trim();
  if (secret) {
    if (nodeEnv === "production" && secret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
      throw new Error(`JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production.`);
    }
    return secret;
  }
  if (nodeEnv === "production") {
    throw new Error("JWT_SECRET must be configured in production.");
  }
  return "missionos-dev-secret";
}

export function parsePort(value: string | undefined): number {
  const port = Number(value ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 3001;
  }
  return port;
}

export function parseCorsOrigins(value: string | undefined, nodeEnv: string | undefined): boolean | string[] {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return nodeEnv === "production" ? false : true;
  }

  if (origins.includes("*")) {
    return nodeEnv === "production" ? false : true;
  }

  return origins;
}
