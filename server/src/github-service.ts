import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { getDb } from "./db.js";
import { normalizeImportedIssueDescription, normalizeImportedIssueLabels, normalizeImportedIssueTitle } from "./issueImport.js";

export interface GitHubRepo {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
  private: boolean;
  html_url: string;
  description: string | null;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  labels: string[];
}

export interface GitHubPR {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
}

function getGitHubPat(): string {
  const rows = getDb().prepare("SELECT value FROM settings WHERE key = 'github_pat'").get() as
    | { value: string }
    | undefined;
  return rows?.value?.trim() ?? "";
}

function createOctokit(): Octokit {
  const token = getGitHubPat();
  if (!token) {
    throw new Error("GitHub Personal Access Token is not configured.");
  }
  return new Octokit({ auth: token });
}

export async function testGitHubConnection(): Promise<{
  ok: boolean;
  username: string;
  message: string;
}> {
  const octokit = createOctokit();
  const { data } = await octokit.users.getAuthenticated();
  return {
    ok: true,
    username: data.login,
    message: `Authenticated as ${data.login}`,
  };
}

export async function listGitHubRepos(query?: string, options: { limit?: number } = {}): Promise<GitHubRepo[]> {
  const octokit = createOctokit();
  const perPage = options.limit ?? 30;

  if (query) {
    const { data } = await octokit.search.repos({
      q: `${query} in:name fork:true`,
      per_page: perPage,
      sort: "updated",
    });
    return data.items.map(toGitHubRepo);
  }

  const { data } = await octokit.repos.listForAuthenticatedUser({
    per_page: perPage,
    sort: "updated",
    affiliation: "owner,collaborator,organization_member",
  });
  return data.map(toGitHubRepo);
}

export async function listGitHubIssues(owner: string, repo: string, options: { limit?: number } = {}): Promise<GitHubIssue[]> {
  const octokit = createOctokit();
  const { data } = await octokit.issues.listForRepo({
    owner,
    repo,
    state: "open",
    per_page: options.limit ?? 100,
  });
  return data
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      id: issue.id,
      number: issue.number,
      title: normalizeImportedIssueTitle(issue.title),
      body: normalizeImportedIssueDescription(issue.body),
      state: issue.state ?? "open",
      html_url: issue.html_url,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      labels: normalizeImportedIssueLabels(issue.labels),
    }));
}

export async function createGitHubPR(
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body?: string,
): Promise<GitHubPR> {
  const octokit = createOctokit();
  try {
    const { data } = await octokit.pulls.create({
      owner,
      repo,
      head,
      base,
      title,
      ...(body ? { body } : {}),
    });
    return {
      id: data.id,
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
    };
  } catch (error) {
    if (error instanceof RequestError && error.status === 422) {
      const { data } = await octokit.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${head}`,
        base,
        per_page: 10,
      });
      const existing = data[0];
      if (existing) {
        return {
          id: existing.id,
          number: existing.number,
          title: existing.title,
          html_url: existing.html_url,
          state: existing.state,
        };
      }
    }
    throw error;
  }
}

export async function syncGitHubIssuesToLocal(
  owner: string,
  repo: string,
  missionId: string,
): Promise<number> {
  const issues = await listGitHubIssues(owner, repo);
  const db = getDb();
  const { randomUUID } = await import("node:crypto");

  const upsert = db.prepare(`
    INSERT INTO issues (id, issue_number, title, description, status, priority, mission_id, source, github_id, github_number, github_repo, labels)
    VALUES (?, ?, ?, ?, 'backlog', 'medium', ?, 'github', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      github_number = excluded.github_number,
      labels = excluded.labels,
      issue_number = COALESCE(issues.issue_number, excluded.issue_number),
      updated_at = datetime('now')
  `);

  const existing = db
    .prepare("SELECT id, github_id FROM issues WHERE github_repo = ? AND source = 'github'")
    .all(`${owner}/${repo}`) as Array<{ id: string; github_id: number }>;
  const existingByGhId = new Map(existing.map((row) => [row.github_id, row.id]));

  let synced = 0;
  const transaction = db.transaction(() => {
    for (const issue of issues) {
      const isNew = !existingByGhId.has(issue.id);
      const localId = existingByGhId.get(issue.id) ?? randomUUID();
      let nextNumber: number | null = null;
      if (isNew) {
        const maxRow = db.prepare("SELECT COALESCE(MAX(issue_number), 0) AS m FROM issues").get() as { m: number };
        nextNumber = maxRow.m + 1;
      }
      upsert.run(
        localId,
        nextNumber,
        issue.title,
        issue.body,
        missionId,
        issue.id,
        issue.number,
        `${owner}/${repo}`,
        JSON.stringify(issue.labels),
      );
      synced++;
    }
  });
  transaction();

  return synced;
}

function toGitHubRepo(data: {
  id: number;
  full_name: string;
  owner: { login: string } | null;
  name: string;
  default_branch?: string;
  private?: boolean;
  html_url: string;
  description?: string | null;
}): GitHubRepo {
  return {
    id: data.id,
    full_name: data.full_name,
    owner: data.owner?.login ?? "",
    name: data.name,
    default_branch: data.default_branch ?? "main",
    private: data.private ?? false,
    html_url: data.html_url,
    description: data.description ?? null,
  };
}
