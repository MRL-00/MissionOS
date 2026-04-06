import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getDb, resetDatabase } from "../db.js";
import { getJwtSecret } from "../env.js";
import { serializeUser, type AuthenticatedRequest, type UserRow } from "../serializers.js";

function getBootstrapState() {
  const db = getDb();
  const hasAccount = Number((db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count) > 0;
  const hasAgents = Number((db.prepare("SELECT COUNT(*) AS count FROM agents").get() as { count: number }).count) > 0;
  const hasProject =
    Number((db.prepare("SELECT COUNT(*) AS count FROM project").get() as { count: number }).count) > 0;
  return { hasAccount, hasAgents, hasProject };
}

function signToken(user: UserRow): string {
  return jwt.sign({ sub: user.id, username: user.username }, getJwtSecret(), { expiresIn: "7d" });
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }

  if (
    req.path === "/api/bootstrap" ||
    req.path === "/api/auth/register" ||
    req.path === "/api/auth/login"
  ) {
    next();
    return;
  }

  const authorization = req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing token." });
    return;
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const payload = jwt.verify(token, getJwtSecret()) as { sub: string };
    const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(payload.sub) as UserRow | undefined;
    if (!user) {
      res.status(401).json({ error: "Invalid token." });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token." });
  }
}

export function registerAuthRoutes(app: Express) {
  app.get("/api/bootstrap", (_req, res) => {
    res.json(getBootstrapState());
  });

  app.post("/api/auth/register", async (req, res) => {
    const { username, password, displayName } = req.body as {
      username?: string;
      password?: string;
      displayName?: string;
    };

    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required." });
      return;
    }

    const db = getDb();
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: string } | undefined;
    if (existing) {
      res.status(409).json({ error: "Username already exists." });
      return;
    }

    const user: UserRow = {
      id: randomUUID(),
      username,
      password_hash: await bcrypt.hash(password, 12),
      display_name: displayName ?? username,
      avatar_emoji: "👤",
      created_at: new Date().toISOString(),
    };

    db.prepare(
      `
      INSERT INTO users (id, username, password_hash, display_name, avatar_emoji, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(user.id, user.username, user.password_hash, user.display_name, user.avatar_emoji, user.created_at);

    res.status(201).json({ token: signToken(user), user: serializeUser(user) });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required." });
      return;
    }

    const user = getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
    if (!user) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }

    res.json({ token: signToken(user), user: serializeUser(user) });
  });

  app.get("/api/auth/me", (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    res.json({ user: serializeUser(req.user) });
  });

  app.put("/api/auth/profile", (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const { displayName, avatarEmoji } = req.body as { displayName?: string; avatarEmoji?: string };
    getDb()
      .prepare("UPDATE users SET display_name = ?, avatar_emoji = ? WHERE id = ?")
      .run(displayName ?? req.user.display_name, avatarEmoji ?? req.user.avatar_emoji, req.user.id);
    const updated = getDb().prepare("SELECT * FROM users WHERE id = ?").get(req.user.id) as UserRow;
    res.json({ user: serializeUser(updated) });
  });

  app.put("/api/auth/password", async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "Current and new passwords are required." });
      return;
    }

    const ok = await bcrypt.compare(currentPassword, req.user.password_hash);
    if (!ok) {
      res.status(400).json({ error: "Current password is incorrect." });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, req.user.id);
    res.json({ ok: true });
  });

  // ── Project ──

  app.get("/api/project", (_req, res) => {
    const project = getDb().prepare("SELECT * FROM project LIMIT 1").get() ?? null;
    res.json({ project });
  });

  app.post("/api/project", (req, res) => {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name) {
      res.status(400).json({ error: "Project name is required." });
      return;
    }

    const db = getDb();
    db.prepare("DELETE FROM project").run();
    const project = {
      id: randomUUID(),
      name,
      description: description ?? null,
    };
    db.prepare("INSERT INTO project (id, name, description) VALUES (?, ?, ?)").run(project.id, project.name, project.description);
    res.status(201).json({ project });
  });

  app.delete("/api/project", (_req, res) => {
    resetDatabase();
    res.json({ ok: true, bootstrap: getBootstrapState() });
  });
}
