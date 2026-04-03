import type {
  MissionTaskAutomationStatus,
  MissionTaskDetail,
} from "../src/mission/types";
import { logDebug } from "./logger";
import {
  HERMES_BLOCKER_SCHEMA,
  HERMES_INTAKE_SCHEMA,
  MAX_WORKER_EXECUTION_ATTEMPTS,
  SCOUT_DELIVERY_SCHEMA,
  SCOUT_REVIEW_SCHEMA,
  SCOUT_ROUTING_SCHEMA,
  WORKER_EXECUTION_SCHEMA,
  buildScoutDeliveryCorrectionPrompt,
  buildScoutDeliveryPrompt,
  buildHermesBlockerPrompt,
  buildHermesIntakePrompt,
  buildScoutBlockerRecoveryPrompt,
  buildArtifactBackedScoutDeliveryDecision,
  buildArtifactBackedScoutReviewDecision,
  buildFallbackScoutRoutingDecision,
  buildScoutRoutingCorrectionPrompt,
  buildScoutReviewCorrectionPrompt,
  buildScoutReviewLinearComment,
  buildScoutReviewPrompt,
  buildScoutRoutingPrompt,
  buildTaskContext,
  buildWorkerExecutionPrompt,
  buildWorkerHandoffNote,
  buildWorkerMalformedResultPrompt,
  canRetryScoutReview,
  looksLikeMetaWorkerResult,
  mergeWorkerExecutionContext,
  normalizeHermesBlockerDecision,
  normalizeHermesIntakeDecision,
  normalizeScoutDeliveryDecision,
  normalizeScoutReviewDecision,
  normalizeScoutRoutingDecision,
  preferredThreadReplyCommentId,
  normalizeWorkerExecutionResult,
  uniqueStrings,
  validateScoutDeliveryDecision,
  validateScoutRoutingDecision,
  validateScoutReviewDecision,
  workerAgentIdForRoute,
  workerExecutionContextFromTask,
  workerRouteLabel,
  type ScoutDeliveryDecision,
  type ScoutRoutingDecision,
  type WorkerExecutionResult,
  type WorkerExecutionContext,
  type ScoutReviewDecision,
  type WorkerRoute,
} from "./mission-workflow";
import { RequestBodyError } from "./types";

const REVIEW_ARTIFACT_SYNC_ATTEMPTS = 8;
const REVIEW_ARTIFACT_SYNC_DELAY_MS = 15_000;

interface UpdateTaskAutomationInput {
  runId?: string | undefined;
  status: MissionTaskAutomationStatus;
  ownerAgentName?: string | undefined;
  route?: WorkerRoute | undefined;
  step?: string | undefined;
  message?: string | undefined;
}

interface AgentJsonExchange<T> {
  parsed: T;
  rawContent: string;
  repairedContent?: string | undefined;
}

export interface MissionTaskWorkflowDeps {
  addMissionTaskComment(taskId: string, input: { body: string; parentCommentId?: string }): Promise<unknown>;
  createAcceptedHandoff(taskId: string, fromAgentName: string, toAgentName: string, note: string): Promise<void>;
  ensureAgentSuffix(body: string, suffix: string): string;
  getMissionTaskDetail(taskId: string): Promise<MissionTaskDetail>;
  pushActivity(type: string, message: string, agentId?: string): void;
  recordMissionTaskWorkflowArtifact(
    taskId: string,
    input: {
      runId?: string | undefined;
      agentName: string;
      step: string;
      prompt: string;
      schema?: string | undefined;
      rawResponse?: string | undefined;
      repairedResponse?: string | undefined;
      normalizedResponse?: string | undefined;
      validationErrors?: string[] | undefined;
    },
  ): Promise<unknown>;
  resolveCanonicalPullRequestUrl(branchName: string): Promise<string | undefined>;
  sendAgentJsonMessage<T>(agentId: string, prompt: string, label: string, schema: string): Promise<AgentJsonExchange<T>>;
  sendAgentMessage(agentId: string, message: string): Promise<unknown>;
  updateTaskAutomation(taskId: string, input: UpdateTaskAutomationInput): void;
}

function stringifyWorkflowArtifactPayload(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeTaskDetailExecutionContext(
  current: WorkerExecutionContext,
  detail: MissionTaskDetail,
): WorkerExecutionContext {
  const taskContext = workerExecutionContextFromTask(detail);
  return {
    branch: taskContext.branch || current.branch,
    pullRequestUrls: uniqueStrings([...current.pullRequestUrls, ...taskContext.pullRequestUrls]),
  };
}

export async function syncWorkerArtifactsForReview(
  taskId: string,
  getMissionTaskDetail: (taskId: string) => Promise<MissionTaskDetail>,
  current: WorkerExecutionContext,
  options?: {
    maxAttempts?: number | undefined;
    delayMs?: number | undefined;
    resolveCanonicalPullRequestUrl?: ((branchName: string) => Promise<string | undefined>) | undefined;
  },
): Promise<{ detail: MissionTaskDetail; executionContext: WorkerExecutionContext }> {
  const maxAttempts = options?.maxAttempts ?? REVIEW_ARTIFACT_SYNC_ATTEMPTS;
  const delayMs = options?.delayMs ?? REVIEW_ARTIFACT_SYNC_DELAY_MS;
  const resolveCanonicalPullRequestUrl = options?.resolveCanonicalPullRequestUrl;

  let detail = await getMissionTaskDetail(taskId);
  let executionContext = mergeTaskDetailExecutionContext(current, detail);

  if (executionContext.pullRequestUrls.length === 0 && executionContext.branch && resolveCanonicalPullRequestUrl) {
    const resolvedPullRequestUrl = await resolveCanonicalPullRequestUrl(executionContext.branch);
    if (resolvedPullRequestUrl) {
      executionContext = mergeWorkerExecutionContext(executionContext, {
        branch: executionContext.branch,
        pullRequestUrl: resolvedPullRequestUrl,
      });
    }
  }

  if (executionContext.pullRequestUrls.length > 0 || maxAttempts <= 0) {
    return { detail, executionContext };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await delay(delayMs);
    detail = await getMissionTaskDetail(taskId);
    executionContext = mergeTaskDetailExecutionContext(current, detail);
    if (executionContext.pullRequestUrls.length === 0 && executionContext.branch && resolveCanonicalPullRequestUrl) {
      const resolvedPullRequestUrl = await resolveCanonicalPullRequestUrl(executionContext.branch);
      if (resolvedPullRequestUrl) {
        executionContext = mergeWorkerExecutionContext(executionContext, {
          branch: executionContext.branch,
          pullRequestUrl: resolvedPullRequestUrl,
        });
      }
    }
    if (executionContext.pullRequestUrls.length > 0) {
      break;
    }
  }

  return { detail, executionContext };
}

async function sendWorkflowJsonStep<TInput, TOutput>(
  deps: MissionTaskWorkflowDeps,
  taskId: string,
  runId: string,
  agentName: string,
  prompt: string,
  label: string,
  schema: string,
  normalize: (value: TInput) => TOutput,
): Promise<TOutput> {
  const exchange = await deps.sendAgentJsonMessage<TInput>(agentName, prompt, label, schema);
  const normalized = normalize(exchange.parsed);

  await deps.recordMissionTaskWorkflowArtifact(taskId, {
    runId,
    agentName,
    step: label,
    prompt,
    schema,
    rawResponse: exchange.rawContent,
    repairedResponse: exchange.repairedContent,
    normalizedResponse: stringifyWorkflowArtifactPayload(normalized),
  });

  return normalized;
}

async function recordScoutReviewValidationFailure(
  deps: MissionTaskWorkflowDeps,
  taskId: string,
  runId: string,
  prompt: string,
  review: ScoutReviewDecision,
  validationErrors: string[],
): Promise<void> {
  await deps.recordMissionTaskWorkflowArtifact(taskId, {
    runId,
    agentName: "Scout",
    step: "Scout review validation",
    prompt,
    normalizedResponse: stringifyWorkflowArtifactPayload(review),
    validationErrors,
  });
}

async function recordWorkflowValidationFailure(
  deps: MissionTaskWorkflowDeps,
  taskId: string,
  runId: string,
  agentName: string,
  step: string,
  prompt: string,
  payload: unknown,
  validationErrors: string[],
): Promise<void> {
  await deps.recordMissionTaskWorkflowArtifact(taskId, {
    runId,
    agentName,
    step,
    prompt,
    normalizedResponse: stringifyWorkflowArtifactPayload(payload),
    validationErrors,
  });
}

async function runValidatedScoutRoutingStep(
  deps: MissionTaskWorkflowDeps,
  taskId: string,
  runId: string,
  prompt: string,
  label: string,
  taskContext: string,
): Promise<ScoutRoutingDecision> {
  let decision = await sendWorkflowJsonStep(
    deps,
    taskId,
    runId,
    "Scout",
    prompt,
    label,
    SCOUT_ROUTING_SCHEMA,
    normalizeScoutRoutingDecision,
  );
  let validationErrors = validateScoutRoutingDecision(decision);

  if (validationErrors.length === 0) {
    return decision;
  }

  await recordWorkflowValidationFailure(
    deps,
    taskId,
    runId,
    "Scout",
    `${label} validation`,
    prompt,
    decision,
    validationErrors,
  );

  const correctionPrompt = buildScoutRoutingCorrectionPrompt(taskContext, decision, validationErrors, label);
  decision = await sendWorkflowJsonStep(
    deps,
    taskId,
    runId,
    "Scout",
    correctionPrompt,
    `${label} correction`,
    SCOUT_ROUTING_SCHEMA,
    normalizeScoutRoutingDecision,
  );
  validationErrors = validateScoutRoutingDecision(decision);

  if (validationErrors.length > 0) {
    await recordWorkflowValidationFailure(
      deps,
      taskId,
      runId,
      "Scout",
      `${label} validation`,
      correctionPrompt,
      decision,
      validationErrors,
    );
    const fallbackDecision = buildFallbackScoutRoutingDecision(correctionPrompt, taskContext, decision);
    await deps.recordMissionTaskWorkflowArtifact(taskId, {
      runId,
      agentName: "Scout",
      step: `${label} fallback`,
      prompt: correctionPrompt,
      normalizedResponse: stringifyWorkflowArtifactPayload(fallbackDecision),
      validationErrors: [
        ...validationErrors,
        "Used server fallback routing because Scout did not return the required routing fields.",
      ],
    });
    return fallbackDecision;
  }

  return decision;
}

async function runValidatedScoutDeliveryStep(
  deps: MissionTaskWorkflowDeps,
  taskId: string,
  runId: string,
  prompt: string,
  workerAgentId: "Atlas" | "Orbit",
  routeLabel: string,
  workerResult: WorkerExecutionResult,
  taskContext: string,
  taskIdentifier: string,
  expectedBranch: string,
  knownPullRequestUrls: string[],
  reviewFeedback: string,
): Promise<ScoutDeliveryDecision> {
  const artifactBackedDecision = buildArtifactBackedScoutDeliveryDecision(
    taskIdentifier,
    expectedBranch,
    workerResult,
    knownPullRequestUrls,
  );
  if (artifactBackedDecision.status === "review_ready") {
    await deps.recordMissionTaskWorkflowArtifact(taskId, {
      runId,
      agentName: "system",
      step: "Scout review prep shortcut",
      prompt,
      normalizedResponse: stringifyWorkflowArtifactPayload(artifactBackedDecision),
      validationErrors: [
        "Skipped Scout delivery prep because the canonical PR was already present in worker/task artifacts.",
      ],
    });
    return artifactBackedDecision;
  }

  let decision = await sendWorkflowJsonStep(
    deps,
    taskId,
    runId,
    "Scout",
    prompt,
    "Scout review prep",
    SCOUT_DELIVERY_SCHEMA,
    normalizeScoutDeliveryDecision,
  );
  let validationErrors = validateScoutDeliveryDecision(decision, taskIdentifier, expectedBranch);

  if (validationErrors.length === 0) {
    return decision;
  }

  await recordWorkflowValidationFailure(
    deps,
    taskId,
    runId,
    "Scout",
    "Scout review prep validation",
    prompt,
    decision,
    validationErrors,
  );

  const correctionPrompt = buildScoutDeliveryCorrectionPrompt(
    taskContext,
    workerAgentId,
    routeLabel,
    workerResult,
    expectedBranch,
    knownPullRequestUrls,
    decision,
    validationErrors,
    reviewFeedback,
  );
  decision = await sendWorkflowJsonStep(
    deps,
    taskId,
    runId,
    "Scout",
    correctionPrompt,
    "Scout review prep correction",
    SCOUT_DELIVERY_SCHEMA,
    normalizeScoutDeliveryDecision,
  );
  validationErrors = validateScoutDeliveryDecision(decision, taskIdentifier, expectedBranch);

  if (validationErrors.length > 0) {
    await recordWorkflowValidationFailure(
      deps,
      taskId,
      runId,
      "Scout",
      "Scout review prep validation",
      correctionPrompt,
      decision,
      validationErrors,
    );
    await deps.recordMissionTaskWorkflowArtifact(taskId, {
      runId,
      agentName: "system",
      step: "Scout review prep fallback",
      prompt: correctionPrompt,
      normalizedResponse: stringifyWorkflowArtifactPayload(artifactBackedDecision),
      validationErrors: [
        ...validationErrors,
        "Used server fallback delivery decision because Scout did not return the required delivery fields.",
      ],
    });
    return artifactBackedDecision;
  }

  return decision;
}

export async function runMissionTaskWorkflow(
  taskId: string,
  runId: string,
  deps: MissionTaskWorkflowDeps,
): Promise<void> {
  let detail = await deps.getMissionTaskDetail(taskId);
  let context = buildTaskContext(detail);
  const preferredReplyParentId = preferredThreadReplyCommentId(detail);
  const issueKey = detail.task.identifier;

  deps.pushActivity("workflow-item", `${issueKey}: automated workflow started.`, "Hermes");
  deps.updateTaskAutomation(taskId, {
    runId,
    status: "running",
    ownerAgentName: "Hermes",
    step: "Hermes intake",
    message: "Checking whether the ticket has enough information.",
  });

  const hermesIntakePrompt = buildHermesIntakePrompt(context);
  const hermesDecision = await sendWorkflowJsonStep(
    deps,
    taskId,
    runId,
    "Hermes",
    hermesIntakePrompt,
    "Hermes intake",
    HERMES_INTAKE_SCHEMA,
    normalizeHermesIntakeDecision,
  );

  if (hermesDecision.action === "needs_info") {
    const commentBody = deps.ensureAgentSuffix(
      hermesDecision.commentBody || `Hey can you please provide more information for this ticket. ${hermesDecision.reason}`,
      "^Hermes",
    );
    await deps.addMissionTaskComment(taskId, {
      body: commentBody,
      ...(preferredReplyParentId ? { parentCommentId: preferredReplyParentId } : {}),
    });
    deps.updateTaskAutomation(taskId, {
      runId,
      status: "needs_info",
      ownerAgentName: "Hermes",
      step: "Awaiting clarification",
      message: hermesDecision.reason,
    });
    deps.pushActivity("workflow-item", `${issueKey}: Hermes requested more information.`, "Hermes");
    return;
  }

  const hermesSummary = hermesDecision.implementationSummary || hermesDecision.reason;
  await deps.createAcceptedHandoff(taskId, "Hermes", "Scout", hermesSummary);
  deps.updateTaskAutomation(taskId, {
    runId,
    status: "running",
    ownerAgentName: "Scout",
    step: "Scout triage",
    message: "Routing the task to the right implementation agent.",
  });

  let scoutRoutingPrompt = buildScoutRoutingPrompt(hermesSummary, context);
  let scoutDecision = await runValidatedScoutRoutingStep(
    deps,
    taskId,
    runId,
    scoutRoutingPrompt,
    "Scout routing",
    context,
  );

  const branchSlug = detail.task.identifier.toLowerCase();
  let workerAgentId = workerAgentIdForRoute(scoutDecision.route);
  let routeLabel = workerRouteLabel(scoutDecision.route);
  let recoveryContext = "";
  let reviewRevision = 0;
  let reviewFeedback = "";
  let skipWorkerHandoff = false;
  let workerExecutionContext = workerExecutionContextFromTask(detail);

  while (true) {
    let workerResult: WorkerExecutionResult | null = null;

    for (let attempt = 1; attempt <= MAX_WORKER_EXECUTION_ATTEMPTS; attempt += 1) {
      if (!skipWorkerHandoff) {
        await deps.createAcceptedHandoff(taskId, "Scout", workerAgentId, buildWorkerHandoffNote(scoutDecision, routeLabel, recoveryContext));
      }
      skipWorkerHandoff = false;

      deps.updateTaskAutomation(taskId, {
        runId,
        status: "running",
        ownerAgentName: workerAgentId,
        route: scoutDecision.route,
        step: `${workerAgentId} implementation${attempt > 1 ? ` (attempt ${attempt})` : reviewFeedback ? " follow-up" : ""}`,
        message: reviewFeedback ? "Addressing Scout review feedback." : `Implementing as a ${routeLabel} task.`,
      });

      const workerExecutionPrompt = buildWorkerExecutionPrompt(
        context,
        routeLabel,
        workerAgentId,
        branchSlug,
        scoutDecision,
        attempt,
        recoveryContext,
        reviewFeedback,
        workerExecutionContext.branch,
        workerExecutionContext.pullRequestUrls,
      );
      let candidateResult = await sendWorkflowJsonStep(
        deps,
        taskId,
        runId,
        workerAgentId,
        workerExecutionPrompt,
        `${workerAgentId} execution`,
        WORKER_EXECUTION_SCHEMA,
        normalizeWorkerExecutionResult,
      );
      workerExecutionContext = mergeWorkerExecutionContext(workerExecutionContext, candidateResult);

      if (looksLikeMetaWorkerResult(candidateResult)) {
        logDebug("mission-control", "Worker returned a meta/non-execution result; requesting corrected response", {
          issueKey,
          workerAgentId,
          route: routeLabel,
          summary: candidateResult.summary,
          blockingReason: candidateResult.blockingReason ?? "",
        });
        const workerCorrectionPrompt = buildWorkerMalformedResultPrompt(
          workerAgentId,
          candidateResult,
          context,
          workerExecutionContext.branch,
          workerExecutionContext.pullRequestUrls,
        );
        candidateResult = await sendWorkflowJsonStep(
          deps,
          taskId,
          runId,
          workerAgentId,
          workerCorrectionPrompt,
          `${workerAgentId} execution correction`,
          WORKER_EXECUTION_SCHEMA,
          normalizeWorkerExecutionResult,
        );
        workerExecutionContext = mergeWorkerExecutionContext(workerExecutionContext, candidateResult);
      }

      if (candidateResult.status !== "blocked") {
        workerResult = candidateResult;
        break;
      }

      const blockerSummary = candidateResult.blockingReason || candidateResult.summary;
      await deps.createAcceptedHandoff(taskId, workerAgentId, "Hermes", `Blocked on attempt ${attempt}: ${blockerSummary}`);
      deps.updateTaskAutomation(taskId, {
        runId,
        status: "running",
        ownerAgentName: "Hermes",
        route: scoutDecision.route,
        step: "Hermes blocker triage",
        message: blockerSummary,
      });
      deps.pushActivity("workflow-item", `${issueKey}: ${workerAgentId} reported a blocker on attempt ${attempt}.`, workerAgentId);

      const hermesBlockerPrompt = buildHermesBlockerPrompt(
        context,
        attempt,
        workerAgentId,
        routeLabel,
        scoutDecision,
        candidateResult.summary,
        blockerSummary,
        workerExecutionContext.branch,
        workerExecutionContext.pullRequestUrls,
        reviewFeedback,
        recoveryContext,
      );
      const blockerDecision = await sendWorkflowJsonStep(
        deps,
        taskId,
        runId,
        "Hermes",
        hermesBlockerPrompt,
        "Hermes blocker triage",
        HERMES_BLOCKER_SCHEMA,
        normalizeHermesBlockerDecision,
      );

      if (blockerDecision.action === "needs_info") {
        const commentBody = deps.ensureAgentSuffix(
          blockerDecision.commentBody || `Blocked during implementation: ${blockerDecision.reason}`,
          "^Hermes",
        );
        await deps.addMissionTaskComment(taskId, {
          body: commentBody,
          ...(preferredReplyParentId ? { parentCommentId: preferredReplyParentId } : {}),
        });
        deps.updateTaskAutomation(taskId, {
          runId,
          status: "needs_info",
          ownerAgentName: "Hermes",
          route: scoutDecision.route,
          step: "Awaiting clarification",
          message: blockerDecision.reason,
        });
        deps.pushActivity("workflow-item", `${issueKey}: Hermes requested more information after a worker block.`, "Hermes");
        return;
      }

      const retryBudgetExhausted = attempt >= MAX_WORKER_EXECUTION_ATTEMPTS;
      if (blockerDecision.action === "failed" || retryBudgetExhausted) {
        const failureReason = retryBudgetExhausted && blockerDecision.action === "retry"
          ? `${blockerDecision.reason} Retry budget exhausted after ${MAX_WORKER_EXECUTION_ATTEMPTS} attempts.`
          : blockerDecision.reason;
        const failureComment = deps.ensureAgentSuffix(
          blockerDecision.commentBody || `Workflow stopped after implementation blocker: ${failureReason}`,
          "^Hermes",
        );
        await deps.addMissionTaskComment(taskId, {
          body: failureComment,
          ...(preferredReplyParentId ? { parentCommentId: preferredReplyParentId } : {}),
        });
        deps.updateTaskAutomation(taskId, {
          runId,
          status: "failed",
          ownerAgentName: "Hermes",
          route: scoutDecision.route,
          step: "Worker blocked",
          message: failureReason,
        });
        deps.pushActivity("workflow-item", `${issueKey}: workflow stopped after ${workerAgentId} reported a blocker.`, "Hermes");
        return;
      }

      recoveryContext = [blockerDecision.reason, blockerDecision.scoutInstructions].filter(Boolean).join("\n");
      await deps.createAcceptedHandoff(taskId, "Hermes", "Scout", `Retry requested after blocker:\n${recoveryContext}`);
      deps.updateTaskAutomation(taskId, {
        runId,
        status: "running",
        ownerAgentName: "Scout",
        route: scoutDecision.route,
        step: "Scout blocker recovery",
        message: blockerDecision.reason,
      });

      scoutRoutingPrompt = buildScoutBlockerRecoveryPrompt(
        context,
        blockerDecision,
        workerAgentId,
        routeLabel,
        scoutDecision,
        blockerSummary,
        reviewFeedback,
      );
      scoutDecision = await runValidatedScoutRoutingStep(
        deps,
        taskId,
        runId,
        scoutRoutingPrompt,
        "Scout blocker recovery",
        context,
      );

      workerAgentId = workerAgentIdForRoute(scoutDecision.route);
      routeLabel = workerRouteLabel(scoutDecision.route);
    }

    if (!workerResult) {
      throw new RequestBodyError("Worker flow ended without an implementation result.", 502);
    }

    const implementationSummary = [
      workerResult.summary,
      workerExecutionContext.branch ? `Branch: ${workerExecutionContext.branch}` : "",
      workerExecutionContext.pullRequestUrls[0] ? `PR: ${workerExecutionContext.pullRequestUrls[0]}` : "",
    ].filter(Boolean).join("\n");

    await deps.createAcceptedHandoff(taskId, workerAgentId, "Scout", implementationSummary);
    ({ detail, executionContext: workerExecutionContext } = await syncWorkerArtifactsForReview(
      taskId,
      deps.getMissionTaskDetail,
      workerExecutionContext,
      {
        maxAttempts: 0,
        resolveCanonicalPullRequestUrl: deps.resolveCanonicalPullRequestUrl,
      },
    ));
    context = buildTaskContext(detail);

    deps.updateTaskAutomation(taskId, {
      runId,
      status: "running",
      ownerAgentName: "Scout",
      route: scoutDecision.route,
      step: "Scout review prep",
      message: "Resolving the canonical PR before implementation review.",
    });

    const scoutDeliveryPrompt = buildScoutDeliveryPrompt(
      context,
      workerAgentId,
      routeLabel,
      workerResult,
      workerExecutionContext.branch,
      workerExecutionContext.pullRequestUrls,
      reviewFeedback,
    );
    const scoutDelivery = await runValidatedScoutDeliveryStep(
      deps,
      taskId,
      runId,
      scoutDeliveryPrompt,
      workerAgentId,
      routeLabel,
      workerResult,
      context,
      detail.task.identifier,
      workerExecutionContext.branch,
      workerExecutionContext.pullRequestUrls,
      reviewFeedback,
    );

    if (scoutDelivery.status === "delivery_required") {
      deps.pushActivity("workflow-item", `${issueKey}: Scout requested PR delivery follow-up from ${workerAgentId}.`, "Scout");
      reviewFeedback = scoutDelivery.deliveryInstructions || scoutDelivery.summary;
      recoveryContext = "";
      await deps.createAcceptedHandoff(taskId, "Scout", workerAgentId, `Delivery required: ${reviewFeedback}`);
      skipWorkerHandoff = true;
      continue;
    }

    workerExecutionContext = mergeWorkerExecutionContext(workerExecutionContext, {
      branch: scoutDelivery.reviewedBranch,
      pullRequestUrl: scoutDelivery.reviewedPullRequestUrl,
    });

    deps.updateTaskAutomation(taskId, {
      runId,
      status: "in_review",
      ownerAgentName: "Scout",
      route: scoutDecision.route,
      step: "Scout review",
      message: "Reviewing the implementation and PR.",
    });

    let scoutReviewPrompt = buildScoutReviewPrompt(
      context,
      workerAgentId,
      routeLabel,
      workerResult,
      workerExecutionContext.branch,
      workerExecutionContext.pullRequestUrls,
      reviewFeedback,
    );
    let scoutReview = await sendWorkflowJsonStep(
      deps,
      taskId,
      runId,
      "Scout",
      scoutReviewPrompt,
      "Scout review",
      SCOUT_REVIEW_SCHEMA,
      normalizeScoutReviewDecision,
    );
    let scoutReviewValidationErrors = validateScoutReviewDecision(
      scoutReview,
      detail.task.identifier,
      workerExecutionContext.branch,
      workerExecutionContext.pullRequestUrls,
    );

    if (scoutReviewValidationErrors.length > 0) {
      await recordScoutReviewValidationFailure(
        deps,
        taskId,
        runId,
        scoutReviewPrompt,
        scoutReview,
        scoutReviewValidationErrors,
      );

      scoutReviewPrompt = buildScoutReviewCorrectionPrompt(
        context,
        workerAgentId,
        routeLabel,
        workerResult,
        workerExecutionContext.branch,
        workerExecutionContext.pullRequestUrls,
        scoutReview,
        scoutReviewValidationErrors,
        reviewFeedback,
      );
      scoutReview = await sendWorkflowJsonStep(
        deps,
        taskId,
        runId,
        "Scout",
        scoutReviewPrompt,
        "Scout review correction",
        SCOUT_REVIEW_SCHEMA,
        normalizeScoutReviewDecision,
      );
      scoutReviewValidationErrors = validateScoutReviewDecision(
        scoutReview,
        detail.task.identifier,
        workerExecutionContext.branch,
        workerExecutionContext.pullRequestUrls,
      );

      if (scoutReviewValidationErrors.length > 0) {
        await recordScoutReviewValidationFailure(
          deps,
          taskId,
          runId,
          scoutReviewPrompt,
          scoutReview,
          scoutReviewValidationErrors,
        );
        const fallbackReview = buildArtifactBackedScoutReviewDecision(
          detail.task.identifier,
          workerExecutionContext.branch,
          workerResult,
          workerExecutionContext.pullRequestUrls,
          context,
          scoutReview,
        );
        const fallbackValidationErrors = validateScoutReviewDecision(
          fallbackReview,
          detail.task.identifier,
          workerExecutionContext.branch,
          workerExecutionContext.pullRequestUrls,
        );

        await deps.recordMissionTaskWorkflowArtifact(taskId, {
          runId,
          agentName: "system",
          step: "Scout review fallback",
          prompt: scoutReviewPrompt,
          normalizedResponse: stringifyWorkflowArtifactPayload(fallbackReview),
          validationErrors: [
            ...scoutReviewValidationErrors,
            "Used server fallback review because Scout did not return the required review fields.",
            ...fallbackValidationErrors,
          ],
        });

        if (fallbackValidationErrors.length > 0) {
          throw new RequestBodyError(`Scout review validation failed. ${scoutReviewValidationErrors.join(" ")}`, 502);
        }

        scoutReview = fallbackReview;
      }
    }

    await deps.addMissionTaskComment(taskId, {
      body: buildScoutReviewLinearComment(scoutReview),
      ...(preferredReplyParentId ? { parentCommentId: preferredReplyParentId } : {}),
    });

    if (scoutReview.decision === "changes_requested") {
      deps.pushActivity("workflow-item", `${issueKey}: Scout requested follow-up changes from ${workerAgentId}.`, "Scout");

      if (!canRetryScoutReview(reviewRevision)) {
        deps.updateTaskAutomation(taskId, {
          runId,
          status: "failed",
          ownerAgentName: "Scout",
          route: scoutDecision.route,
          step: "Review changes exhausted",
          message: scoutReview.summary,
        });
        deps.pushActivity("workflow-item", `${issueKey}: workflow stopped after repeated Scout change requests.`, "Scout");
        return;
      }

      reviewRevision += 1;
      reviewFeedback = scoutReview.summary;
      recoveryContext = "";
      await deps.createAcceptedHandoff(taskId, "Scout", workerAgentId, `Changes requested: ${scoutReview.summary}`);
      skipWorkerHandoff = true;
      continue;
    }

    await deps.createAcceptedHandoff(taskId, "Scout", "Hermes", `Approved for final review. ${scoutReview.summary}`);
    deps.updateTaskAutomation(taskId, {
      runId,
      status: "completed",
      ownerAgentName: "Hermes",
      route: scoutDecision.route,
      step: "Final review",
      message: scoutReview.summary,
    });
    deps.pushActivity("workflow-item", `${issueKey}: ready for final review.`, "Hermes");

    try {
      await deps.sendAgentMessage(
        "Hermes",
        [
          "Scout approved the task for final review.",
          `Ticket: ${issueKey}`,
          `Worker: ${workerAgentId}`,
          `Route: ${routeLabel}`,
          `Summary: ${scoutReview.summary}`,
          workerExecutionContext.pullRequestUrls[0] ? `PR URL: ${workerExecutionContext.pullRequestUrls[0]}` : "",
        ].filter(Boolean).join("\n"),
      );
    } catch {
      logDebug("mission-control", "Final Hermes notification failed", { issueKey, taskId });
    }

    return;
  }
}
