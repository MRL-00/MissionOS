import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getDb } from "../db.js";
import { engineMap } from "../engines/index.js";
import { parseGitHubRepoFullName } from "../git-workspace.js";
import { syncGitHubIssuesToLocal } from "../github-service.js";
import {
  createLinearComment,
  createLinearIssue,
  linearRequest,
  patchLinearIssue,
  readSettingsMap,
  syncLinearIssueToLocal,
} from "../linear.js";
import { setIssueWorkflowStatus } from "../workflow.js";
import { startIssueWorkflowForStatus } from "../execution.js";
import { getIssueById, listIssues, parseListLimit } from "../queries.js";
import type { AuthenticatedRequest } from "../serializers.js";

const ISSUE_STATUSES = new Set(["backlog", "todo", "in_progress", "in_review", "qa", "done", "canceled"]);
const ISSUE_PRIORITIES = new Set(["urgent", "high", "medium", "low"]);
const ISSUE_SOURCES = new Set(["native", "linear", "github"]);
const MAX_ISSUE_TITLE_LENGTH = 180;
const MAX_ISSUE_DESCRIPTION_LENGTH = 10_000;
const MAX_LABEL_LENGTH = 60;
const MAX_LABEL_COUNT = 20;
const MAX_ESTIMATION_LENGTH = 40;
const MAX_COMMENT_BODY_LENGTH = 10_000;
const MAX_ISSUE_FILTER_LENGTH = 120;

type IssuePayload = {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  missionId: string | null;
  githubRepo: string | null;
  labels: string[];
  source: string;
  linearId: string | null;
  estimation: string | null;
};

type IssuePayloadResult = { ok: true; payload: IssuePayload } | { ok: false; error: string };
type IssueReferenceValidationInput = {
  assigneeAgentId: string | null;
  missionId: string | null;
  assigneeExists: boolean;
  assigneeActive?: boolean | undefined;
  assigneeEngineSupported?: boolean | undefined;
  assigneeAssignedToMission?: boolean | undefined;
  missionExists: boolean;
};
type IssueReferenceValidationResult = { ok: true } | { ok: false; status: number; error: string };
type CommentPayload = {
  body: string;
  parentId: string | null;
};
type CommentPayloadResult = { ok: true; payload: CommentPayload } | { ok: false; error: string };

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalFilterString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, MAX_ISSUE_FILTER_LENGTH);
}

function optionalIssueStatus(value: unknown): string | undefined {
  const status = optionalFilterString(value);
  return status && ISSUE_STATUSES.has(status) ? status : undefined;
}

function optionalIssuePriority(value: unknown): string | undefined {
  const priority = optionalFilterString(value);
  return priority && ISSUE_PRIORITIES.has(priority) ? priority : undefined;
}

export function parseIssueListQuery(query: Record<string, unknown>) {
  return {
    status: optionalIssueStatus(query.status),
    assignee: optionalFilterString(query.assignee),
    missionId: optionalFilterString(query.mission_id),
    q: typeof query.q === "string" ? query.q : undefined,
    priority: optionalIssuePriority(query.priority),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function validateTextLength(label: string, value: string | null, maxLength: number): string | null {
  if (value && value.length > maxLength) {
    return `${label} must be ${maxLength} characters or fewer.`;
  }
  return null;
}

export function parseIssuePayload(body: Record<string, unknown>): IssuePayloadResult {
  const title = optionalString(body.title);
  if (!title) {
    return { ok: false, error: "Issue title is required." };
  }
  const titleLengthError = validateTextLength("Issue title", title, MAX_ISSUE_TITLE_LENGTH);
  if (titleLengthError) {
    return { ok: false, error: titleLengthError };
  }

  const status = optionalString(body.status) ?? "backlog";
  if (!ISSUE_STATUSES.has(status)) {
    return { ok: false, error: "Issue status must be backlog, todo, in_progress, in_review, qa, done, or canceled." };
  }

  const priority = optionalString(body.priority) ?? "medium";
  if (!ISSUE_PRIORITIES.has(priority)) {
    return { ok: false, error: "Issue priority must be urgent, high, medium, or low." };
  }

  const source = optionalString(body.source) ?? "native";
  if (!ISSUE_SOURCES.has(source)) {
    return { ok: false, error: "Issue source must be native, linear, or github." };
  }
  const description = optionalString(body.description);
  const estimation = optionalString(body.estimation);
  const githubRepo = optionalString(body.github_repo);
  const labels = stringArray(body.labels);
  const descriptionLengthError = validateTextLength("Issue description", description, MAX_ISSUE_DESCRIPTION_LENGTH);
  if (descriptionLengthError) {
    return { ok: false, error: descriptionLengthError };
  }
  const estimationLengthError = validateTextLength("Issue estimation", estimation, MAX_ESTIMATION_LENGTH);
  if (estimationLengthError) {
    return { ok: false, error: estimationLengthError };
  }
  if (labels.length > MAX_LABEL_COUNT) {
    return { ok: false, error: `Issue labels must include ${MAX_LABEL_COUNT} or fewer entries.` };
  }
  if (labels.some((label) => label.length > MAX_LABEL_LENGTH)) {
    return { ok: false, error: `Issue labels must be ${MAX_LABEL_LENGTH} characters or fewer.` };
  }
  if (githubRepo && !parseGitHubRepoFullName(githubRepo)) {
    return { ok: false, error: "GitHub repository must use owner/repo format with supported characters." };
  }

  return {
    ok: true,
    payload: {
      title,
      description,
      status,
      priority,
      assigneeAgentId: optionalString(body.assignee_agent_id),
      missionId: optionalString(body.mission_id),
      githubRepo,
      labels,
      source,
      linearId: optionalString(body.linear_id),
      estimation,
    },
  };
}

export function validateIssueReferences(input: IssueReferenceValidationInput): IssueReferenceValidationResult {
  if (input.assigneeAgentId && !input.assigneeExists) {
    return { ok: false, status: 404, error: "Assignee agent not found." };
  }
  if (input.assigneeAgentId && input.assigneeActive === false) {
    return { ok: false, status: 409, error: "Assignee agent is inactive." };
  }
  if (input.assigneeAgentId && input.assigneeEngineSupported === false) {
    return { ok: false, status: 409, error: "Assignee agent engine is not supported." };
  }
  if (input.missionId && !input.missionExists) {
    return { ok: false, status: 404, error: "Mission not found." };
  }
  if (input.assigneeAgentId && input.missionId && input.assigneeAssignedToMission === false) {
    return { ok: false, status: 409, error: "Assignee agent is not assigned to this mission." };
  }
  return { ok: true };
}

export function parseCommentPayload(body: Record<string, unknown>): CommentPayloadResult {
  const commentBody = optionalString(body.body);
  if (!commentBody) {
    return { ok: false, error: "Comment body is required." };
  }
  const commentLengthError = validateTextLength("Comment body", commentBody, MAX_COMMENT_BODY_LENGTH);
  if (commentLengthError) {
    return { ok: false, error: commentLengthError };
  }
  return {
    ok: true,
    payload: {
      body: commentBody,
      parentId: optionalString(body.parentId),
    },
  };
}

export function formatIssueSyncError(error: unknown, fallback = "Sync failed."): string {
  return error instanceof Error ? error.message : fallback;
}

export function deleteIssueCommentForIssue(issueId: string, commentId: string): number {
  const db = getDb();
  return db.transaction(() => {
    db.prepare("UPDATE issue_comments SET parent_id = NULL WHERE parent_id = ?").run(commentId);
    return db.prepare("DELETE FROM issue_comments WHERE id = ? AND issue_id = ?").run(commentId, issueId).changes;
  })();
}

function checkIssueReferences(payload: IssuePayload): IssueReferenceValidationResult {
  const db = getDb();
  const assignee = payload.assigneeAgentId
    ? (db.prepare("SELECT active, engine FROM agents WHERE id = ?").get(payload.assigneeAgentId) as
        | { active: number | null; engine: string | null }
        | undefined)
    : undefined;
  const missionExists = payload.missionId ? Boolean(db.prepare("SELECT 1 FROM missions WHERE id = ?").get(payload.missionId)) : false;
  const assigneeAssignedToMission = payload.assigneeAgentId && payload.missionId && missionExists
    ? Boolean(
        db.prepare("SELECT 1 FROM mission_agents WHERE mission_id = ? AND agent_id = ?").get(payload.missionId, payload.assigneeAgentId),
      )
    : undefined;
  return validateIssueReferences({
    assigneeAgentId: payload.assigneeAgentId,
    missionId: payload.missionId,
    assigneeExists: Boolean(assignee),
    assigneeActive: assignee ? assignee.active === 1 : undefined,
    assigneeEngineSupported: assignee ? engineMap.has(String(assignee.engine)) : undefined,
    assigneeAssignedToMission,
    missionExists,
  });
}

export function registerIssueRoutes(app: Express) {
  app.get("/api/issues", (req, res) => {
    const filters = parseIssueListQuery(req.query);
    res.json({
      issues: listIssues({
        ...filters,
        limit: parseListLimit(typeof req.query.limit === "string" ? req.query.limit : undefined, {
          defaultLimit: 500,
          maxLimit: 1_000,
        }),
      }),
    });
  });

  app.post("/api/issues", async (req, res) => {
    const result = parseIssuePayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const payload = result.payload;
    const references = checkIssueReferences(payload);
    if (!references.ok) {
      res.status(references.status).json({ error: references.error });
      return;
    }

    const id = randomUUID();
    const db = getDb();
    const maxRow = db.prepare("SELECT COALESCE(MAX(issue_number), 0) AS m FROM issues").get() as { m: number };
    const nextNumber = maxRow.m + 1;
    const settings = readSettingsMap();
    let linearId = payload.linearId;
    let linearIdentifier: string | null = null;
    let linearUrl: string | null = null;
    let source = payload.source;

    if (!linearId && settings.linear_use_for_issues === "true") {
      const linearIssue = await createLinearIssue({
        title: payload.title,
        description: payload.description,
        status: payload.status,
      });
      linearId = linearIssue?.id ?? null;
      linearIdentifier = linearIssue?.identifier ?? null;
      linearUrl = linearIssue?.url ?? null;
      if (linearId) {
        source = "linear";
      }
    }

    db.prepare(
      `
      INSERT INTO issues (
        id, issue_number, title, description, status, priority, assignee_agent_id, mission_id, github_repo, labels, source, linear_id, linear_identifier, linear_url, estimation, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
    ).run(
      id,
      nextNumber,
      payload.title,
      payload.description,
      payload.status,
      payload.priority,
      payload.assigneeAgentId,
      payload.missionId,
      payload.githubRepo,
      JSON.stringify(payload.labels),
      source,
      linearId,
      linearIdentifier,
      linearUrl,
      payload.estimation,
    );

    if (linearId) {
      await patchLinearIssue(linearId, {
        title: payload.title,
        description: payload.description ?? undefined,
      });
    }

    await startIssueWorkflowForStatus(id, payload.status);

    const issue = getIssueById(id);
    res.status(201).json({ issue });
  });

  app.put("/api/issues/:id", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const result = parseIssuePayload(body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const payload = result.payload;
    const references = checkIssueReferences(payload);
    if (!references.ok) {
      res.status(references.status).json({ error: references.error });
      return;
    }

    const db = getDb();
    const existing = db.prepare("SELECT status, source, linear_id, github_repo FROM issues WHERE id = ?").get(req.params.id) as
      | { status: string; source: string; linear_id: string | null; github_repo: string | null }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: "Issue not found." });
      return;
    }
    const hasSource = Object.prototype.hasOwnProperty.call(body, "source");
    const hasGithubRepo = Object.prototype.hasOwnProperty.call(body, "github_repo");
    const linearId = payload.linearId ?? existing.linear_id;
    const source = hasSource ? payload.source : existing.source ?? (linearId ? "linear" : "native");
    const githubRepo = hasGithubRepo ? payload.githubRepo : existing.github_repo;

    const update = db.transaction(() => {
      const result = db.prepare(
        `
        UPDATE issues
        SET
          title = ?,
          description = ?,
          status = ?,
          priority = ?,
          assignee_agent_id = ?,
          mission_id = ?,
          github_repo = ?,
          labels = ?,
          source = ?,
          linear_id = ?,
          estimation = ?,
          updated_at = datetime('now')
        WHERE id = ?
        `,
      ).run(
        payload.title,
        payload.description,
        payload.status,
        payload.priority,
        payload.assigneeAgentId,
        payload.missionId,
        githubRepo,
        JSON.stringify(payload.labels),
        source,
        linearId,
        payload.estimation,
        req.params.id,
      );
      if (result.changes > 0) {
        db.prepare("UPDATE runs SET mission_id = ? WHERE issue_id = ?").run(payload.missionId, req.params.id);
        db.prepare(
          `
          UPDATE agent_messages
          SET mission_id = ?
          WHERE run_id IN (SELECT id FROM runs WHERE issue_id = ?)
          `,
        ).run(payload.missionId, req.params.id);
      }
      return result;
    })();

    if (linearId) {
      await patchLinearIssue(linearId, {
        title: payload.title,
        description: payload.description ?? undefined,
      });
    }

    if (existing.status !== payload.status) {
      await setIssueWorkflowStatus(req.params.id, payload.status);
      await startIssueWorkflowForStatus(req.params.id, payload.status);
    }

    const issue = getIssueById(req.params.id);
    res.json({ issue });
  });

  app.delete("/api/issues/:id", (req, res, next) => {
    const db = getDb();

    try {
      const activeRunCount = db.prepare(
        `
        SELECT COUNT(*) AS count
        FROM runs
        WHERE issue_id = ? AND status IN ('running', 'planning')
        `,
      ).get(req.params.id) as { count: number };

      if (activeRunCount.count > 0) {
        res.status(409).json({
          error: "Cannot delete this issue while active runs exist. Wait for them to finish or delete the runs first.",
        });
        return;
      }

      const deleted = db.transaction((issueId: string) => {
        const existing = db.prepare("SELECT id FROM issues WHERE id = ?").get(issueId) as { id: string } | undefined;
        if (!existing) {
          return false;
        }

        // Runs reference issues directly, and delegated child runs can also
        // reference sibling runs via parent_run_id. Clear those links first,
        // then remove the issue-owned runs before deleting the issue itself.
        db.prepare(
          `
          UPDATE runs
          SET parent_run_id = NULL
          WHERE parent_run_id IN (
            SELECT id FROM runs WHERE issue_id = ?
          )
          `,
        ).run(issueId);

        // Comments can reference each other via parent_id with NO ACTION.
        // Clear reply links before deleting issue comments to avoid leaking a
        // raw SQLite foreign-key error to the user.
        db.prepare(
          `
          UPDATE issue_comments
          SET parent_id = NULL
          WHERE parent_id IN (
            SELECT id FROM issue_comments WHERE issue_id = ?
          )
          `,
        ).run(issueId);
        db.prepare("DELETE FROM issue_comments WHERE issue_id = ?").run(issueId);

        db.prepare("DELETE FROM runs WHERE issue_id = ?").run(issueId);
        const result = db.prepare("DELETE FROM issues WHERE id = ?").run(issueId);
        return result.changes > 0;
      })(req.params.id);

      if (!deleted) {
        res.status(404).json({ error: "Issue not found." });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message)) {
        res.status(409).json({
          error: "Cannot delete this issue because it still has linked activity or discussion records. Remove the linked items first, or wait for active runs to finish.",
        });
        return;
      }
      next(error);
    }
  });

  app.get("/api/issues/:id/comments", (req, res) => {
    const issueExists = Boolean(getDb().prepare("SELECT 1 FROM issues WHERE id = ?").get(req.params.id));
    if (!issueExists) {
      res.status(404).json({ error: "Issue not found." });
      return;
    }

    const limit = parseListLimit(typeof req.query.limit === "string" ? req.query.limit : undefined, {
      defaultLimit: 500,
      maxLimit: 1_000,
    });
    const comments = getDb()
      .prepare(
        `
        SELECT
          issue_comments.*,
          users.display_name AS user_display_name,
          users.avatar_emoji AS user_avatar_emoji,
          agents.name AS agent_name,
          agents.emoji AS agent_emoji
        FROM issue_comments
        LEFT JOIN users ON users.id = issue_comments.author_id AND issue_comments.author_type = 'user'
        LEFT JOIN agents ON agents.id = issue_comments.author_id AND issue_comments.author_type = 'agent'
        WHERE issue_comments.issue_id = ?
        ORDER BY issue_comments.created_at ASC
        LIMIT ?
        `,
      )
      .all(req.params.id, limit)
      .map((row) => ({
        ...(row as Record<string, unknown>),
        author_name:
          (row as { author_type: string; user_display_name?: string; agent_name?: string }).author_type === "agent"
            ? (row as { agent_name?: string }).agent_name
            : (row as { user_display_name?: string }).user_display_name,
        author_emoji:
          (row as { author_type: string; user_avatar_emoji?: string; agent_emoji?: string }).author_type === "agent"
            ? (row as { agent_emoji?: string }).agent_emoji
            : (row as { user_avatar_emoji?: string }).user_avatar_emoji,
      }));
    res.json({ comments });
  });

  app.post("/api/issues/:id/comments", (req: AuthenticatedRequest, res) => {
    const result = parseCommentPayload(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: "Authentication is required." });
      return;
    }

    const issueExists = Boolean(getDb().prepare("SELECT 1 FROM issues WHERE id = ?").get(req.params.id));
    if (!issueExists) {
      res.status(404).json({ error: "Issue not found." });
      return;
    }

    const { body, parentId } = result.payload;
    if (parentId) {
      const parentExists = Boolean(getDb().prepare("SELECT 1 FROM issue_comments WHERE id = ? AND issue_id = ?").get(parentId, req.params.id));
      if (!parentExists) {
        res.status(404).json({ error: "Parent comment not found." });
        return;
      }
    }

    const comment = {
      id: randomUUID(),
      issue_id: req.params.id,
      parent_id: parentId,
      author_type: "user",
      author_id: req.user.id,
      body,
    };
    getDb()
      .prepare(
        `
        INSERT INTO issue_comments (id, issue_id, parent_id, author_type, author_id, body)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(comment.id, comment.issue_id, comment.parent_id, comment.author_type, comment.author_id, comment.body);
    const issue = getDb().prepare("SELECT linear_id FROM issues WHERE id = ?").get(req.params.id) as { linear_id: string | null } | undefined;
    if (issue?.linear_id) {
      void createLinearComment(issue.linear_id, body).catch((error) => {
        console.error("Failed to sync user comment to Linear:", error);
      });
    }
    res.status(201).json({ comment });
  });

  app.delete("/api/issues/:id/comments/:commentId", (req, res) => {
    const deleted = deleteIssueCommentForIssue(req.params.id, req.params.commentId);
    if (deleted === 0) {
      res.status(404).json({ error: "Comment not found." });
      return;
    }
    res.json({ ok: true });
  });

  // ── Linear sync ──

  app.post("/api/issues/sync-linear", async (_req, res) => {
    try {
      const data = await linearRequest<{
        issues: {
          nodes: Array<Record<string, unknown>>;
        };
      }>(`
        query MissionOSIssues {
          issues(first: 100) {
            nodes {
              id
              identifier
              url
              title
              description
              priorityLabel
              state {
                id
                name
                type
              }
              labels {
                nodes {
                  name
                }
              }
            }
          }
        }
      `);

      for (const issue of data.issues.nodes) {
        const previous = getDb().prepare("SELECT id, status FROM issues WHERE linear_id = ?").get(String(issue.id)) as
          | { id: string; status: string }
          | undefined;
        const issueId = await syncLinearIssueToLocal({
          id: issue.id,
          identifier: issue.identifier,
          url: issue.url,
          title: issue.title,
          description: issue.description,
          state: issue.state,
          priority: issue.priorityLabel,
          labels: (issue.labels as { nodes?: Array<{ name: string }> } | null)?.nodes ?? [],
        });
        const synced = getDb().prepare("SELECT status FROM issues WHERE id = ?").get(issueId) as { status: string } | undefined;
        if (!previous || previous.status !== synced?.status) {
          await startIssueWorkflowForStatus(issueId, synced?.status ?? "backlog");
        }
      }

      res.json({ ok: true, issues: listIssues({ limit: 1_000 }) });
    } catch (error) {
      res.status(400).json({ error: formatIssueSyncError(error) });
    }
  });

  // ── GitHub sync ──

  app.post("/api/issues/sync-github", async (req, res) => {
    const missionId = typeof req.query.mission_id === "string" ? req.query.mission_id : (req.body as { mission_id?: string }).mission_id;
    if (!missionId) {
      res.status(400).json({ error: "mission_id is required." });
      return;
    }

    const mission = getDb().prepare("SELECT github_repo FROM missions WHERE id = ?").get(missionId) as { github_repo: string | null } | undefined;
    if (!mission?.github_repo) {
      res.status(400).json({ error: "Mission has no linked GitHub repository." });
      return;
    }

    const githubRepo = parseGitHubRepoFullName(mission.github_repo);
    if (!githubRepo) {
      res.status(400).json({ error: "Invalid github_repo format. Expected owner/repo." });
      return;
    }

    try {
      const synced = await syncGitHubIssuesToLocal(githubRepo.owner, githubRepo.repo, missionId);
      const issues = listIssues({ missionId, limit: 1_000 });
      res.json({ ok: true, synced, issues });
    } catch (error) {
      res.status(400).json({ error: formatIssueSyncError(error) });
    }
  });
}
