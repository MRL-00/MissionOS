import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { getDb } from "../db.js";
import { engineMap } from "../engines/index.js";
import { readSettingsMap } from "../linear.js";
import { MASKED_SECRET_VALUE, normalizeSettingsSecretsForSave, sanitizeSettingsMap as sanitizeEngineSettingsMap } from "../secretConfig.js";

type SettingInput = { key: string; value: string };
type SettingsPayloadResult = { ok: true; settings: SettingInput[] } | { ok: false; error: string };
type FeedbackPayload = { type: string; message: string };
type FeedbackPayloadResult = { ok: true; payload: FeedbackPayload } | { ok: false; error: string };
type SearchQuery = { raw: string; likeTerm: string };

export const MASKED_SETTING_VALUE = MASKED_SECRET_VALUE;
const SECRET_SETTING_KEYS = new Set(["github_pat", "linear_api_key"]);
const PRODUCT_SETTING_KEYS = new Set([
  "github_pat",
  "github_workspace_dir",
  "issue_prefix",
  "linear_api_key",
  "linear_use_for_issues",
  "project_logo",
  "usage_currency",
  "usage_usd_exchange_rate",
  "user_timezone",
]);
const MAX_SETTING_COUNT = 200;
const MAX_SETTING_KEY_LENGTH = 120;
const MAX_SETTING_VALUE_LENGTH = 20_000;
const MAX_FEEDBACK_TYPE_LENGTH = 80;
const MAX_FEEDBACK_MESSAGE_LENGTH = 5_000;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function sanitizeSettingsMap(settings: Record<string, string>): Record<string, string> {
  const topLevelSanitized = Object.fromEntries(
    Object.entries(settings)
      .filter(([key]) => isAllowedSettingKey(key))
      .map(([key, value]) => [key, SECRET_SETTING_KEYS.has(key) && value ? MASKED_SETTING_VALUE : value]),
  );
  return sanitizeEngineSettingsMap(topLevelSanitized, engineMap);
}

export function normalizeSettingsForSave(settings: SettingInput[], existingSettings: Record<string, string>): SettingInput[] {
  const topLevelNormalized = settings.map((setting) => {
    if (SECRET_SETTING_KEYS.has(setting.key) && setting.value === MASKED_SETTING_VALUE) {
      return { ...setting, value: existingSettings[setting.key] ?? "" };
    }
    return setting;
  });
  return normalizeSettingsSecretsForSave(topLevelNormalized, existingSettings, engineMap);
}

export function isAllowedSettingKey(key: string): boolean {
  if (PRODUCT_SETTING_KEYS.has(key)) {
    return true;
  }
  const engineMatch = /^engine\.([A-Za-z0-9_-]+)$/u.exec(key);
  return Boolean(engineMatch?.[1] && engineMap.has(engineMatch[1]));
}

export function parseSettingsPayload(value: unknown): SettingsPayloadResult {
  const settings = Array.isArray(value) ? value : (value as { settings?: unknown[] } | null)?.settings;
  if (!Array.isArray(settings)) {
    return { ok: false, error: "Settings payload must be an array." };
  }
  if (settings.length > MAX_SETTING_COUNT) {
    return { ok: false, error: `Settings payload must include ${MAX_SETTING_COUNT} or fewer entries.` };
  }

  const parsed: SettingInput[] = [];
  for (const [index, item] of settings.entries()) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: `Setting ${index + 1} must be an object.` };
    }
    const row = item as Record<string, unknown>;
    const key = optionalString(row.key);
    if (!key) {
      return { ok: false, error: `Setting ${index + 1} requires a key.` };
    }
    if (key.length > MAX_SETTING_KEY_LENGTH) {
      return { ok: false, error: `Setting ${index + 1} key must be ${MAX_SETTING_KEY_LENGTH} characters or fewer.` };
    }
    if (!isAllowedSettingKey(key)) {
      return { ok: false, error: `Setting ${index + 1} key is not supported.` };
    }
    const settingValue = typeof row.value === "string" ? row.value : "";
    if (settingValue.length > MAX_SETTING_VALUE_LENGTH) {
      return { ok: false, error: `Setting ${index + 1} value must be ${MAX_SETTING_VALUE_LENGTH} characters or fewer.` };
    }
    parsed.push({
      key,
      value: settingValue,
    });
  }

  return { ok: true, settings: parsed };
}

export function parseFeedbackPayload(body: Record<string, unknown>): FeedbackPayloadResult {
  const type = optionalString(body.type);
  const message = optionalString(body.message);
  if (!type || !message) {
    return { ok: false, error: "Feedback type and message are required." };
  }
  if (type.length > MAX_FEEDBACK_TYPE_LENGTH) {
    return { ok: false, error: `Feedback type must be ${MAX_FEEDBACK_TYPE_LENGTH} characters or fewer.` };
  }
  if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
    return { ok: false, error: `Feedback message must be ${MAX_FEEDBACK_MESSAGE_LENGTH} characters or fewer.` };
  }
  return { ok: true, payload: { type, message } };
}

export function parseSearchQuery(value: unknown): SearchQuery | null {
  const raw = optionalString(value);
  if (!raw) {
    return null;
  }

  const limited = raw.slice(0, 100);
  return { raw: limited, likeTerm: `%${escapeLikeTerm(limited)}%` };
}

export function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

export function registerUtilityRoutes(app: Express, docsRoot: string) {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/settings", (_req, res) => {
    const settingsMap = sanitizeSettingsMap(readSettingsMap());
    const settings = Object.entries(settingsMap)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value }));
    res.json({ settings, settingsMap });
  });

  app.put("/api/settings", (req, res) => {
    const result = parseSettingsPayload(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    const settings = normalizeSettingsForSave(result.settings, readSettingsMap());
    const statement = getDb().prepare(
      `
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
    );
    const transaction = getDb().transaction((items: SettingInput[]) => {
      for (const item of items) {
        statement.run(item.key, item.value);
      }
    });
    transaction(settings);
    res.json({ ok: true, settingsMap: sanitizeSettingsMap(readSettingsMap()) });
  });

  app.get("/api/search", (req, res) => {
    const query = parseSearchQuery(req.query.q);
    if (!query) {
      res.json({ agents: [], missions: [], issues: [], runs: [], comments: [] });
      return;
    }

    const term = query.likeTerm;
    const db = getDb();
    const agents = db.prepare("SELECT id, name, role FROM agents WHERE name LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\' LIMIT 10").all(term, term);
    const missions = db
      .prepare(
        `
        SELECT id, title, description, team_name
        FROM missions
        WHERE title LIKE ? ESCAPE '\\'
          OR description LIKE ? ESCAPE '\\'
          OR team_name LIKE ? ESCAPE '\\'
        LIMIT 10
        `,
      )
      .all(term, term, term);
    const issues = db
      .prepare("SELECT id, title, description FROM issues WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' LIMIT 10")
      .all(term, term);
    const runs = db
      .prepare(
        `
        SELECT id, prompt, substr(coalesce(output, ''), max(length(output) - 500, 1), 500) AS output
        FROM runs
        WHERE prompt LIKE ? ESCAPE '\\' OR output LIKE ? ESCAPE '\\'
        LIMIT 10
        `,
      )
      .all(term, term);
    const comments = db
      .prepare("SELECT id, issue_id, body FROM issue_comments WHERE body LIKE ? ESCAPE '\\' LIMIT 10")
      .all(term);

    res.json({ agents, missions, issues, runs, comments });
  });

  app.get("/api/docs/tree", (_req, res) => {
    res.json({ files: resolveDocFiles(docsRoot) });
  });

  app.get("/api/docs/content", (req, res) => {
    const requestedPath = typeof req.query.path === "string" ? req.query.path : "";
    const resolved = resolveDocContentPath(docsRoot, requestedPath);
    if (!resolved) {
      res.status(404).json({ error: "Document not found." });
      return;
    }

    res.json({
      path: resolved.safePath,
      content: readFileSync(resolved.absolutePath, "utf8"),
    });
  });

  app.post("/api/feedback", (req, res) => {
    const result = parseFeedbackPayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    const feedback = {
      id: randomUUID(),
      type: result.payload.type,
      message: result.payload.message,
    };
    getDb().prepare("INSERT INTO feedback (id, type, message) VALUES (?, ?, ?)").run(feedback.id, feedback.type, feedback.message);
    res.status(201).json({ feedback });
  });
}

export function resolveDocContentPath(
  docsRoot: string,
  requestedPath: string,
): { safePath: string; absolutePath: string } | null {
  if (!existsSync(docsRoot)) {
    return null;
  }
  const root = realpathSync(docsRoot);
  const safePath = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+?/u, "").replace(/\\/gu, "/");
  if (!safePath || !safePath.endsWith(".md")) {
    return null;
  }

  const absolutePath = path.resolve(root, safePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  const realAbsolutePath = realpathSync(absolutePath);
  const relativePath = path.relative(root, realAbsolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  const stats = statSync(realAbsolutePath);
  if (!stats.isFile()) {
    return null;
  }

  return { safePath, absolutePath: realAbsolutePath };
}

function resolveDocFiles(directory: string, prefix = ""): Array<{ path: string; title: string }> {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = readdirSync(directory);
  const files: Array<{ path: string; title: string }> = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    const linkStats = lstatSync(absolutePath);
    if (linkStats.isSymbolicLink()) {
      continue;
    }
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...resolveDocFiles(absolutePath, relativePath));
      continue;
    }

    if (entry.endsWith(".md")) {
      files.push({
        path: relativePath.replace(/\\/gu, "/"),
        title: entry.replace(/\.md$/u, "").replace(/-/gu, " "),
      });
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}
