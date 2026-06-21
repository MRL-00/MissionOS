import { randomUUID } from "node:crypto";
import type { Express, NextFunction, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getDb, resetDatabase } from "../db.js";
import { getJwtSecret } from "../env.js";
import { serializeUser, type AuthenticatedRequest, type UserRow } from "../serializers.js";

type RegisterPayload = { username: string; password: string; displayName: string };
type LoginPayload = { username: string; password: string };
type ProfilePayload = { displayName: string | null; avatarEmoji: string | null };
type PasswordPayload = { currentPassword: string; newPassword: string };
type ProjectPayload = { name: string; description: string | null };
type ProjectResetPayload = { confirmName: string };
type PayloadResult<T> = { ok: true; payload: T } | { ok: false; error: string };
type RegistrationInsertResult = { ok: true } | { ok: false; status: number; error: string };
type RateLimitBucket = { attempts: number[]; updatedAt: number };
type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number; error: string };
const MIN_PASSWORD_LENGTH = 8;
const MAX_USERNAME_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 256;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_AVATAR_LENGTH = 16;
const MAX_PROJECT_NAME_LENGTH = 120;
const MAX_PROJECT_DESCRIPTION_LENGTH = 2_000;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 20;
const AUTH_RATE_LIMIT_MAX_BUCKETS = 5_000;
const authRateLimitBuckets = new Map<string, RateLimitBucket>();

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rateLimitKey(scope: string, identifier: string): string {
  return `${scope}:${identifier.trim().toLowerCase()}`;
}

function pruneAuthRateLimitBuckets(now: number, windowMs: number, nextKey: string, maxBuckets: number): void {
  for (const [key, bucket] of authRateLimitBuckets) {
    bucket.attempts = bucket.attempts.filter((attempt) => now - attempt < windowMs);
    if (bucket.attempts.length === 0) {
      authRateLimitBuckets.delete(key);
    }
  }

  if (authRateLimitBuckets.has(nextKey)) {
    return;
  }

  while (authRateLimitBuckets.size >= maxBuckets) {
    let oldestKey: string | null = null;
    let oldestUpdatedAt = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of authRateLimitBuckets) {
      if (bucket.updatedAt < oldestUpdatedAt) {
        oldestUpdatedAt = bucket.updatedAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) {
      break;
    }
    authRateLimitBuckets.delete(oldestKey);
  }
}

export function checkAuthRateLimit(
  scope: string,
  identifier: string,
  now = Date.now(),
  options: { maxAttempts?: number; windowMs?: number; maxBuckets?: number } = {},
): RateLimitResult {
  const maxAttempts = options.maxAttempts ?? AUTH_RATE_LIMIT_MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? AUTH_RATE_LIMIT_WINDOW_MS;
  const maxBuckets = Math.max(1, options.maxBuckets ?? AUTH_RATE_LIMIT_MAX_BUCKETS);
  const key = rateLimitKey(scope, identifier || "unknown");
  pruneAuthRateLimitBuckets(now, windowMs, key, maxBuckets);
  const bucket = authRateLimitBuckets.get(key) ?? { attempts: [], updatedAt: now };
  bucket.attempts = bucket.attempts.filter((attempt) => now - attempt < windowMs);

  if (bucket.attempts.length >= maxAttempts) {
    const oldestAttempt = bucket.attempts[0] ?? now;
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldestAttempt)) / 1000)),
      error: "Too many authentication attempts. Please try again later.",
    };
  }

  bucket.attempts.push(now);
  bucket.updatedAt = now;
  authRateLimitBuckets.set(key, bucket);
  return { ok: true };
}

export function clearAuthRateLimit(scope: string, identifier: string): void {
  authRateLimitBuckets.delete(rateLimitKey(scope, identifier || "unknown"));
}

export function resetAuthRateLimitsForTests(): void {
  authRateLimitBuckets.clear();
}

export function validatePasswordStrength(password: string): PayloadResult<null> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.` };
  }
  return { ok: true, payload: null };
}

export function validateTextLength(label: string, value: string | null, maxLength: number): PayloadResult<null> {
  if (value && value.length > maxLength) {
    return { ok: false, error: `${label} must be ${maxLength} characters or fewer.` };
  }
  return { ok: true, payload: null };
}

export function parseRegisterPayload(body: Record<string, unknown>): PayloadResult<RegisterPayload> {
  const username = optionalString(body.username);
  const password = optionalString(body.password);
  if (!username || !password) {
    return { ok: false, error: "Username and password are required." };
  }
  const displayName = optionalString(body.displayName) ?? username;
  const usernameLength = validateTextLength("Username", username, MAX_USERNAME_LENGTH);
  if (!usernameLength.ok) {
    return usernameLength;
  }
  const passwordStrength = validatePasswordStrength(password);
  if (!passwordStrength.ok) {
    return passwordStrength;
  }
  const displayNameLength = validateTextLength("Display name", displayName, MAX_DISPLAY_NAME_LENGTH);
  if (!displayNameLength.ok) {
    return displayNameLength;
  }
  return { ok: true, payload: { username, password, displayName } };
}

export function parseLoginPayload(body: Record<string, unknown>): PayloadResult<LoginPayload> {
  const username = optionalString(body.username);
  const password = optionalString(body.password);
  if (!username || !password) {
    return { ok: false, error: "Username and password are required." };
  }
  const usernameLength = validateTextLength("Username", username, MAX_USERNAME_LENGTH);
  if (!usernameLength.ok) {
    return usernameLength;
  }
  const passwordLength = validateTextLength("Password", password, MAX_PASSWORD_LENGTH);
  if (!passwordLength.ok) {
    return passwordLength;
  }
  return { ok: true, payload: { username, password } };
}

export function parseProfilePayload(body: Record<string, unknown>): ProfilePayload {
  const displayName = optionalString(body.displayName);
  const avatarEmoji = optionalString(body.avatarEmoji);
  const displayNameLength = validateTextLength("Display name", displayName, MAX_DISPLAY_NAME_LENGTH);
  if (!displayNameLength.ok) {
    throw new Error(displayNameLength.error);
  }
  const avatarLength = validateTextLength("Avatar emoji", avatarEmoji, MAX_AVATAR_LENGTH);
  if (!avatarLength.ok) {
    throw new Error(avatarLength.error);
  }
  return { displayName, avatarEmoji };
}

export function parsePasswordPayload(body: Record<string, unknown>): PayloadResult<PasswordPayload> {
  const currentPassword = optionalString(body.currentPassword);
  const newPassword = optionalString(body.newPassword);
  if (!currentPassword || !newPassword) {
    return { ok: false, error: "Current and new passwords are required." };
  }
  const currentPasswordLength = validateTextLength("Current password", currentPassword, MAX_PASSWORD_LENGTH);
  if (!currentPasswordLength.ok) {
    return currentPasswordLength;
  }
  const passwordStrength = validatePasswordStrength(newPassword);
  if (!passwordStrength.ok) {
    return passwordStrength;
  }
  return { ok: true, payload: { currentPassword, newPassword } };
}

export function parseProjectPayload(body: Record<string, unknown>): PayloadResult<ProjectPayload> {
  const name = optionalString(body.name);
  const description = optionalString(body.description);
  if (!name) {
    return { ok: false, error: "Project name is required." };
  }
  const nameLength = validateTextLength("Project name", name, MAX_PROJECT_NAME_LENGTH);
  if (!nameLength.ok) {
    return nameLength;
  }
  const descriptionLength = validateTextLength("Project description", description, MAX_PROJECT_DESCRIPTION_LENGTH);
  if (!descriptionLength.ok) {
    return descriptionLength;
  }
  return { ok: true, payload: { name, description } };
}

export function parseProjectResetPayload(body: Record<string, unknown>): PayloadResult<ProjectResetPayload> {
  const confirmName = optionalString(body.confirmName);
  if (!confirmName) {
    return { ok: false, error: "Project name confirmation is required." };
  }
  return { ok: true, payload: { confirmName } };
}

export function validateProjectResetConfirmation(projectName: string | null, confirmName: string): PayloadResult<ProjectResetPayload> {
  if (!projectName) {
    return { ok: false, error: "No project exists to reset." };
  }
  if (projectName !== confirmName) {
    return { ok: false, error: "Project name does not match." };
  }
  return { ok: true, payload: { confirmName } };
}

export function validateRegistrationOpen(hasAccount: boolean): PayloadResult<null> {
  if (hasAccount) {
    return { ok: false, error: "Registration is closed after the first account is created." };
  }
  return { ok: true, payload: null };
}

export function insertInitialUser(database: ReturnType<typeof getDb>, user: UserRow): RegistrationInsertResult {
  const insertUser = database.transaction((): RegistrationInsertResult => {
    const registration = validateRegistrationOpen(
      Number((database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count) > 0,
    );
    if (!registration.ok) {
      return { ok: false, status: 403, error: registration.error };
    }

    const existing = database.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string } | undefined;
    if (existing) {
      return { ok: false, status: 409, error: "Username already exists." };
    }

    database.prepare(
      `
      INSERT INTO users (id, username, password_hash, display_name, avatar_emoji, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(user.id, user.username, user.password_hash, user.display_name, user.avatar_emoji, user.created_at);
    return { ok: true };
  });

  return insertUser();
}

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
    req.path === "/api/health" ||
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
    const result = parseRegisterPayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { username, password, displayName } = result.payload;
    const limit = checkAuthRateLimit("register", username);
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      res.status(429).json({ error: limit.error });
      return;
    }

    const db = getDb();
    const registration = validateRegistrationOpen(
      Number((db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count) > 0,
    );
    if (!registration.ok) {
      res.status(403).json({ error: registration.error });
      return;
    }

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

    const inserted = insertInitialUser(db, user);
    if (!inserted.ok) {
      res.status(inserted.status).json({ error: inserted.error });
      return;
    }
    clearAuthRateLimit("register", username);

    res.status(201).json({ token: signToken(user), user: serializeUser(user) });
  });

  app.post("/api/auth/login", async (req, res) => {
    const result = parseLoginPayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { username, password } = result.payload;
    const limit = checkAuthRateLimit("login", username);
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      res.status(429).json({ error: limit.error });
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
    clearAuthRateLimit("login", username);

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

    let profile: ProfilePayload;
    try {
      profile = parseProfilePayload(req.body as Record<string, unknown>);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid profile payload." });
      return;
    }
    const { displayName, avatarEmoji } = profile;
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

    const result = parsePasswordPayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { currentPassword, newPassword } = result.payload;

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
    const result = parseProjectPayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { name, description } = result.payload;

    const db = getDb();
    const project = {
      id: randomUUID(),
      name,
      description: description ?? null,
    };
    const replaceProject = db.transaction(() => {
      db.prepare("DELETE FROM project").run();
      db.prepare("INSERT INTO project (id, name, description) VALUES (?, ?, ?)").run(project.id, project.name, project.description);
    });
    replaceProject();
    res.status(201).json({ project });
  });

  app.delete("/api/project", (req, res) => {
    const result = parseProjectResetPayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    const project = getDb().prepare("SELECT name FROM project LIMIT 1").get() as { name: string } | undefined;
    const confirmation = validateProjectResetConfirmation(project?.name ?? null, result.payload.confirmName);
    if (!confirmation.ok) {
      res.status(400).json({ error: confirmation.error });
      return;
    }

    resetDatabase();
    res.json({ ok: true, bootstrap: getBootstrapState() });
  });
}
