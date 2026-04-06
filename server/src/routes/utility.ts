import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { getDb } from "../db.js";
import { readSettingsMap } from "../linear.js";

export function registerUtilityRoutes(app: Express, docsRoot: string) {
  app.get("/api/settings", (_req, res) => {
    const settings = getDb().prepare("SELECT key, value FROM settings ORDER BY key ASC").all();
    res.json({ settings, settingsMap: readSettingsMap() });
  });

  app.put("/api/settings", (req, res) => {
    const settings = Array.isArray(req.body) ? req.body : (req.body as { settings?: unknown[] }).settings;
    if (!Array.isArray(settings)) {
      res.status(400).json({ error: "Settings payload must be an array." });
      return;
    }

    const statement = getDb().prepare(
      `
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
    );
    const transaction = getDb().transaction((items: unknown[]) => {
      for (const item of items as Array<{ key: string; value: string }>) {
        statement.run(item.key, item.value);
      }
    });
    transaction(settings);
    res.json({ ok: true, settingsMap: readSettingsMap() });
  });

  app.get("/api/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.json({ agents: [], missions: [], issues: [], runs: [], comments: [] });
      return;
    }

    const term = `%${q}%`;
    const db = getDb();
    const agents = db.prepare("SELECT id, name, role FROM agents WHERE name LIKE ? OR role LIKE ? LIMIT 10").all(term, term);
    const missions = db
      .prepare("SELECT id, title, description FROM missions WHERE title LIKE ? OR description LIKE ? LIMIT 10")
      .all(term, term);
    const issues = db
      .prepare("SELECT id, title, description FROM issues WHERE title LIKE ? OR description LIKE ? LIMIT 10")
      .all(term, term);
    const runs = db
      .prepare(
        `
        SELECT id, prompt, substr(coalesce(output, ''), max(length(output) - 500, 1), 500) AS output
        FROM runs
        WHERE prompt LIKE ? OR output LIKE ?
        LIMIT 10
        `,
      )
      .all(term, term);
    const comments = db
      .prepare("SELECT id, issue_id, body FROM issue_comments WHERE body LIKE ? LIMIT 10")
      .all(term);

    res.json({ agents, missions, issues, runs, comments });
  });

  app.get("/api/docs/tree", (_req, res) => {
    res.json({ files: resolveDocFiles(docsRoot) });
  });

  app.get("/api/docs/content", (req, res) => {
    const requestedPath = typeof req.query.path === "string" ? req.query.path : "";
    const safePath = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+?/u, "");
    const absolutePath = path.join(docsRoot, safePath);
    if (!absolutePath.startsWith(docsRoot) || !existsSync(absolutePath)) {
      res.status(404).json({ error: "Document not found." });
      return;
    }

    res.json({
      path: safePath,
      content: readFileSync(absolutePath, "utf8"),
    });
  });

  app.post("/api/feedback", (req, res) => {
    const { type, message } = req.body as { type?: string; message?: string };
    if (!type || !message) {
      res.status(400).json({ error: "Feedback type and message are required." });
      return;
    }

    const feedback = {
      id: randomUUID(),
      type,
      message,
    };
    getDb().prepare("INSERT INTO feedback (id, type, message) VALUES (?, ?, ?)").run(feedback.id, feedback.type, feedback.message);
    res.status(201).json({ feedback });
  });
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
