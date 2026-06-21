import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseGitHubIssueListQuery,
  parseGitHubRepoListQuery,
  parseGitHubRepoParams,
  parseGitHubRepoQuery,
  parseLinearIssueListQuery,
  parseLinearTeamListQuery,
} from "./integrations.js";

test("parseLinearIssueListQuery defaults and caps Linear issue limits", () => {
  assert.deepEqual(parseLinearIssueListQuery({}), { limit: 100 });
  assert.deepEqual(parseLinearIssueListQuery({ limit: "50" }), { limit: 50 });
  assert.deepEqual(parseLinearIssueListQuery({ limit: "5000" }), { limit: 250 });
  assert.deepEqual(parseLinearIssueListQuery({ limit: "0" }), { limit: 100 });
  assert.deepEqual(parseLinearIssueListQuery({ limit: 42 }), { limit: 100 });
});

test("parseLinearTeamListQuery defaults and caps Linear team limits", () => {
  assert.deepEqual(parseLinearTeamListQuery({}), { limit: 100 });
  assert.deepEqual(parseLinearTeamListQuery({ limit: "25" }), { limit: 25 });
  assert.deepEqual(parseLinearTeamListQuery({ limit: "5000" }), { limit: 250 });
  assert.deepEqual(parseLinearTeamListQuery({ limit: "nope" }), { limit: 100 });
});

test("parseGitHubRepoQuery trims and limits search text", () => {
  assert.equal(parseGitHubRepoQuery("  missionos  "), "missionos");
  assert.equal(parseGitHubRepoQuery("x".repeat(150)), "x".repeat(100));
});

test("parseGitHubRepoQuery ignores blank and non-string values", () => {
  assert.equal(parseGitHubRepoQuery("   "), undefined);
  assert.equal(parseGitHubRepoQuery(["missionos"]), undefined);
});

test("parseGitHubRepoListQuery trims query text and caps repo limits", () => {
  assert.deepEqual(parseGitHubRepoListQuery({ q: "  missionos  ", limit: "50" }), {
    q: "missionos",
    limit: 50,
  });
  assert.deepEqual(parseGitHubRepoListQuery({ limit: "5000" }), {
    q: undefined,
    limit: 100,
  });
  assert.deepEqual(parseGitHubRepoListQuery({ limit: "0" }), {
    q: undefined,
    limit: 30,
  });
});

test("parseGitHubIssueListQuery defaults and caps issue limits", () => {
  assert.deepEqual(parseGitHubIssueListQuery({}), { limit: 100 });
  assert.deepEqual(parseGitHubIssueListQuery({ limit: "25" }), { limit: 25 });
  assert.deepEqual(parseGitHubIssueListQuery({ limit: "5000" }), { limit: 100 });
  assert.deepEqual(parseGitHubIssueListQuery({ limit: "nope" }), { limit: 100 });
});

test("parseGitHubRepoParams trims valid owner and repo names", () => {
  assert.deepEqual(parseGitHubRepoParams({ owner: "  openai  ", repo: "  mission.os_repo-1  " }), {
    ok: true,
    payload: { owner: "openai", repo: "mission.os_repo-1" },
  });
});

test("parseGitHubRepoParams rejects missing owner or repo names", () => {
  assert.deepEqual(parseGitHubRepoParams({ owner: "openai", repo: " " }), {
    ok: false,
    error: "GitHub owner and repo are required.",
  });
});

test("parseGitHubRepoParams rejects unsupported path characters", () => {
  assert.deepEqual(parseGitHubRepoParams({ owner: "openai", repo: "mission/os" }), {
    ok: false,
    error: "GitHub owner and repo contain unsupported characters.",
  });
});
