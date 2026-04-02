import type { MissionTaskComment, MissionTaskDetail } from "../src/mission/types";
import { RequestBodyError } from "./types";

export type WorkerRoute = "ios" | "fullstack";
export type WorkerAgentId = "Atlas" | "Orbit";

export const MAX_WORKER_EXECUTION_ATTEMPTS = 2;
export const MAX_SCOUT_REVIEW_REVISIONS = 2;
export const HERMES_INTAKE_SCHEMA = '{"action":"ready|needs_info","reason":"short explanation","commentBody":"Linear comment if info is missing, end with ^Hermes","implementationSummary":"brief handoff summary for Scout"}';
export const SCOUT_ROUTING_SCHEMA = '{"route":"ios|fullstack","reason":"why","implementationPrompt":"precise implementation prompt for the worker","acceptanceCriteria":["criterion"],"riskNotes":["optional risk"]}';
export const WORKER_EXECUTION_SCHEMA = '{"status":"implemented|blocked","branch":"branch name","pullRequestUrl":"https://...","summary":"what changed","reviewPrompt":"prompt for the reviewer to verify the diff and PR","blockingReason":"why blocked"}';
export const HERMES_BLOCKER_SCHEMA = '{"action":"retry|needs_info|failed","reason":"short explanation","commentBody":"Linear comment if human input is needed or if the workflow stops, end with ^Hermes","scoutInstructions":"concrete guidance for Scout if retrying"}';
export const SCOUT_REVIEW_SCHEMA = '{"decision":"approved|changes_requested","summary":"review summary","linearComment":"comment to post to Linear, end with ^Scout"}';

export interface HermesIntakeDecision {
  action: "ready" | "needs_info";
  reason: string;
  commentBody?: string | undefined;
  implementationSummary?: string | undefined;
}

export interface ScoutRoutingDecision {
  route: WorkerRoute;
  reason: string;
  implementationPrompt: string;
  acceptanceCriteria: string[];
  riskNotes?: string[] | undefined;
}

export interface WorkerExecutionResult {
  status: "implemented" | "blocked";
  branch?: string | undefined;
  pullRequestUrl?: string | undefined;
  summary: string;
  reviewPrompt?: string | undefined;
  blockingReason?: string | undefined;
}

export interface ScoutReviewDecision {
  decision: "approved" | "changes_requested";
  summary: string;
  linearComment: string;
}

export interface HermesBlockerDecision {
  action: "retry" | "needs_info" | "failed";
  reason: string;
  commentBody?: string | undefined;
  scoutInstructions?: string | undefined;
}

export interface AgentTransportIssue {
  message: string;
  retryable: boolean;
  statusCode: number;
}

export interface WorkerExecutionContext {
  branch: string;
  pullRequestUrls: string[];
}

const META_WORKER_RESULT_PATTERNS = [
  "provided content",
  "available information",
  "cannot be marked as implemented",
  "does not include a completed implementation result",
  "does not include a completed implementation",
  "does not include a branch name",
  "does not include a pull request url",
  "from the available information",
] as const;

const AUTOMATED_LINEAR_COMMENT_SUFFIXES = ["^Hermes", "^Scout"] as const;

export function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed;
  }

  for (let start = 0; start < trimmed.length; start += 1) {
    const first = trimmed[start];
    if (first !== "{" && first !== "[") {
      continue;
    }

    const stack: string[] = [first === "{" ? "}" : "]"];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char === "{" ? "}" : "]");
        continue;
      }

      if (char === "}" || char === "]") {
        const expected = stack.pop();
        if (expected !== char) {
          break;
        }
        if (stack.length === 0) {
          return trimmed.slice(start, index + 1);
        }
      }
    }
  }

  return null;
}

export function parseAgentJson<T>(content: string, label: string): T {
  const candidate = extractJsonCandidate(content);
  if (!candidate) {
    throw new RequestBodyError(`${label} did not return JSON.`, 502);
  }

  try {
    return JSON.parse(candidate) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new RequestBodyError(`${label} returned invalid JSON: ${message}`, 502);
  }
}

export function requireNonEmptyString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  values.forEach((value) => {
    const trimmed = value?.trim() ?? "";
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
}

export function workerExecutionContextFromTask(detail: MissionTaskDetail): WorkerExecutionContext {
  return {
    branch: requireNonEmptyString(detail.task.gitBranchName),
    pullRequestUrls: uniqueStrings(detail.task.pullRequestUrls ?? []),
  };
}

export function mergeWorkerExecutionContext(
  current: WorkerExecutionContext,
  result: Pick<WorkerExecutionResult, "branch" | "pullRequestUrl">,
): WorkerExecutionContext {
  return {
    branch: requireNonEmptyString(result.branch, current.branch),
    pullRequestUrls: uniqueStrings([...current.pullRequestUrls, result.pullRequestUrl]),
  };
}

export function detectAgentTransportIssue(content: string): AgentTransportIssue | null {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const httpMatch = normalized.match(/\[HTTP\s*(\d{3})\]\s*(.*)$/i);
  if (httpMatch) {
    const statusCode = Number.parseInt(httpMatch[1] ?? "", 10);
    if (Number.isFinite(statusCode)) {
      const message = requireNonEmptyString(httpMatch[2], `HTTP ${statusCode}`);
      return {
        message,
        retryable: statusCode === 429 || statusCode >= 500,
        statusCode,
      };
    }
  }

  if (/too many requests|rate limit/i.test(normalized)) {
    return {
      message: normalized,
      retryable: true,
      statusCode: 429,
    };
  }

  if (/temporarily unavailable|timed out|timeout|econnreset|econnrefused|socket hang up|service unavailable/i.test(normalized)) {
    return {
      message: normalized,
      retryable: true,
      statusCode: 503,
    };
  }

  return null;
}

export function isRetryableAgentTransportError(error: unknown): boolean {
  if (!(error instanceof RequestBodyError)) {
    return false;
  }

  if (error.statusCode === 429) {
    return true;
  }

  const transportIssue = detectAgentTransportIssue(error.message);
  if (transportIssue?.retryable) {
    return true;
  }

  return error.statusCode >= 500 && /returned no content/i.test(error.message);
}

export function normalizeHermesIntakeDecision(raw: HermesIntakeDecision): HermesIntakeDecision {
  return {
    action: raw.action === "needs_info" ? "needs_info" : "ready",
    reason: requireNonEmptyString(raw.reason, "No reason provided."),
    commentBody: requireNonEmptyString(raw.commentBody),
    implementationSummary: requireNonEmptyString(raw.implementationSummary),
  };
}

export function normalizeScoutRoutingDecision(raw: ScoutRoutingDecision): ScoutRoutingDecision {
  return {
    route: raw.route === "ios" ? "ios" : "fullstack",
    reason: requireNonEmptyString(raw.reason, "No routing reason provided."),
    implementationPrompt: requireNonEmptyString(raw.implementationPrompt, "Implement the requested fix."),
    acceptanceCriteria: normalizeStringArray(raw.acceptanceCriteria),
    riskNotes: normalizeStringArray(raw.riskNotes),
  };
}

export function normalizeWorkerExecutionResult(raw: WorkerExecutionResult): WorkerExecutionResult {
  return {
    status: raw.status === "blocked" ? "blocked" : "implemented",
    branch: requireNonEmptyString(raw.branch),
    pullRequestUrl: requireNonEmptyString(raw.pullRequestUrl),
    summary: requireNonEmptyString(raw.summary, "No implementation summary provided."),
    reviewPrompt: requireNonEmptyString(raw.reviewPrompt),
    blockingReason: requireNonEmptyString(raw.blockingReason),
  };
}

export function shouldReuseExistingWorkerArtifacts(
  attempt: number,
  blockerContext: string | undefined,
  reviewFeedback: string | undefined,
  existingBranch: string | undefined,
  existingPullRequestUrls: string[],
): boolean {
  return Boolean(
    attempt > 1
      || blockerContext?.trim()
      || reviewFeedback?.trim()
      || existingBranch?.trim()
      || existingPullRequestUrls.length > 0,
  );
}

export function normalizeScoutReviewDecision(raw: ScoutReviewDecision): ScoutReviewDecision {
  return {
    decision: raw.decision === "changes_requested" ? "changes_requested" : "approved",
    summary: requireNonEmptyString(raw.summary, "No review summary provided."),
    linearComment: requireNonEmptyString(raw.linearComment, "^Scout"),
  };
}

export function normalizeHermesBlockerDecision(raw: HermesBlockerDecision): HermesBlockerDecision {
  return {
    action: raw.action === "needs_info" || raw.action === "failed" ? raw.action : "retry",
    reason: requireNonEmptyString(raw.reason, "No blocker assessment provided."),
    commentBody: requireNonEmptyString(raw.commentBody),
    scoutInstructions: requireNonEmptyString(raw.scoutInstructions),
  };
}

export function workerAgentIdForRoute(route: WorkerRoute): WorkerAgentId {
  return route === "ios" ? "Orbit" : "Atlas";
}

export function workerRouteLabel(route: WorkerRoute): string {
  return route === "ios" ? "iOS" : "full stack";
}

export function formatAcceptanceCriteria(criteria: string[]): string {
  return criteria.length > 0
    ? `Acceptance criteria:\n${criteria.map((criterion) => `- ${criterion}`).join("\n")}`
    : "";
}

export function formatRiskNotes(riskNotes?: string[] | undefined): string {
  return riskNotes && riskNotes.length > 0
    ? `Risk notes:\n${riskNotes.map((note) => `- ${note}`).join("\n")}`
    : "";
}

export function buildWorkerHandoffNote(
  decision: ScoutRoutingDecision,
  routeLabel: string,
  blockerContext?: string,
): string {
  return [
    `${decision.reason}`,
    blockerContext ? `Recovery context: ${blockerContext}` : "",
    "",
    `Route: ${routeLabel}`,
    `Implementation prompt: ${decision.implementationPrompt}`,
    formatAcceptanceCriteria(decision.acceptanceCriteria),
    formatRiskNotes(decision.riskNotes),
  ].filter(Boolean).join("\n");
}

export function buildHermesIntakePrompt(taskContext: string): string {
  return [
    "Workflow step: intake triage.",
    "Use your existing profile and SOUL.md role for this step. Do not restate persona.",
    "Assess whether the task has enough information for implementation.",
    "Reply with JSON only, no markdown.",
    HERMES_INTAKE_SCHEMA,
    "",
    taskContext,
  ].join("\n");
}

export function buildScoutRoutingPrompt(hermesSummary: string, taskContext: string): string {
  return [
    "Workflow step: routing.",
    "Use your existing profile and SOUL.md role for this step. Do not restate persona.",
    "Route the task to either Orbit (iOS) or Atlas (fullstack).",
    "Choose ios only when the issue is clearly iOS/native/mobile focused. Otherwise choose fullstack.",
    "Reply with JSON only, no markdown.",
    SCOUT_ROUTING_SCHEMA,
    "",
    `Hermes intake summary: ${hermesSummary}`,
    "",
    taskContext,
  ].join("\n");
}

export function buildHermesBlockerPrompt(
  taskContext: string,
  attempt: number,
  workerAgentId: WorkerAgentId,
  routeLabel: string,
  scoutDecision: ScoutRoutingDecision,
  workerSummary: string,
  blockerSummary: string,
  existingBranch: string,
  existingPullRequestUrls: string[],
  reviewFeedback?: string,
  recoveryContext?: string,
): string {
  return [
    "Workflow step: blocker triage.",
    "Use your existing profile and SOUL.md role for this step. Do not restate persona.",
    "A worker reported a blocker during implementation.",
    "Decide whether the workflow should retry with better instructions, request more human information, or fail.",
    "Choose retry when the task appears recoverable without asking the user for new information.",
    "Choose needs_info only when the human must provide missing information or access.",
    "Choose failed only when the workflow should stop without another worker attempt.",
    "Reply with JSON only, no markdown.",
    HERMES_BLOCKER_SCHEMA,
    "",
    `Attempt: ${attempt} of ${MAX_WORKER_EXECUTION_ATTEMPTS}`,
    `Worker: ${workerAgentId}`,
    `Route: ${routeLabel}`,
    `Scout reason: ${scoutDecision.reason}`,
    `Implementation prompt: ${scoutDecision.implementationPrompt}`,
    reviewFeedback ? `Outstanding review feedback: ${reviewFeedback}` : "",
    formatAcceptanceCriteria(scoutDecision.acceptanceCriteria),
    formatRiskNotes(scoutDecision.riskNotes),
    `Worker summary: ${workerSummary}`,
    existingBranch ? `Branch: ${existingBranch}` : "",
    existingPullRequestUrls.length > 0 ? `Known PR URLs: ${existingPullRequestUrls.join(", ")}` : "",
    `Blocker: ${blockerSummary}`,
    recoveryContext ? `Previous recovery context: ${recoveryContext}` : "",
    "",
    taskContext,
  ].filter(Boolean).join("\n");
}

export function buildScoutBlockerRecoveryPrompt(
  taskContext: string,
  blockerDecision: HermesBlockerDecision,
  previousWorkerAgentId: WorkerAgentId,
  previousRouteLabel: string,
  previousScoutDecision: ScoutRoutingDecision,
  blockerSummary: string,
  reviewFeedback?: string,
): string {
  return [
    "Workflow step: blocker recovery routing.",
    "Use your existing profile and SOUL.md role for this step. Do not restate persona.",
    "A worker attempt was blocked. Produce an updated routing decision and implementation prompt for the retry.",
    "Choose ios only when the issue is clearly iOS/native/mobile focused. Otherwise choose fullstack.",
    "You may keep the same route or switch routes if that resolves the blocker.",
    "Reply with JSON only, no markdown.",
    SCOUT_ROUTING_SCHEMA,
    "",
    `Hermes recovery reason: ${blockerDecision.reason}`,
    blockerDecision.scoutInstructions ? `Hermes recovery instructions: ${blockerDecision.scoutInstructions}` : "",
    `Previous worker: ${previousWorkerAgentId}`,
    `Previous route: ${previousRouteLabel}`,
    `Previous implementation prompt: ${previousScoutDecision.implementationPrompt}`,
    `Previous blocker: ${blockerSummary}`,
    reviewFeedback ? `Outstanding review feedback: ${reviewFeedback}` : "",
    formatAcceptanceCriteria(previousScoutDecision.acceptanceCriteria),
    formatRiskNotes(previousScoutDecision.riskNotes),
    "",
    taskContext,
  ].filter(Boolean).join("\n");
}

export function buildScoutReviewPrompt(
  taskContext: string,
  workerAgentId: WorkerAgentId,
  routeLabel: string,
  workerResult: WorkerExecutionResult,
  existingBranch: string,
  existingPullRequestUrls: string[],
  reviewFeedback?: string,
): string {
  return [
    "Workflow step: implementation review.",
    "Use your existing profile and SOUL.md role for this step. Do not restate persona.",
    "Review the implementation summary and PR information.",
    "If the repository has a develop branch, reject the work unless the implementation branch was created from develop and the PR targets develop.",
    "Reply with JSON only, no markdown.",
    SCOUT_REVIEW_SCHEMA,
    "",
    `Worker: ${workerAgentId}`,
    `Route: ${routeLabel}`,
    `Implementation summary: ${workerResult.summary}`,
    existingBranch ? `Branch: ${existingBranch}` : "",
    existingPullRequestUrls[0] ? `PR URL: ${existingPullRequestUrls[0]}` : "",
    workerResult.reviewPrompt ? `Worker review prompt: ${workerResult.reviewPrompt}` : "",
    reviewFeedback ? `Previous review feedback that should now be resolved: ${reviewFeedback}` : "",
    "",
    taskContext,
  ].filter(Boolean).join("\n");
}

export function developBranchPolicyInstructions(): string[] {
  return [
    "Before creating or reusing a branch, check whether the repository has a local or remote develop branch.",
    "If develop exists, you MUST branch from develop and any PR MUST target develop, not main or master.",
    "Only use main/master as the base branch if develop does not exist.",
  ];
}

export function buildWorkerExecutionPrompt(
  taskContext: string,
  routeLabel: string,
  workerAgentId: WorkerAgentId,
  branchSlug: string,
  decision: ScoutRoutingDecision,
  attempt: number,
  blockerContext?: string,
  reviewFeedback?: string,
  existingBranch?: string,
  existingPullRequestUrls: string[] = [],
): string {
  const knownPullRequestUrls = uniqueStrings(existingPullRequestUrls);
  const reuseExistingArtifacts = shouldReuseExistingWorkerArtifacts(
    attempt,
    blockerContext,
    reviewFeedback,
    existingBranch,
    knownPullRequestUrls,
  );

  return [
    "Workflow task for the implementation session.",
    `Assigned worker: ${workerAgentId}.`,
    "Your profile and SOUL.md define your role and operating style.",
    "Work in the current repository and reply with JSON only, no markdown.",
    reuseExistingArtifacts
      ? "Continue the existing implementation for this ticket and address any outstanding follow-up work before handing work back."
      : `Create a feature branch named ${workerAgentId.toLowerCase()}/${branchSlug}.`,
    reuseExistingArtifacts
      ? "Reuse any existing branch and PR for this ticket instead of starting over. Do not create or open a second PR for the same ticket if one already exists."
      : "Implement the fix, push the branch, and open a PR if your environment allows it.",
    "Before opening a new PR, check whether this ticket already has an existing branch or PR and update it instead.",
    ...developBranchPolicyInstructions(),
    'If you cannot complete that, return {"status":"blocked",...} with the exact reason.',
    WORKER_EXECUTION_SCHEMA,
    "",
    `Attempt: ${attempt} of ${MAX_WORKER_EXECUTION_ATTEMPTS}`,
    `Scout route: ${routeLabel}`,
    `Scout reason: ${decision.reason}`,
    `Implementation prompt: ${decision.implementationPrompt}`,
    reviewFeedback ? `Scout follow-up changes: ${reviewFeedback}` : "",
    existingBranch ? `Current branch: ${existingBranch}` : "",
    knownPullRequestUrls.length > 0 ? `Known PR URLs: ${knownPullRequestUrls.join(", ")}` : "",
    knownPullRequestUrls.length > 1 ? "Multiple PRs are already linked to this ticket. Update the correct existing PR and do not create another." : "",
    formatAcceptanceCriteria(decision.acceptanceCriteria),
    blockerContext ? `Recovery context: ${blockerContext}` : "",
    "",
    taskContext,
  ].filter(Boolean).join("\n");
}

export function canRetryScoutReview(reviewRevision: number): boolean {
  return reviewRevision < MAX_SCOUT_REVIEW_REVISIONS;
}

export function looksLikeMetaWorkerResult(result: WorkerExecutionResult): boolean {
  const haystack = [
    result.summary,
    result.blockingReason,
  ].filter(Boolean).join("\n").toLowerCase();

  if (!haystack) {
    return false;
  }

  return META_WORKER_RESULT_PATTERNS.some((pattern) => haystack.includes(pattern));
}

export function buildWorkerMalformedResultPrompt(
  workerAgentId: WorkerAgentId,
  previousResult: WorkerExecutionResult,
  taskContext: string,
  existingBranch?: string,
  existingPullRequestUrls: string[] = [],
): string {
  const knownPullRequestUrls = uniqueStrings(existingPullRequestUrls);
  return [
    "Workflow correction for the implementation session.",
    `Assigned worker: ${workerAgentId}.`,
    "Your profile and SOUL.md already define who you are; do not restate persona.",
    "Your last JSON response was invalid for this workflow because it described the prompt or available content instead of reporting actual repository work.",
    "Do not talk about 'provided content', 'available information', missing branch names, or missing PR URLs in the prompt.",
    "Work in the repository now.",
    "If a branch or PR already exists for this ticket, reuse it and do not create another one.",
    ...developBranchPolicyInstructions(),
    "If you are blocked, report only a concrete execution blocker such as a failing command, missing dependency, missing access, or an unresolvable code issue.",
    "Reply with JSON only, no markdown.",
    WORKER_EXECUTION_SCHEMA,
    "",
    `Previous invalid summary: ${previousResult.summary}`,
    previousResult.blockingReason ? `Previous invalid blocking reason: ${previousResult.blockingReason}` : "",
    existingBranch ? `Current branch: ${existingBranch}` : "",
    knownPullRequestUrls.length > 0 ? `Known PR URLs: ${knownPullRequestUrls.join(", ")}` : "",
    "",
    taskContext,
  ].filter(Boolean).join("\n");
}

export function buildTaskContext(detail: MissionTaskDetail): string {
  const { task } = detail;
  const lines = [
    `Ticket: ${task.identifier}`,
    `Title: ${task.title}`,
    `Team: ${task.team.name}`,
    `State: ${task.state.name}`,
    `Assignee: ${task.assignee?.name ?? "Unassigned"}`,
    `Suggested branch: ${task.gitBranchName ?? "N/A"}`,
    `Existing PRs: ${task.pullRequestUrls?.join(", ") || "N/A"}`,
    `URL: ${task.url ?? "N/A"}`,
    `Description:`,
    task.description?.trim() || "(empty)",
  ];

  if (detail.comments.length > 0) {
    lines.push("", "Recent comments:");
    detail.comments.slice(-8).forEach((comment) => {
      const depth = threadDepthForComment(comment, detail.comments);
      const prefix = `${"  ".repeat(Math.min(depth, 4))}- `;
      lines.push(`${prefix}${comment.authorName}: ${comment.body.replace(/\s+/g, " ").trim().slice(0, 400)}`);
    });
  }

  return lines.join("\n");
}

function isAutomatedLinearComment(comment: MissionTaskComment): boolean {
  const trimmedBody = comment.body.trimEnd();
  return AUTOMATED_LINEAR_COMMENT_SUFFIXES.some((suffix) => trimmedBody.endsWith(suffix));
}

function threadDepthForComment(comment: MissionTaskComment, comments: MissionTaskComment[]): number {
  const byId = new Map(comments.map((entry) => [entry.id, entry]));
  let depth = 0;
  let currentParentId = comment.parentCommentId;

  while (currentParentId) {
    depth += 1;
    currentParentId = byId.get(currentParentId)?.parentCommentId;
  }

  return depth;
}

function findThreadRootCommentId(comment: MissionTaskComment, comments: MissionTaskComment[]): string {
  const byId = new Map(comments.map((entry) => [entry.id, entry]));
  let current = comment;

  while (current.parentCommentId) {
    const parent = byId.get(current.parentCommentId);
    if (!parent) {
      break;
    }
    current = parent;
  }

  return current.id;
}

export function preferredThreadReplyCommentId(detail: MissionTaskDetail): string | undefined {
  const comments = detail.comments;
  if (comments.length === 0) {
    return undefined;
  }

  const replyCounts = new Map<string, number>();
  comments.forEach((comment) => {
    if (!comment.parentCommentId) {
      return;
    }
    replyCounts.set(comment.parentCommentId, (replyCounts.get(comment.parentCommentId) ?? 0) + 1);
  });

  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    if (!comment || isAutomatedLinearComment(comment)) {
      continue;
    }

    if (comment.parentCommentId) {
      return findThreadRootCommentId(comment, comments);
    }

    if ((replyCounts.get(comment.id) ?? 0) > 0) {
      return comment.id;
    }

    break;
  }

  return undefined;
}
