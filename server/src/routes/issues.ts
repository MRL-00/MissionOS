import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { getDb } from "../db.js";
import { syncGitHubIssuesToLocal } from "../github-service.js";
import { linearRequest, syncLinearIssueToLocal, patchLinearIssue } from "../linear.js";
import { listIssues } from "../queries.js";
import type { AuthenticatedRequest } from "../serializers.js";

export function registerIssueRoutes(app: Express) {
  app.get("/api/issues", (req, res) => {
    res.json({
      issues: listIssues({
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        assignee: typeof req.query.assignee === "string" ? req.query.assignee : undefined,
        missionId: typeof req.query.mission_id === "string" ? req.query.mission_id : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        priority: typeof req.query.priority === "string" ? req.query.priority : undefined,
      }),
    });
  });

  app.post("/api/issues", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (typeof body.title !== "string" || !body.title) {
      res.status(400).json({ error: "Issue title is required." });
      return;
    }

    const id = randomUUID();
    const db = getDb();
    const maxRow = db.prepare("SELECT COALESCE(MAX(issue_number), 0) AS m FROM issues").get() as { m: number };
    const nextNumber = maxRow.m + 1;
    db.prepare(
      `
      INSERT INTO issues (
        id, issue_number, title, description, status, priority, assignee_agent_id, mission_id, labels, source, linear_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
    ).run(
      id,
      nextNumber,
      body.title,
      typeof body.description === "string" ? body.description : null,
      typeof body.status === "string" ? body.status : "backlog",
      typeof body.priority === "string" ? body.priority : "medium",
      typeof body.assignee_agent_id === "string" ? body.assignee_agent_id : null,
      typeof body.mission_id === "string" ? body.mission_id : null,
      JSON.stringify(Array.isArray(body.labels) ? body.labels : []),
      typeof body.source === "string" ? body.source : "native",
      typeof body.linear_id === "string" ? body.linear_id : null,
    );

    if (typeof body.linear_id === "string" && body.linear_id) {
      await patchLinearIssue(body.linear_id, {
        title: String(body.title),
        description: typeof body.description === "string" ? body.description : undefined,
      });
    }

    const issue = listIssues({}).find((item) => item.id === id);
    res.status(201).json({ issue });
  });

  app.put("/api/issues/:id", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    getDb().prepare(
      `
      UPDATE issues
      SET
        title = ?,
        description = ?,
        status = ?,
        priority = ?,
        assignee_agent_id = ?,
        mission_id = ?,
        labels = ?,
        source = ?,
        linear_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
      `,
    ).run(
      body.title,
      typeof body.description === "string" ? body.description : null,
      typeof body.status === "string" ? body.status : "backlog",
      typeof body.priority === "string" ? body.priority : "medium",
      typeof body.assignee_agent_id === "string" ? body.assignee_agent_id : null,
      typeof body.mission_id === "string" ? body.mission_id : null,
      JSON.stringify(Array.isArray(body.labels) ? body.labels : []),
      typeof body.source === "string" ? body.source : "native",
      typeof body.linear_id === "string" ? body.linear_id : null,
      req.params.id,
    );

    if (typeof body.linear_id === "string" && body.linear_id) {
      await patchLinearIssue(body.linear_id, {
        title: typeof body.title === "string" ? body.title : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
      });
    }

    const issue = listIssues({}).find((item) => item.id === req.params.id);
    res.json({ issue });
  });

  app.delete("/api/issues/:id", (req, res) => {
    getDb().prepare("DELETE FROM issues WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/issues/:id/comments", (_req, res) => {
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
        `,
      )
      .all(_req.params.id)
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
    const { body, parentId } = req.body as { body?: string; parentId?: string };
    if (!body || !req.user) {
      res.status(400).json({ error: "Comment body is required." });
      return;
    }

    const comment = {
      id: randomUUID(),
      issue_id: req.params.id,
      parent_id: parentId ?? null,
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
    res.status(201).json({ comment });
  });

  app.delete("/api/issues/:id/comments/:commentId", (req, res) => {
    getDb().prepare("DELETE FROM issue_comments WHERE id = ?").run(req.params.commentId);
    res.json({ ok: true });
  });

  // ── Linear sync ──

  app.post("/api/issues/sync-linear", async (_req, res) => {
    const data = await linearRequest<{
      issues: {
        nodes: Array<Record<string, unknown>>;
      };
    }>(`
      query MissionOSIssues {
        issues(first: 100) {
          nodes {
            id
            title
            description
            priorityLabel
            state {
              name
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
      await syncLinearIssueToLocal({
        id: issue.id,
        title: issue.title,
        description: issue.description,
        status: (issue.state as { name?: string } | null)?.name ?? "backlog",
        priority: issue.priorityLabel ?? "medium",
        labels: (issue.labels as { nodes?: Array<{ name: string }> } | null)?.nodes ?? [],
      });
    }

    res.json({ ok: true, issues: listIssues({}) });
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

    const [owner, repo] = mission.github_repo.split("/");
    if (!owner || !repo) {
      res.status(400).json({ error: "Invalid github_repo format. Expected owner/repo." });
      return;
    }

    try {
      const synced = await syncGitHubIssuesToLocal(owner, repo, missionId);
      const issues = listIssues({ missionId });
      res.json({ ok: true, synced, issues });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Sync failed." });
    }
  });
}
