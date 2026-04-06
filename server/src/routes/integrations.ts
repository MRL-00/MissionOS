import type { Express } from "express";
import {
  testGitHubConnection,
  listGitHubRepos,
  listGitHubIssues,
} from "../github-service.js";
import { linearRequest } from "../linear.js";

export function registerIntegrationRoutes(app: Express) {
  // ── Linear ──

  app.get("/api/linear/issues", async (_req, res) => {
    const data = await linearRequest<{
      issues: {
        nodes: Array<Record<string, unknown>>;
      };
    }>(`
      query MissionOSLinearIssues {
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

    res.json({
      issues: data.issues.nodes.map((issue) => ({
        id: issue.id,
        title: issue.title,
        description: issue.description,
        status: (issue.state as { name?: string } | null)?.name ?? "backlog",
        priority: issue.priorityLabel ?? "medium",
        labels: (issue.labels as { nodes?: Array<{ name: string }> } | null)?.nodes?.map((item) => item.name) ?? [],
        source: "linear",
        linear_id: issue.id,
      })),
    });
  });

  app.get("/api/linear/teams", async (_req, res) => {
    const data = await linearRequest<{
      teams: {
        nodes: Array<{ id: string; name: string; key: string }>;
      };
    }>(`
      query MissionOSTeams {
        teams {
          nodes {
            id
            name
            key
          }
        }
      }
    `);

    res.json({ teams: data.teams.nodes });
  });

  app.post("/api/linear/test", async (_req, res) => {
    const data = await linearRequest<{
      viewer: {
        id: string;
        organization: { name: string };
      };
    }>(`
      query MissionOSViewer {
        viewer {
          id
          organization {
            name
          }
        }
      }
    `);

    res.json({ ok: true, workspace: data.viewer.organization.name });
  });

  // ── GitHub ──

  app.post("/api/github/test", async (_req, res) => {
    try {
      const result = await testGitHubConnection();
      res.json(result);
    } catch (error) {
      res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Connection failed." });
    }
  });

  app.get("/api/github/repos", async (req, res) => {
    try {
      const query = typeof req.query.q === "string" ? req.query.q : undefined;
      const repos = await listGitHubRepos(query);
      res.json({ repos });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to fetch repos." });
    }
  });

  app.get("/api/github/repos/:owner/:repo/issues", async (req, res) => {
    try {
      const issues = await listGitHubIssues(req.params.owner, req.params.repo);
      res.json({ issues });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to fetch issues." });
    }
  });
}
