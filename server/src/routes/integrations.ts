import type { Express } from "express";
import {
  testGitHubConnection,
  listGitHubRepos,
  listGitHubIssues,
} from "../github-service.js";
import { normalizeImportedIssueDescription, normalizeImportedIssueLabels, normalizeImportedIssueTitle } from "../issueImport.js";
import { linearRequest, normalizeLinearIssuePriority, normalizeLinearIssueStatus } from "../linear.js";
import { parseListLimit } from "../queries.js";

type ParsedGitHubRepoParams = { owner: string; repo: string };
type ParseResult<T> = { ok: true; payload: T } | { ok: false; error: string };

const DEFAULT_LINEAR_ISSUE_LIMIT = 100;
const MAX_LINEAR_ISSUE_LIMIT = 250;
const DEFAULT_LINEAR_TEAM_LIMIT = 100;
const MAX_LINEAR_TEAM_LIMIT = 250;
const DEFAULT_GITHUB_REPO_LIMIT = 30;
const MAX_GITHUB_REPO_LIMIT = 100;
const DEFAULT_GITHUB_ISSUE_LIMIT = 100;
const MAX_GITHUB_ISSUE_LIMIT = 100;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseGitHubRepoQuery(value: unknown): string | undefined {
  const query = optionalString(value);
  return query ? query.slice(0, 100) : undefined;
}

export function parseGitHubRepoListQuery(query: Record<string, unknown>) {
  return {
    q: parseGitHubRepoQuery(query.q),
    limit: parseListLimit(typeof query.limit === "string" ? query.limit : undefined, {
      defaultLimit: DEFAULT_GITHUB_REPO_LIMIT,
      maxLimit: MAX_GITHUB_REPO_LIMIT,
    }),
  };
}

export function parseGitHubIssueListQuery(query: Record<string, unknown>) {
  return {
    limit: parseListLimit(typeof query.limit === "string" ? query.limit : undefined, {
      defaultLimit: DEFAULT_GITHUB_ISSUE_LIMIT,
      maxLimit: MAX_GITHUB_ISSUE_LIMIT,
    }),
  };
}

export function parseGitHubRepoParams(params: Record<string, unknown>): ParseResult<ParsedGitHubRepoParams> {
  const owner = optionalString(params.owner);
  const repo = optionalString(params.repo);
  if (!owner || !repo) {
    return { ok: false, error: "GitHub owner and repo are required." };
  }
  if (!/^[A-Za-z0-9_.-]+$/u.test(owner) || !/^[A-Za-z0-9_.-]+$/u.test(repo)) {
    return { ok: false, error: "GitHub owner and repo contain unsupported characters." };
  }
  return { ok: true, payload: { owner, repo } };
}

export function parseLinearIssueListQuery(query: Record<string, unknown>) {
  return {
    limit: parseListLimit(typeof query.limit === "string" ? query.limit : undefined, {
      defaultLimit: DEFAULT_LINEAR_ISSUE_LIMIT,
      maxLimit: MAX_LINEAR_ISSUE_LIMIT,
    }),
  };
}

export function parseLinearTeamListQuery(query: Record<string, unknown>) {
  return {
    limit: parseListLimit(typeof query.limit === "string" ? query.limit : undefined, {
      defaultLimit: DEFAULT_LINEAR_TEAM_LIMIT,
      maxLimit: MAX_LINEAR_TEAM_LIMIT,
    }),
  };
}

export function registerIntegrationRoutes(app: Express) {
  // ── Linear ──

  app.get("/api/linear/issues", async (req, res) => {
    const filters = parseLinearIssueListQuery(req.query);
    try {
      const data = await linearRequest<{
        issues: {
          nodes: Array<Record<string, unknown>>;
        };
      }>(`
        query MissionOSLinearIssues {
          issues(first: ${filters.limit}) {
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
          title: normalizeImportedIssueTitle(issue.title),
          description: normalizeImportedIssueDescription(issue.description),
          status: normalizeLinearIssueStatus((issue.state as { name?: string } | null)?.name),
          priority: normalizeLinearIssuePriority(issue.priorityLabel),
          labels: normalizeImportedIssueLabels((issue.labels as { nodes?: Array<{ name: string }> } | null)?.nodes),
          source: "linear",
          linear_id: issue.id,
        })),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to fetch Linear issues." });
    }
  });

  app.get("/api/linear/teams", async (req, res) => {
    const filters = parseLinearTeamListQuery(req.query);
    try {
      const data = await linearRequest<{
        teams: {
          nodes: Array<{ id: string; name: string; key: string }>;
        };
      }>(`
        query MissionOSTeams {
          teams(first: ${filters.limit}) {
            nodes {
              id
              name
              key
            }
          }
        }
      `);

      res.json({ teams: data.teams.nodes });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to fetch Linear teams." });
    }
  });

  app.post("/api/linear/test", async (_req, res) => {
    try {
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
    } catch (error) {
      res.status(400).json({ ok: false, message: error instanceof Error ? error.message : "Connection failed." });
    }
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
      const query = parseGitHubRepoListQuery(req.query);
      const repos = await listGitHubRepos(query.q, { limit: query.limit });
      res.json({ repos });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to fetch repos." });
    }
  });

  app.get("/api/github/repos/:owner/:repo/issues", async (req, res) => {
    try {
      const params = parseGitHubRepoParams(req.params);
      if (!params.ok) {
        res.status(400).json({ error: params.error });
        return;
      }
      const query = parseGitHubIssueListQuery(req.query);
      const issues = await listGitHubIssues(params.payload.owner, params.payload.repo, { limit: query.limit });
      res.json({ issues });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to fetch issues." });
    }
  });
}
