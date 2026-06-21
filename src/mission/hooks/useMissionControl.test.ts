import { describe, expect, it } from "vitest";
import type { IssueCommentRecord, RunRecord } from "../appTypes";
import {
  applyRunStreamEvent,
  clearDeletedIssueComments,
  removeDeletedIssueRuns,
  removeDeletedRun,
  workspaceRunListParams,
} from "./useMissionControl";
import { WORKSPACE_RUN_LIMIT } from "../api";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    agent_id: "agent-1",
    mission_id: null,
    issue_id: null,
    schedule_id: null,
    engine: "codex",
    status: "running",
    prompt: "Ship it",
    output: "old",
    tool_calls: [],
    started_at: "2026-05-07T00:00:00.000Z",
    finished_at: null,
    duration_ms: null,
    working_directory: null,
    github_branch: null,
    github_pr_url: null,
    parent_run_id: null,
    plan_step_id: null,
    execution_plan: null,
    ...overrides,
  };
}

function makeComment(overrides: Partial<IssueCommentRecord> = {}): IssueCommentRecord {
  return {
    id: "comment-1",
    issue_id: "issue-1",
    parent_id: null,
    author_type: "user",
    author_id: null,
    body: "Comment",
    created_at: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("applyRunStreamEvent", () => {
  it("uses stream snapshot status when a run finishes before subscription", () => {
    expect(applyRunStreamEvent(makeRun(), { type: "snapshot", status: "complete", output: "done" })).toEqual(
      expect.objectContaining({
        status: "complete",
        output: "done",
      }),
    );
  });

  it("maps terminal stream events to terminal run statuses", () => {
    expect(applyRunStreamEvent(makeRun(), { type: "complete" }).status).toBe("complete");
    expect(applyRunStreamEvent(makeRun(), { type: "error" }).status).toBe("failed");
  });
});

describe("deleted record state pruning", () => {
  it("removes deleted runs from visible run collections", () => {
    expect(removeDeletedRun([makeRun({ id: "run-1" }), makeRun({ id: "run-2" })], "run-1")).toEqual([
      expect.objectContaining({ id: "run-2" }),
    ]);
  });

  it("removes runs that belong to a deleted issue", () => {
    expect(
      removeDeletedIssueRuns(
        [
          makeRun({ id: "run-1", issue_id: "issue-1" }),
          makeRun({ id: "run-2", issue_id: "issue-2" }),
          makeRun({ id: "run-3", issue_id: null }),
        ],
        "issue-1",
      ),
    ).toEqual([expect.objectContaining({ id: "run-2" }), expect.objectContaining({ id: "run-3" })]);
  });

  it("clears selected issue comments only when they belong to the deleted issue", () => {
    const unrelated = [makeComment({ id: "comment-2", issue_id: "issue-2" })];

    expect(clearDeletedIssueComments([makeComment()], "issue-1")).toEqual([]);
    expect(clearDeletedIssueComments(unrelated, "issue-1")).toBe(unrelated);
  });
});

describe("workspace list params", () => {
  it("uses the workspace run limit for large run histories", () => {
    expect(workspaceRunListParams()).toEqual({ limit: WORKSPACE_RUN_LIMIT });
  });
});
