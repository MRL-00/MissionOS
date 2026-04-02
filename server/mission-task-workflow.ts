import type {
  MissionTaskAutomationStatus,
  MissionTaskDetail,
} from "../src/mission/types";
import { logDebug } from "./logger";
import {
  HERMES_BLOCKER_SCHEMA,
  HERMES_INTAKE_SCHEMA,
  MAX_WORKER_EXECUTION_ATTEMPTS,
  SCOUT_REVIEW_SCHEMA,
  SCOUT_ROUTING_SCHEMA,
  WORKER_EXECUTION_SCHEMA,
  buildHermesBlockerPrompt,
  buildHermesIntakePrompt,
  buildScoutBlockerRecoveryPrompt,
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
  normalizeScoutReviewDecision,
  normalizeScoutRoutingDecision,
  normalizeWorkerExecutionResult,
  workerAgentIdForRoute,
  workerExecutionContextFromTask,
  workerRouteLabel,
  type WorkerExecutionResult,
  type WorkerRoute,
} from "./mission-workflow";
import { RequestBodyError } from "./types";

interface UpdateTaskAutomationInput {
  runId?: string | undefined;
  status: MissionTaskAutomationStatus;
  ownerAgentName?: string | undefined;
  route?: WorkerRoute | undefined;
  step?: string | undefined;
  message?: string | undefined;
}

export interface MissionTaskWorkflowDeps {
  addMissionTaskComment(taskId: string, input: { body: string }): Promise<unknown>;
  createAcceptedHandoff(taskId: string, fromAgentName: string, toAgentName: string, note: string): Promise<void>;
  ensureAgentSuffix(body: string, suffix: string): string;
  getMissionTaskDetail(taskId: string): Promise<MissionTaskDetail>;
  pushActivity(type: string, message: string, agentId?: string): void;
  sendAgentJsonMessage<T>(agentId: string, prompt: string, label: string, schema: string): Promise<T>;
  sendAgentMessage(agentId: string, message: string): Promise<unknown>;
  updateTaskAutomation(taskId: string, input: UpdateTaskAutomationInput): void;
}

export async function runMissionTaskWorkflow(
  taskId: string,
  runId: string,
  deps: MissionTaskWorkflowDeps,
): Promise<void> {
  const detail = await deps.getMissionTaskDetail(taskId);
  const context = buildTaskContext(detail);
  const issueKey = detail.task.identifier;

  deps.pushActivity("workflow-item", `${issueKey}: automated workflow started.`, "Hermes");
  deps.updateTaskAutomation(taskId, {
    runId,
    status: "running",
    ownerAgentName: "Hermes",
    step: "Hermes intake",
    message: "Checking whether the ticket has enough information.",
  });

  const hermesDecision = normalizeHermesIntakeDecision(await deps.sendAgentJsonMessage(
    "Hermes",
    buildHermesIntakePrompt(context),
    "Hermes intake",
    HERMES_INTAKE_SCHEMA,
  ));

  if (hermesDecision.action === "needs_info") {
    const commentBody = deps.ensureAgentSuffix(
      hermesDecision.commentBody || `Hey can you please provide more information for this ticket. ${hermesDecision.reason}`,
      "^Hermes",
    );
    await deps.addMissionTaskComment(taskId, { body: commentBody });
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

  let scoutDecision = normalizeScoutRoutingDecision(await deps.sendAgentJsonMessage(
    "Scout",
    buildScoutRoutingPrompt(hermesSummary, context),
    "Scout routing",
    SCOUT_ROUTING_SCHEMA,
  ));

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

      let candidateResult = normalizeWorkerExecutionResult(await deps.sendAgentJsonMessage(
        workerAgentId,
        buildWorkerExecutionPrompt(
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
        ),
        `${workerAgentId} execution`,
        WORKER_EXECUTION_SCHEMA,
      ));
      workerExecutionContext = mergeWorkerExecutionContext(workerExecutionContext, candidateResult);

      if (looksLikeMetaWorkerResult(candidateResult)) {
        logDebug("mission-control", "Worker returned a meta/non-execution result; requesting corrected response", {
          issueKey,
          workerAgentId,
          route: routeLabel,
          summary: candidateResult.summary,
          blockingReason: candidateResult.blockingReason ?? "",
        });
        candidateResult = normalizeWorkerExecutionResult(await deps.sendAgentJsonMessage(
          workerAgentId,
          buildWorkerMalformedResultPrompt(
            workerAgentId,
            candidateResult,
            context,
            workerExecutionContext.branch,
            workerExecutionContext.pullRequestUrls,
          ),
          `${workerAgentId} execution correction`,
          WORKER_EXECUTION_SCHEMA,
        ));
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

      const blockerDecision = normalizeHermesBlockerDecision(await deps.sendAgentJsonMessage(
        "Hermes",
        buildHermesBlockerPrompt(
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
        ),
        "Hermes blocker triage",
        HERMES_BLOCKER_SCHEMA,
      ));

      if (blockerDecision.action === "needs_info") {
        const commentBody = deps.ensureAgentSuffix(
          blockerDecision.commentBody || `Blocked during implementation: ${blockerDecision.reason}`,
          "^Hermes",
        );
        await deps.addMissionTaskComment(taskId, { body: commentBody });
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
        await deps.addMissionTaskComment(taskId, { body: failureComment });
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

      scoutDecision = normalizeScoutRoutingDecision(await deps.sendAgentJsonMessage(
        "Scout",
        buildScoutBlockerRecoveryPrompt(
          context,
          blockerDecision,
          workerAgentId,
          routeLabel,
          scoutDecision,
          blockerSummary,
          reviewFeedback,
        ),
        "Scout blocker recovery",
        SCOUT_ROUTING_SCHEMA,
      ));

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
    deps.updateTaskAutomation(taskId, {
      runId,
      status: "in_review",
      ownerAgentName: "Scout",
      route: scoutDecision.route,
      step: "Scout review",
      message: "Reviewing the implementation and PR.",
    });

    const scoutReview = normalizeScoutReviewDecision(await deps.sendAgentJsonMessage(
      "Scout",
      buildScoutReviewPrompt(
        context,
        workerAgentId,
        routeLabel,
        workerResult,
        workerExecutionContext.branch,
        workerExecutionContext.pullRequestUrls,
        reviewFeedback,
      ),
      "Scout review",
      SCOUT_REVIEW_SCHEMA,
    ));

    await deps.addMissionTaskComment(taskId, { body: deps.ensureAgentSuffix(scoutReview.linearComment, "^Scout") });

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
