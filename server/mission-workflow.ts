import type { MissionTaskComment, MissionTaskDetail } from "../src/mission/types";
import { RequestBodyError } from "./types";

export type WorkerRoute = "ios" | "fullstack";
export type WorkerAgentId = "Atlas" | "Orbit";

export const MAX_WORKER_EXECUTION_ATTEMPTS = 2;
export const MAX_SCOUT_REVIEW_REVISIONS = 2;
export const HERMES_INTAKE_SCHEMA = '{"action":"ready|needs_info","reason":"short explanation","commentBody":"Linear comment if info is missing, end with ^Hermes","implementationSummary":"brief handoff summary for Scout"}';
export const SCOUT_ROUTING_SCHEMA = '{"route":"ios|fullstack","reason":"why","implementationPrompt":"precise implementation prompt for the worker","acceptanceCriteria":["criterion"],"riskNotes":["optional risk"]}';
export const WORKER_EXECUTION_SCHEMA = '{"status":"code_complete|delivery_complete|blocked","branch":"branch name","pullRequestUrl":"https://... when available","summary":"what changed","reviewPrompt":"prompt for the reviewer to verify the diff and PR","blockingReason":"why blocked"}';
export const HERMES_BLOCKER_SCHEMA = '{"action":"retry|needs_info|failed","reason":"short explanation","commentBody":"Linear comment if human input is needed or if the workflow stops, end with ^Hermes","scoutInstructions":"concrete guidance for Scout if retrying"}';
export const SCOUT_DELIVERY_SCHEMA = '{"status":"review_ready|delivery_required","reviewedTicket":"ticket id","reviewedBranch":"branch reviewed","reviewedPullRequestUrl":"https://... when ready","summary":"delivery prep summary","evidence":["concrete verification fact"],"deliveryInstructions":"required only when delivery_required"}';
export const SCOUT_REVIEW_SCHEMA = '{"decision":"approved|changes_requested","summary":"review summary","reviewedTicket":"ticket id reviewed","reviewedBranch":"branch reviewed","reviewedPullRequestUrl":"https://...","reviewedFiles":["file path"],"evidence":["concrete verification fact"],"requestedChanges":["required only when changes_requested"]}';

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
  status: "code_complete" | "delivery_complete" | "blocked";
  branch?: string | undefined;
  pullRequestUrl?: string | undefined;
  summary: string;
  reviewPrompt?: string | undefined;
  blockingReason?: string | undefined;
}

export interface ScoutDeliveryDecision {
  status: "review_ready" | "delivery_required";
  reviewedTicket: string;
  reviewedBranch: string;
  reviewedPullRequestUrl?: string | undefined;
  summary: string;
  evidence: string[];
  deliveryInstructions?: string | undefined;
}

export interface ScoutReviewDecision {
  decision: "approved" | "changes_requested";
  summary: string;
  reviewedTicket: string;
  reviewedBranch: string;
  reviewedPullRequestUrl: string;
  reviewedFiles: string[];
  evidence: string[];
  requestedChanges: string[];
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
    reason: requireNonEmptyString(raw.reason),
    implementationPrompt: requireNonEmptyString(raw.implementationPrompt),
    acceptanceCriteria: normalizeStringArray(raw.acceptanceCriteria),
    riskNotes: normalizeStringArray(raw.riskNotes),
  };
}

export function normalizeWorkerExecutionResult(raw: WorkerExecutionResult): WorkerExecutionResult {
  const rawStatus = typeof (raw as { status?: unknown }).status === "string"
    ? (raw as { status: string }).status
    : "";
  const normalizedStatus = rawStatus === "blocked"
    ? "blocked"
    : rawStatus === "delivery_complete" || (rawStatus === "implemented" && requireNonEmptyString(raw.pullRequestUrl))
      ? "delivery_complete"
      : "code_complete";
  return {
    status: normalizedStatus,
    branch: requireNonEmptyString(raw.branch),
    pullRequestUrl: requireNonEmptyString(raw.pullRequestUrl),
    summary: requireNonEmptyString(raw.summary),
    reviewPrompt: requireNonEmptyString(raw.reviewPrompt),
    blockingReason: requireNonEmptyString(raw.blockingReason),
  };
}

export function normalizeScoutDeliveryDecision(raw: ScoutDeliveryDecision): ScoutDeliveryDecision {
  return {
    status: raw.status === "delivery_required" ? "delivery_required" : "review_ready",
    reviewedTicket: requireNonEmptyString(raw.reviewedTicket),
    reviewedBranch: requireNonEmptyString(raw.reviewedBranch),
    reviewedPullRequestUrl: requireNonEmptyString(raw.reviewedPullRequestUrl),
    summary: requireNonEmptyString(raw.summary),
    evidence: normalizeStringArray(raw.evidence),
    deliveryInstructions: requireNonEmptyString(raw.deliveryInstructions),
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
    reviewedTicket: requireNonEmptyString(raw.reviewedTicket),
    reviewedBranch: requireNonEmptyString(raw.reviewedBranch),
    reviewedPullRequestUrl: requireNonEmptyString(raw.reviewedPullRequestUrl),
    reviewedFiles: normalizeStringArray(raw.reviewedFiles),
    evidence: normalizeStringArray(raw.evidence),
    requestedChanges: normalizeStringArray(raw.requestedChanges),
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

function normalizePullRequestUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function pullRequestDisplayLabel(url: string): string {
  const match = url.match(/\/pull\/(\d+)(?:\/)?$/i);
  return match?.[1] ? `PR #${match[1]}` : "the PR";
}

export function validateScoutReviewDecision(
  review: ScoutReviewDecision,
  taskIdentifier: string,
  expectedBranch: string,
  expectedPullRequestUrls: string[],
): string[] {
  const errors: string[] = [];
  const normalizedExpectedPullRequestUrls = uniqueStrings(expectedPullRequestUrls.map((url) => normalizePullRequestUrl(url)));
  const normalizedReviewedPullRequestUrl = normalizePullRequestUrl(review.reviewedPullRequestUrl);

  if (review.reviewedTicket !== taskIdentifier) {
    errors.push(`Scout reviewed ticket ${review.reviewedTicket || "(empty)"} but expected ${taskIdentifier}.`);
  }

  if (expectedBranch && review.reviewedBranch !== expectedBranch) {
    errors.push(`Scout reviewed branch ${review.reviewedBranch || "(empty)"} but expected ${expectedBranch}.`);
  }

  if (normalizedExpectedPullRequestUrls.length > 0 && !normalizedExpectedPullRequestUrls.includes(normalizedReviewedPullRequestUrl)) {
    errors.push(
      `Scout reviewed PR ${review.reviewedPullRequestUrl || "(empty)"} but expected one of ${normalizedExpectedPullRequestUrls.join(", ")}.`,
    );
  }

  if (review.reviewedFiles.length === 0) {
    errors.push("Scout review must name at least one reviewed file.");
  }

  if (review.evidence.length === 0) {
    errors.push("Scout review must include at least one concrete verification fact.");
  }

  if (review.decision === "changes_requested" && review.requestedChanges.length === 0) {
    errors.push("Scout review must list requested changes when rejecting the implementation.");
  }

  return errors;
}

export function validateScoutRoutingDecision(decision: ScoutRoutingDecision): string[] {
  const errors: string[] = [];

  if (!decision.reason.trim()) {
    errors.push("Scout routing must include a routing reason.");
  }

  if (!decision.implementationPrompt.trim()) {
    errors.push("Scout routing must include an implementation prompt.");
  }

  return errors;
}

export function validateScoutDeliveryDecision(
  decision: ScoutDeliveryDecision,
  taskIdentifier: string,
  expectedBranch: string,
): string[] {
  const errors: string[] = [];

  if (decision.reviewedTicket !== taskIdentifier) {
    errors.push(`Scout delivery prep reviewed ticket ${decision.reviewedTicket || "(empty)"} but expected ${taskIdentifier}.`);
  }

  if (expectedBranch && decision.reviewedBranch !== expectedBranch) {
    errors.push(`Scout delivery prep reviewed branch ${decision.reviewedBranch || "(empty)"} but expected ${expectedBranch}.`);
  }

  if (decision.evidence.length === 0) {
    errors.push("Scout delivery prep must include at least one concrete verification fact.");
  }

  if (decision.status === "review_ready" && !decision.reviewedPullRequestUrl?.trim()) {
    errors.push("Scout delivery prep must include the canonical PR URL when review is ready.");
  }

  if (decision.status === "delivery_required" && !decision.deliveryInstructions?.trim()) {
    errors.push("Scout delivery prep must include delivery instructions when follow-up delivery work is required.");
  }

  return errors;
}

export function buildScoutReviewLinearComment(review: ScoutReviewDecision): string {
  const lines = [
    review.decision === "approved"
      ? `${pullRequestDisplayLabel(review.reviewedPullRequestUrl)} reviewed and approved for merge.`
      : `${pullRequestDisplayLabel(review.reviewedPullRequestUrl)} reviewed and changes requested.`,
    `Ticket: ${review.reviewedTicket}`,
    review.reviewedBranch ? `Branch: ${review.reviewedBranch}` : "",
    review.summary ? `Summary: ${review.summary}` : "",
    review.reviewedFiles.length > 0 ? `Reviewed files: ${review.reviewedFiles.join(", ")}` : "",
    review.evidence.length > 0 ? "Evidence:" : "",
    ...review.evidence.map((entry) => `- ${entry}`),
    review.requestedChanges.length > 0 ? "Requested changes:" : "",
    ...review.requestedChanges.map((entry) => `- ${entry}`),
    "^Scout",
  ];

  return lines.filter(Boolean).join("\n");
}

function extractLabeledLine(text: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "mi"));
  return requireNonEmptyString(match?.[1]);
}

function extractTaskDescription(taskContext: string): string {
  const match = taskContext.match(/Description:\n([\s\S]*?)(?:\n\nRecent comments:|$)/);
  return requireNonEmptyString(match?.[1]);
}

function summarizeRoutingText(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }

  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 217).trimEnd()}...`;
}

function inferWorkerRouteFromContext(text: string, previousRoute?: WorkerRoute): WorkerRoute {
  const haystack = text.toLowerCase();

  if (/\b(ios|iphone|ipad|swift|swiftui|uikit|xcode|testflight|app store|native mobile|cocoa)\b/.test(haystack)) {
    return "ios";
  }

  return previousRoute === "ios" ? "ios" : "fullstack";
}

export function buildFallbackScoutRoutingDecision(
  prompt: string,
  taskContext: string,
  previousDecision?: Partial<ScoutRoutingDecision>,
): ScoutRoutingDecision {
  const title = extractLabeledLine(taskContext, "Title");
  const description = extractTaskDescription(taskContext);
  const intakeSummary = extractLabeledLine(prompt, "Hermes intake summary");
  const recoveryReason = extractLabeledLine(prompt, "Hermes recovery reason");
  const recoveryInstructions = extractLabeledLine(prompt, "Hermes recovery instructions");
  const previousImplementationPrompt = extractLabeledLine(prompt, "Previous implementation prompt");
  const route = inferWorkerRouteFromContext(
    [
      recoveryReason,
      recoveryInstructions,
      intakeSummary,
      title,
      description,
    ].filter(Boolean).join("\n"),
    previousDecision?.route,
  );
  const reasonSource = recoveryReason || intakeSummary || title || description;
  const implementationSource = recoveryInstructions || previousImplementationPrompt || intakeSummary || description || title;
  const fallbackImplementationPrompt = implementationSource
    ? summarizeRoutingText(`Implement this ticket: ${implementationSource}`, "Implement the current ticket using the latest task context.")
    : route === "ios"
      ? "Implement the current ticket as a native iOS change using the latest task context."
      : "Implement the current ticket as a full-stack change using the latest task context.";

  return {
    route,
    reason: summarizeRoutingText(
      reasonSource ? `Fallback routing derived from workflow context: ${reasonSource}` : "",
      `Fallback routing derived from workflow context. Route ${route} based on the current ticket details.`,
    ),
    implementationPrompt: fallbackImplementationPrompt,
    acceptanceCriteria: Array.isArray(previousDecision?.acceptanceCriteria) ? previousDecision.acceptanceCriteria : [],
    riskNotes: Array.isArray(previousDecision?.riskNotes) ? previousDecision.riskNotes : [],
  };
}

export function buildArtifactBackedScoutDeliveryDecision(
  taskIdentifier: string,
  expectedBranch: string,
  workerResult: WorkerExecutionResult,
  knownPullRequestUrls: string[],
): ScoutDeliveryDecision {
  const reviewedBranch = requireNonEmptyString(expectedBranch, requireNonEmptyString(workerResult.branch));
  const reviewedPullRequestUrl = uniqueStrings([
    workerResult.pullRequestUrl,
    ...knownPullRequestUrls,
  ])[0] ?? "";
  const evidence = [
    reviewedBranch ? `Branch resolved from worker/task artifacts: ${reviewedBranch}.` : "",
    reviewedPullRequestUrl ? `Canonical PR URL resolved from worker/task artifacts: ${reviewedPullRequestUrl}.` : "",
    workerResult.summary ? `Worker summary: ${summarizeRoutingText(workerResult.summary, workerResult.summary)}` : "",
  ].filter(Boolean);

  if (reviewedPullRequestUrl) {
    return {
      status: "review_ready",
      reviewedTicket: taskIdentifier,
      reviewedBranch,
      reviewedPullRequestUrl,
      summary: `Canonical PR resolved from worker/task artifacts for ${taskIdentifier}.`,
      evidence,
      deliveryInstructions: "",
    };
  }

  return {
    status: "delivery_required",
    reviewedTicket: taskIdentifier,
    reviewedBranch,
    reviewedPullRequestUrl: "",
    summary: `Canonical PR URL is still missing for ${taskIdentifier}.`,
    evidence,
    deliveryInstructions: reviewedBranch
      ? `Confirm or create the single PR for branch ${reviewedBranch} and return the exact PR URL.`
      : "Confirm or create the single PR for this ticket and return the exact PR URL.",
  };
}

function extractArtifactFilePaths(texts: string[]): string[] {
  const slashPathPattern = /\b(?:[A-Za-z0-9@_-]+\/)+(?:[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\b/g;
  const rootFilePattern = /\b(?:vitest\.config\.(?:ts|js)|vite\.config\.(?:ts|js)|package\.json|tsconfig(?:\.[A-Za-z0-9_-]+)?\.json)\b/g;
  const matches = texts.flatMap((text) => [
    ...(text.match(slashPathPattern) ?? []),
    ...(text.match(rootFilePattern) ?? []),
  ]);
  return uniqueStrings(matches);
}

function extractArtifactEvidence(texts: string[]): string[] {
  const candidateLines = texts.flatMap((text) => text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((line) => line.trim()))
    .filter(Boolean);

  return uniqueStrings(candidateLines.filter((line) => /verified|verify|vitest|test|passed|develop|target|variant|hover|active|disabled|focus|reviewed|confirmed/i.test(line)));
}

export function buildArtifactBackedScoutReviewDecision(
  taskIdentifier: string,
  expectedBranch: string,
  workerResult: WorkerExecutionResult,
  expectedPullRequestUrls: string[],
  taskContext: string,
  previousReview?: Partial<ScoutReviewDecision>,
): ScoutReviewDecision {
  const reviewedBranch = requireNonEmptyString(expectedBranch, requireNonEmptyString(workerResult.branch));
  const reviewedPullRequestUrl = uniqueStrings([
    workerResult.pullRequestUrl,
    ...expectedPullRequestUrls,
  ])[0] ?? "";
  const reviewedFiles = extractArtifactFilePaths([
    workerResult.summary,
    workerResult.reviewPrompt ?? "",
    taskContext,
  ]);
  const evidence = uniqueStrings([
    reviewedBranch ? `Branch resolved from worker/task artifacts: ${reviewedBranch}.` : "",
    reviewedPullRequestUrl ? `Canonical PR URL resolved from worker/task artifacts: ${reviewedPullRequestUrl}.` : "",
    ...extractArtifactEvidence([
      workerResult.summary,
      workerResult.reviewPrompt ?? "",
      taskContext,
    ]),
  ]).slice(0, 8);
  const requestedChanges = normalizeStringArray(previousReview?.requestedChanges);
  const decision = previousReview?.decision === "changes_requested" && requestedChanges.length > 0
    ? "changes_requested"
    : "approved";
  const summary = requireNonEmptyString(
    previousReview?.summary,
    reviewedFiles.length > 0
      ? `Artifact-backed review covered ${reviewedFiles.length} file${reviewedFiles.length === 1 ? "" : "s"} for ${pullRequestDisplayLabel(reviewedPullRequestUrl)}.`
      : `Artifact-backed review resolved the current branch and PR for ${taskIdentifier}.`,
  );

  return {
    decision,
    summary,
    reviewedTicket: taskIdentifier,
    reviewedBranch,
    reviewedPullRequestUrl,
    reviewedFiles,
    evidence,
    requestedChanges,
  };
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

export function buildScoutRoutingCorrectionPrompt(
  taskContext: string,
  previousDecision: ScoutRoutingDecision,
  validationErrors: string[],
  contextLabel: string,
): string {
  return [
    `Workflow correction: ${contextLabel}.`,
    "Use your existing profile and SOUL.md role for this step. Do not restate persona.",
    "Your previous routing response was rejected because required fields were missing or empty.",
    "Return a concrete route, routing reason, and implementation prompt for the current ticket only.",
    "Reply with JSON only, no markdown.",
    SCOUT_ROUTING_SCHEMA,
    "",
    `Validation errors: ${validationErrors.join(" | ")}`,
    `Previous route: ${previousDecision.route}`,
    `Previous reason: ${previousDecision.reason || "(empty)"}`,
    `Previous implementation prompt: ${previousDecision.implementationPrompt || "(empty)"}`,
    "",
    taskContext,
  ].filter(Boolean).join("\n");
}

export function buildScoutDeliveryPrompt(
  taskContext: string,
  workerAgentId: WorkerAgentId,
  routeLabel: string,
  workerResult: WorkerExecutionResult,
  expectedBranch: string,
  knownPullRequestUrls: string[],
  reviewFeedback?: string,
): string {
  return [
    "Workflow step: review prep.",
    "Use your existing profile and SOUL.md role for this step. Do not restate persona.",
    "Resolve the canonical pull request for the current ticket before doing the implementation review.",
    "Use the current ticket, branch, and any available GitHub or gh context to identify the single PR for this branch.",
    "If the code is complete but there is no canonical PR URL yet, return delivery_required with explicit delivery instructions for Atlas.",
    "If the canonical PR URL is known, return review_ready with that exact PR URL.",
    "Do not rely on memory from previous tickets.",
    "Reply with JSON only, no markdown.",
    SCOUT_DELIVERY_SCHEMA,
    "",
    `Worker: ${workerAgentId}`,
    `Route: ${routeLabel}`,
    `Implementation status: ${workerResult.status}`,
    `Implementation summary: ${workerResult.summary}`,
    expectedBranch ? `Expected branch: ${expectedBranch}` : "",
    workerResult.pullRequestUrl ? `Worker reported PR URL: ${workerResult.pullRequestUrl}` : "",
    knownPullRequestUrls.length > 0 ? `Known PR URLs: ${knownPullRequestUrls.join(", ")}` : "",
    reviewFeedback ? `Outstanding follow-up context: ${reviewFeedback}` : "",
    workerResult.reviewPrompt ? `Worker review prompt: ${workerResult.reviewPrompt}` : "",
    "",
    taskContext,
  ].filter(Boolean).join("\n");
}

export function buildScoutDeliveryCorrectionPrompt(
  taskContext: string,
  workerAgentId: WorkerAgentId,
  routeLabel: string,
  workerResult: WorkerExecutionResult,
  expectedBranch: string,
  knownPullRequestUrls: string[],
  previousDecision: ScoutDeliveryDecision,
  validationErrors: string[],
  reviewFeedback?: string,
): string {
  return [
    "Workflow correction: review prep.",
    "Use your existing profile and SOUL.md role for this step. Do not restate persona.",
    "Your previous delivery-prep response was rejected because it did not match the current task artifacts.",
    "Resolve the canonical PR for the current ticket only. Do not reuse ticket IDs, branches, or PR URLs from memory.",
    "If there is no PR yet, return delivery_required with exact delivery instructions for Atlas.",
    "Reply with JSON only, no markdown.",
    SCOUT_DELIVERY_SCHEMA,
    "",
    `Validation errors: ${validationErrors.join(" | ")}`,
    `Previous status: ${previousDecision.status}`,
    `Previous reviewed ticket: ${previousDecision.reviewedTicket || "(empty)"}`,
    `Previous reviewed branch: ${previousDecision.reviewedBranch || "(empty)"}`,
    `Previous reviewed PR URL: ${previousDecision.reviewedPullRequestUrl || "(empty)"}`,
    `Worker: ${workerAgentId}`,
    `Route: ${routeLabel}`,
    `Implementation status: ${workerResult.status}`,
    `Implementation summary: ${workerResult.summary}`,
    expectedBranch ? `Expected branch: ${expectedBranch}` : "",
    knownPullRequestUrls.length > 0 ? `Known PR URLs: ${knownPullRequestUrls.join(", ")}` : "",
    reviewFeedback ? `Outstanding follow-up context: ${reviewFeedback}` : "",
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
    "Do not rely on memory from previous tickets. Review only the current ticket, branch, PR URL, and files in this prompt.",
    "If the repository has a develop branch, reject the work unless the implementation branch was created from develop and the PR targets develop.",
    "Return the exact ticket, branch, and PR URL that you reviewed.",
    "List the files you actually reviewed and at least one concrete verification fact.",
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

export function buildScoutReviewCorrectionPrompt(
  taskContext: string,
  workerAgentId: WorkerAgentId,
  routeLabel: string,
  workerResult: WorkerExecutionResult,
  expectedBranch: string,
  expectedPullRequestUrls: string[],
  previousReview: ScoutReviewDecision,
  validationErrors: string[],
  reviewFeedback?: string,
): string {
  return [
    "Workflow correction: implementation review.",
    "Use your existing profile and SOUL.md role for this step. Do not restate persona.",
    "Your previous review response was rejected because it did not match the current task artifacts.",
    "Re-review the current ticket only. Do not reuse prior PR numbers, branch names, or summaries from memory.",
    "Return the exact ticket, branch, and PR URL that you reviewed.",
    "List the files you actually reviewed and at least one concrete verification fact.",
    "Reply with JSON only, no markdown.",
    SCOUT_REVIEW_SCHEMA,
    "",
    `Validation errors: ${validationErrors.join(" | ")}`,
    `Previous invalid review ticket: ${previousReview.reviewedTicket || "(empty)"}`,
    `Previous invalid review branch: ${previousReview.reviewedBranch || "(empty)"}`,
    `Previous invalid review PR URL: ${previousReview.reviewedPullRequestUrl || "(empty)"}`,
    `Worker: ${workerAgentId}`,
    `Route: ${routeLabel}`,
    `Implementation summary: ${workerResult.summary}`,
    expectedBranch ? `Expected branch: ${expectedBranch}` : "",
    expectedPullRequestUrls[0] ? `Expected PR URL: ${expectedPullRequestUrls[0]}` : "",
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
    "Return status code_complete when the code change is complete but you do not yet have one canonical PR URL to report.",
    "Return status delivery_complete only when the code change is complete and you can report the exact canonical PR URL.",
    "Use status blocked only for a real execution blocker, not merely because the PR URL has not been confirmed yet.",
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
    "Use status code_complete if the code is done but the canonical PR URL is still unresolved.",
    "Use status delivery_complete only when you can report the exact PR URL.",
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
