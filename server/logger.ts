type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return "info";
}

function currentLogLevel(): LogLevel {
  const envLevel = process.env.OFFICE_LOG_LEVEL ?? process.env.LOG_LEVEL;
  if (process.env.OFFICE_DEBUG?.trim() && process.env.OFFICE_DEBUG !== "0" && !envLevel) {
    return "debug";
  }
  return normalizeLogLevel(envLevel);
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLogLevel()];
}

function truncateText(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function sanitizeMetaValue(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateText(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((entry) => sanitizeMetaValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).slice(0, 12).map(([key, entry]) => [key, sanitizeMetaValue(entry)]),
    );
  }
  return value;
}

function formatMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }

  try {
    return ` ${JSON.stringify(sanitizeMetaValue(meta))}`;
  } catch {
    return " [meta-unserializable]";
  }
}

function log(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) {
    return;
  }

  const line = `[office][${scope}][${level}] ${message}${formatMeta(meta)}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function logDebug(scope: string, message: string, meta?: Record<string, unknown>): void {
  log("debug", scope, message, meta);
}

export function logInfo(scope: string, message: string, meta?: Record<string, unknown>): void {
  log("info", scope, message, meta);
}

export function logWarn(scope: string, message: string, meta?: Record<string, unknown>): void {
  log("warn", scope, message, meta);
}

export function logError(scope: string, message: string, meta?: Record<string, unknown>): void {
  log("error", scope, message, meta);
}

export function summarizeText(value: string | undefined, maxLength = 120): string {
  return truncateText(value ?? "", maxLength);
}
