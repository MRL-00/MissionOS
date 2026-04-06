import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export function getWorkspaceRoot(): string {
  const rows = getDb().prepare("SELECT value FROM settings WHERE key = 'github_workspace_dir'").get() as
    | { value: string }
    | undefined;
  const configured = rows?.value?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(serverRoot, configured);
  }
  return path.join(serverRoot, "workspaces");
}

function getGitHubPat(): string {
  const rows = getDb().prepare("SELECT value FROM settings WHERE key = 'github_pat'").get() as
    | { value: string }
    | undefined;
  return rows?.value?.trim() ?? "";
}

export function repoLocalPath(owner: string, repo: string, issueId: string): string {
  return path.join(getWorkspaceRoot(), owner, repo, issueId);
}

function runGit(args: string[], cwd: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args[0]} failed: ${stderr || error.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export async function ensureRepo(owner: string, repo: string, issueId: string): Promise<string> {
  const localPath = repoLocalPath(owner, repo, issueId);
  const token = getGitHubPat();
  if (!token) {
    throw new Error("GitHub PAT is not configured.");
  }

  const cloneUrl = `https://${token}@github.com/${owner}/${repo}.git`;

  if (existsSync(path.join(localPath, ".git"))) {
    await runGit(["fetch", "origin"], localPath);
    return localPath;
  }

  mkdirSync(localPath, { recursive: true });
  const parentDir = path.dirname(localPath);
  await runGit(["clone", "--depth", "1", cloneUrl, localPath], parentDir, 300_000);
  return localPath;
}

export async function createFeatureBranch(
  repoPath: string,
  branchName: string,
  baseBranch = "main",
): Promise<string> {
  // Fetch the latest base branch
  try {
    await runGit(["fetch", "origin", baseBranch], repoPath);
  } catch {
    // If fetch fails (e.g. shallow clone), continue anyway
  }

  // Reset to the base branch
  try {
    await runGit(["checkout", baseBranch], repoPath);
    await runGit(["reset", "--hard", `origin/${baseBranch}`], repoPath);
  } catch {
    // If base branch doesn't exist locally, create from FETCH_HEAD
    await runGit(["checkout", "-b", baseBranch, "FETCH_HEAD"], repoPath);
  }

  // Create and checkout the feature branch
  try {
    await runGit(["checkout", "-b", branchName], repoPath);
  } catch {
    // Branch may already exist
    await runGit(["checkout", branchName], repoPath);
  }

  return branchName;
}

export async function pushBranch(repoPath: string, branchName: string): Promise<void> {
  // Unshallow if needed so push works
  try {
    await runGit(["fetch", "--unshallow"], repoPath, 300_000);
  } catch {
    // Already unshallowed or full clone
  }
  await runGit(["push", "-u", "origin", branchName], repoPath, 120_000);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export function makeBranchName(issueId: string, title: string): string {
  return `issue/${issueId.slice(0, 8)}/${slugify(title)}`;
}
