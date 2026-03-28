import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ServerMessage,
  WorkflowActor,
  WorkflowComment,
  WorkflowCommentCreateRequest,
  WorkflowEventCreateRequest,
  WorkflowEventKind,
  WorkflowEventRecord,
  WorkflowGithubRef,
  WorkflowHandoff,
  WorkflowHandoffCreateRequest,
  WorkflowHandoffResponseRequest,
  WorkflowHandoffStatus,
  WorkflowItem,
  WorkflowItemCreateRequest,
  WorkflowItemUpdateRequest,
  WorkflowLinearRef,
  WorkflowOwnership,
  WorkflowQaTrigger,
  WorkflowQaTriggerRequest,
  WorkflowSnapshot,
  WorkflowStatus,
} from "../src/types";
import { ensureDataDir } from "./auth/storage";
import { pushActivity } from "./activity";
import { CURRENT_SPRINT_ID, RequestBodyError, type PersistedWorkflowFile, dataDir, workflowFilePath } from "./types";
import { generateId } from "./utils";

const VALID_WORKFLOW_STATUSES = new Set<WorkflowStatus>([
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "qa",
  "merged_ready",
  "done",
  "canceled",
]);
const VALID_WORKFLOW_EVENT_KINDS = new Set<WorkflowEventKind>([
  "item-created",
  "item-updated",
  "status-changed",
  "ownership-changed",
  "handoff-requested",
  "handoff-accepted",
  "handoff-declined",
  "comment-added",
  "qa-triggered",
]);
const VALID_WORKFLOW_ROLES = new Set<WorkflowActor["role"]>(["pickle", "engineer", "reviewer", "qa", "observer"]);
const VALID_HANDOFF_RESPONSE_STATUSES = new Set<Extract<WorkflowHandoffStatus, "accepted" | "declined">>(["accepted", "declined"]);
const VALID_COMMENT_TARGETS = new Set<WorkflowComment["target"]>(["office", "linear"]);
const QA_ENTRY_STATUSES = new Set<WorkflowStatus>(["qa", "merged_ready"]);
const LINEAR_COMMENT_ROLES = new Set<WorkflowActor["role"]>(["pickle", "engineer", "reviewer", "qa"]);
const MAX_WORKFLOW_EVENT_ENTRIES = 500;

export const workflowItems = new Map<string, WorkflowItem>();
export const workflowEvents: WorkflowEventRecord[] = [];
export const workflowHandoffs: WorkflowHandoff[] = [];
export const workflowComments: WorkflowComment[] = [];
export const workflowQaTriggers: WorkflowQaTrigger[] = [];

let broadcast: ((message: ServerMessage) => void) | null = null;
let persistWorkflowQueue: Promise<void> = Promise.resolve();

export function configureWorkflowRuntime(callback: (message: ServerMessage) => void): void {
  broadcast = callback;
}

function clearWorkflowState(): void {
  workflowItems.clear();
  workflowEvents.splice(0, workflowEvents.length);
  workflowHandoffs.splice(0, workflowHandoffs.length);
  workflowComments.splice(0, workflowComments.length);
  workflowQaTriggers.splice(0, workflowQaTriggers.length);
}

export function resetWorkflowStateForTests(): void {
  clearWorkflowState();
  broadcast = null;
  persistWorkflowQueue = Promise.resolve();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkflowActor(value: unknown): value is WorkflowActor {
  return isRecord(value)
    && typeof value.agentId === "string"
    && typeof value.name === "string"
    && VALID_WORKFLOW_ROLES.has(value.role as WorkflowActor["role"]);
}

function isWorkflowLinearRef(value: unknown): value is WorkflowLinearRef {
  return isRecord(value)
    && typeof value.issueId === "string"
    && typeof value.issueKey === "string"
    && (value.url === undefined || typeof value.url === "string")
    && (value.projectId === undefined || typeof value.projectId === "string");
}

function isWorkflowGithubRef(value: unknown): value is WorkflowGithubRef {
  return isRecord(value)
    && (value.repository === undefined || typeof value.repository === "string")
    && (value.branch === undefined || typeof value.branch === "string")
    && (value.pullRequestNumber === undefined || typeof value.pullRequestNumber === "number")
    && (value.pullRequestUrl === undefined || typeof value.pullRequestUrl === "string")
    && (value.headSha === undefined || typeof value.headSha === "string")
    && (value.mergedAt === undefined || typeof value.mergedAt === "number");
}

function isWorkflowOwnership(value: unknown): value is WorkflowOwnership {
  return isRecord(value)
    && (value.ownerAgentId === undefined || typeof value.ownerAgentId === "string")
    && (value.reviewerAgentId === undefined || typeof value.reviewerAgentId === "string")
    && (value.qaAgentId === undefined || typeof value.qaAgentId === "string");
}

function isWorkflowMetadata(value: unknown): value is Record<string, string | number | boolean> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => ["string", "number", "boolean"].includes(typeof entry));
}

export function isWorkflowItemCreateRequest(value: unknown): value is WorkflowItemCreateRequest {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.sprintId === "string"
    && typeof value.title === "string"
    && (value.summary === undefined || typeof value.summary === "string")
    && (value.status === undefined || VALID_WORKFLOW_STATUSES.has(value.status as WorkflowStatus))
    && isWorkflowLinearRef(value.linear)
    && (value.github === undefined || isWorkflowGithubRef(value.github))
    && (value.ownership === undefined || isWorkflowOwnership(value.ownership))
    && isWorkflowActor(value.actor);
}

export function isWorkflowItemUpdateRequest(value: unknown): value is WorkflowItemUpdateRequest {
  return isRecord(value)
    && (value.sprintId === undefined || typeof value.sprintId === "string")
    && (value.title === undefined || typeof value.title === "string")
    && (value.summary === undefined || typeof value.summary === "string")
    && (value.status === undefined || VALID_WORKFLOW_STATUSES.has(value.status as WorkflowStatus))
    && (value.github === undefined || isWorkflowGithubRef(value.github))
    && (value.ownership === undefined || isWorkflowOwnership(value.ownership))
    && isWorkflowActor(value.actor);
}

export function isWorkflowEventCreateRequest(value: unknown): value is WorkflowEventCreateRequest {
  return isRecord(value)
    && isWorkflowActor(value.actor)
    && VALID_WORKFLOW_EVENT_KINDS.has(value.kind as WorkflowEventKind)
    && typeof value.message === "string"
    && (value.fromStatus === undefined || VALID_WORKFLOW_STATUSES.has(value.fromStatus as WorkflowStatus))
    && (value.toStatus === undefined || VALID_WORKFLOW_STATUSES.has(value.toStatus as WorkflowStatus))
    && (value.metadata === undefined || isWorkflowMetadata(value.metadata));
}

export function isWorkflowHandoffCreateRequest(value: unknown): value is WorkflowHandoffCreateRequest {
  return isRecord(value)
    && isWorkflowActor(value.from)
    && isWorkflowActor(value.to)
    && typeof value.summary === "string"
    && (value.checklist === undefined || (Array.isArray(value.checklist) && value.checklist.every((item) => typeof item === "string")));
}

export function isWorkflowHandoffResponseRequest(value: unknown): value is WorkflowHandoffResponseRequest {
  return isRecord(value)
    && isWorkflowActor(value.actor)
    && VALID_HANDOFF_RESPONSE_STATUSES.has(value.status as Extract<WorkflowHandoffStatus, "accepted" | "declined">);
}

export function isWorkflowCommentCreateRequest(value: unknown): value is WorkflowCommentCreateRequest {
  return isRecord(value)
    && isWorkflowActor(value.actor)
    && VALID_COMMENT_TARGETS.has(value.target as WorkflowComment["target"])
    && typeof value.body === "string";
}

export function isWorkflowQaTriggerRequest(value: unknown): value is WorkflowQaTriggerRequest {
  return isRecord(value)
    && isWorkflowActor(value.actor)
    && typeof value.reason === "string"
    && (value.auto === undefined || typeof value.auto === "boolean");
}

function assertCurrentSprint(sprintId: string): void {
  if (sprintId !== CURRENT_SPRINT_ID) {
    throw new RequestBodyError(`Only current sprint work is allowed. Expected sprintId ${CURRENT_SPRINT_ID}.`, 409);
  }
}

function requireWorkflowItem(itemId: string): WorkflowItem {
  const item = workflowItems.get(itemId);
  if (!item) {
    throw new RequestBodyError("Workflow item not found", 404);
  }
  assertCurrentSprint(item.sprintId);
  return item;
}

function assertLinearCommentPermission(actor: WorkflowActor): void {
  if (!LINEAR_COMMENT_ROLES.has(actor.role)) {
    throw new RequestBodyError(`Role ${actor.role} cannot send direct Linear comments.`, 403);
  }
}

function ensureGithubTruthForStatus(status: WorkflowStatus, github: WorkflowGithubRef): void {
  if (status === "merged_ready" && github.pullRequestNumber === undefined && !github.pullRequestUrl) {
    throw new RequestBodyError("merged_ready workflow items require a GitHub pull request reference.");
  }
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeGithubRef(value: WorkflowGithubRef | undefined): WorkflowGithubRef {
  return {
    repository: trimOptional(value?.repository),
    branch: trimOptional(value?.branch),
    pullRequestNumber: value?.pullRequestNumber,
    pullRequestUrl: trimOptional(value?.pullRequestUrl),
    headSha: trimOptional(value?.headSha),
    mergedAt: value?.mergedAt,
  };
}

function normalizeOwnership(value: WorkflowOwnership | undefined): WorkflowOwnership {
  return {
    ownerAgentId: trimOptional(value?.ownerAgentId),
    reviewerAgentId: trimOptional(value?.reviewerAgentId),
    qaAgentId: trimOptional(value?.qaAgentId),
  };
}

function sortByTimestampDesc<T extends { createdAt?: number; updatedAt?: number; timestamp?: number }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    const leftValue = left.updatedAt ?? left.createdAt ?? left.timestamp ?? 0;
    const rightValue = right.updatedAt ?? right.createdAt ?? right.timestamp ?? 0;
    return rightValue - leftValue;
  });
}

function currentSprintItems(): WorkflowItem[] {
  return sortByTimestampDesc(Array.from(workflowItems.values()).filter((item) => item.sprintId === CURRENT_SPRINT_ID));
}

function currentSprintEvents(): WorkflowEventRecord[] {
  return workflowEvents.filter((event) => event.sprintId === CURRENT_SPRINT_ID);
}

function currentSprintHandoffs(): WorkflowHandoff[] {
  return workflowHandoffs.filter((handoff) => handoff.sprintId === CURRENT_SPRINT_ID);
}

function currentSprintComments(): WorkflowComment[] {
  return workflowComments.filter((comment) => comment.sprintId === CURRENT_SPRINT_ID);
}

function currentSprintQaTriggers(): WorkflowQaTrigger[] {
  return workflowQaTriggers.filter((trigger) => trigger.sprintId === CURRENT_SPRINT_ID);
}

export function buildWorkflowSnapshot(): WorkflowSnapshot {
  return {
    currentSprintId: CURRENT_SPRINT_ID,
    items: currentSprintItems(),
    events: currentSprintEvents(),
    handoffs: currentSprintHandoffs(),
    comments: currentSprintComments(),
    qaTriggers: currentSprintQaTriggers(),
  };
}

function broadcastWorkflowSnapshot(): void {
  broadcast?.({
    type: "workflow-snapshot",
    snapshot: buildWorkflowSnapshot(),
  });
}

function broadcastWorkflowItem(item: WorkflowItem): void {
  broadcast?.({
    type: "workflow-item-updated",
    item,
  });
}

function broadcastWorkflowEvent(event: WorkflowEventRecord): void {
  broadcast?.({
    type: "workflow-event",
    event,
  });
}

async function persistWorkflow(): Promise<void> {
  const payload: PersistedWorkflowFile = {
    items: Array.from(workflowItems.values()),
    events: workflowEvents,
    handoffs: workflowHandoffs,
    comments: workflowComments,
    qaTriggers: workflowQaTriggers,
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const tempPath = path.join(dataDir, `workflow.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  await ensureDataDir();
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, workflowFilePath);
}

function queuePersistWorkflow(): Promise<void> {
  const runPersist = async () => {
    await persistWorkflow();
  };
  const pending = persistWorkflowQueue.then(runPersist, runPersist);
  persistWorkflowQueue = pending.catch(() => undefined);
  return pending;
}

export async function loadPersistedWorkflow(): Promise<void> {
  await ensureDataDir();
  clearWorkflowState();

  try {
    const raw = await readFile(workflowFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedWorkflowFile>;
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    const handoffs = Array.isArray(parsed.handoffs) ? parsed.handoffs : [];
    const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
    const qaTriggers = Array.isArray(parsed.qaTriggers) ? parsed.qaTriggers : [];

    items.forEach((item) => workflowItems.set(item.id, item));
    workflowEvents.splice(0, workflowEvents.length, ...sortByTimestampDesc(events));
    workflowHandoffs.splice(0, workflowHandoffs.length, ...sortByTimestampDesc(handoffs));
    workflowComments.splice(0, workflowComments.length, ...sortByTimestampDesc(comments));
    workflowQaTriggers.splice(0, workflowQaTriggers.length, ...sortByTimestampDesc(qaTriggers));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function appendWorkflowEvent(
  item: WorkflowItem,
  input: WorkflowEventCreateRequest,
): WorkflowEventRecord {
  const event: WorkflowEventRecord = {
    id: generateId(),
    itemId: item.id,
    sprintId: item.sprintId,
    kind: input.kind,
    actor: input.actor,
    timestamp: Date.now(),
    message: input.message.trim(),
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    metadata: input.metadata,
  };

  workflowEvents.unshift(event);
  workflowEvents.splice(MAX_WORKFLOW_EVENT_ENTRIES);
  workflowItems.set(item.id, {
    ...item,
    lastEventAt: event.timestamp,
    updatedAt: Math.max(item.updatedAt, event.timestamp),
  });
  broadcastWorkflowEvent(event);
  return event;
}

function statusLabel(status: WorkflowStatus): string {
  return status.replaceAll("_", " ");
}

async function finalizeMutation(item: WorkflowItem): Promise<void> {
  workflowItems.set(item.id, item);
  await queuePersistWorkflow();
  broadcastWorkflowItem(item);
  broadcastWorkflowSnapshot();
}

export function listWorkflowItems(): WorkflowItem[] {
  return buildWorkflowSnapshot().items;
}

export function listWorkflowEvents(itemId?: string): WorkflowEventRecord[] {
  return currentSprintEvents().filter((event) => !itemId || event.itemId === itemId);
}

export function listWorkflowHandoffs(itemId?: string): WorkflowHandoff[] {
  return currentSprintHandoffs().filter((handoff) => !itemId || handoff.itemId === itemId);
}

export function listWorkflowComments(itemId?: string): WorkflowComment[] {
  return currentSprintComments().filter((comment) => !itemId || comment.itemId === itemId);
}

export function listWorkflowQaTriggers(itemId?: string): WorkflowQaTrigger[] {
  return currentSprintQaTriggers().filter((trigger) => !itemId || trigger.itemId === itemId);
}

export async function createWorkflowItem(input: WorkflowItemCreateRequest): Promise<{
  item: WorkflowItem;
  event: WorkflowEventRecord;
  qaTrigger?: WorkflowQaTrigger | undefined;
}> {
  assertCurrentSprint(input.sprintId);
  if (workflowItems.has(input.id)) {
    throw new RequestBodyError("Workflow item already exists", 409);
  }

  const title = input.title.trim();
  if (!title) {
    throw new RequestBodyError("Workflow item title is required.");
  }

  const status = input.status ?? "todo";
  const github = normalizeGithubRef(input.github);
  ensureGithubTruthForStatus(status, github);
  const timestamp = Date.now();
  const item: WorkflowItem = {
    id: input.id,
    sprintId: input.sprintId,
    title,
    summary: trimOptional(input.summary),
    status,
    linear: input.linear,
    github,
    ownership: normalizeOwnership(input.ownership),
    qa: {
      status: "idle",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastEventAt: timestamp,
  };

  workflowItems.set(item.id, item);
  const event = appendWorkflowEvent(item, {
    actor: input.actor,
    kind: "item-created",
    message: `${item.linear.issueKey} created in ${statusLabel(item.status)}.`,
    toStatus: item.status,
  });
  pushActivity("workflow-item", `${item.linear.issueKey}: created by ${input.actor.name}.`, input.actor.agentId);

  let qaTrigger: WorkflowQaTrigger | undefined;
  if (QA_ENTRY_STATUSES.has(item.status)) {
    qaTrigger = await createQaTrigger(item.id, {
      actor: input.actor,
      reason: item.status === "qa" ? "Item entered QA." : "Item entered merged-ready flow.",
      auto: true,
    });
  }

  await finalizeMutation(workflowItems.get(item.id) ?? item);
  return {
    item: workflowItems.get(item.id) ?? item,
    event,
    qaTrigger,
  };
}

export async function updateWorkflowItem(itemId: string, input: WorkflowItemUpdateRequest): Promise<{
  item: WorkflowItem;
  events: WorkflowEventRecord[];
  qaTrigger?: WorkflowQaTrigger | undefined;
}> {
  const existing = requireWorkflowItem(itemId);
  if (input.sprintId !== undefined) {
    assertCurrentSprint(input.sprintId);
  }

  const nextStatus = input.status ?? existing.status;
  const github = {
    ...existing.github,
    ...normalizeGithubRef(input.github),
  };
  ensureGithubTruthForStatus(nextStatus, github);

  const updatedAt = Date.now();
  const next: WorkflowItem = {
    ...existing,
    title: input.title?.trim() || existing.title,
    summary: input.summary !== undefined ? trimOptional(input.summary) : existing.summary,
    status: nextStatus,
    github,
    ownership: input.ownership ? { ...existing.ownership, ...normalizeOwnership(input.ownership) } : existing.ownership,
    updatedAt,
  };

  const events: WorkflowEventRecord[] = [];
  workflowItems.set(itemId, next);

  if (next.status !== existing.status) {
    const event = appendWorkflowEvent(next, {
      actor: input.actor,
      kind: "status-changed",
      message: `${next.linear.issueKey} moved from ${statusLabel(existing.status)} to ${statusLabel(next.status)}.`,
      fromStatus: existing.status,
      toStatus: next.status,
    });
    events.push(event);
    pushActivity("workflow-item", `${next.linear.issueKey}: ${input.actor.name} moved work to ${statusLabel(next.status)}.`, input.actor.agentId);
  }

  const ownershipChanged = existing.ownership.ownerAgentId !== next.ownership.ownerAgentId
    || existing.ownership.reviewerAgentId !== next.ownership.reviewerAgentId
    || existing.ownership.qaAgentId !== next.ownership.qaAgentId;
  if (ownershipChanged) {
    const event = appendWorkflowEvent(next, {
      actor: input.actor,
      kind: "ownership-changed",
      message: `${next.linear.issueKey} ownership updated.`,
    });
    events.push(event);
    pushActivity("workflow-item", `${next.linear.issueKey}: ownership updated by ${input.actor.name}.`, input.actor.agentId);
  }

  const itemUpdated = next.title !== existing.title
    || next.summary !== existing.summary
    || next.github.repository !== existing.github.repository
    || next.github.branch !== existing.github.branch
    || next.github.pullRequestNumber !== existing.github.pullRequestNumber
    || next.github.pullRequestUrl !== existing.github.pullRequestUrl
    || next.github.headSha !== existing.github.headSha
    || next.github.mergedAt !== existing.github.mergedAt;
  if (itemUpdated) {
    const event = appendWorkflowEvent(next, {
      actor: input.actor,
      kind: "item-updated",
      message: `${next.linear.issueKey} details updated.`,
    });
    events.push(event);
  }

  let qaTrigger: WorkflowQaTrigger | undefined;
  if (next.status !== existing.status && QA_ENTRY_STATUSES.has(next.status) && !QA_ENTRY_STATUSES.has(existing.status)) {
    qaTrigger = await createQaTrigger(itemId, {
      actor: input.actor,
      reason: next.status === "qa" ? "Item entered QA." : "Item entered merged-ready flow.",
      auto: true,
    });
  }

  const finalItem = workflowItems.get(itemId) ?? next;
  await finalizeMutation(finalItem);
  return {
    item: finalItem,
    events,
    qaTrigger,
  };
}

export async function createWorkflowEvent(itemId: string, input: WorkflowEventCreateRequest): Promise<WorkflowEventRecord> {
  const item = requireWorkflowItem(itemId);
  const event = appendWorkflowEvent(item, {
    ...input,
    message: input.message.trim(),
  });
  pushActivity("workflow-item", `${item.linear.issueKey}: ${input.message.trim()}`, input.actor.agentId);
  await finalizeMutation(workflowItems.get(item.id) ?? item);
  return event;
}

export async function createWorkflowHandoff(itemId: string, input: WorkflowHandoffCreateRequest): Promise<{
  handoff: WorkflowHandoff;
  event: WorkflowEventRecord;
}> {
  const item = requireWorkflowItem(itemId);
  const summary = input.summary.trim();
  if (!summary) {
    throw new RequestBodyError("Handoff summary is required.");
  }

  const handoff: WorkflowHandoff = {
    id: generateId(),
    itemId: item.id,
    sprintId: item.sprintId,
    from: input.from,
    to: input.to,
    status: "pending",
    summary,
    checklist: (input.checklist ?? []).map((entry) => entry.trim()).filter(Boolean),
    createdAt: Date.now(),
  };
  workflowHandoffs.unshift(handoff);
  const event = appendWorkflowEvent(item, {
    actor: input.from,
    kind: "handoff-requested",
    message: `${item.linear.issueKey} handoff requested from ${input.from.name} to ${input.to.name}.`,
  });
  pushActivity("workflow-handoff", `${item.linear.issueKey}: ${input.from.name} handed work to ${input.to.name}.`, input.from.agentId);
  await finalizeMutation(workflowItems.get(item.id) ?? item);
  return { handoff, event };
}

export async function respondToWorkflowHandoff(handoffId: string, input: WorkflowHandoffResponseRequest): Promise<{
  handoff: WorkflowHandoff;
  event: WorkflowEventRecord;
  item?: WorkflowItem | undefined;
}> {
  const index = workflowHandoffs.findIndex((handoff) => handoff.id === handoffId);
  if (index < 0) {
    throw new RequestBodyError("Workflow handoff not found", 404);
  }

  const existing = workflowHandoffs[index];
  if (!existing) {
    throw new RequestBodyError("Workflow handoff not found", 404);
  }
  assertCurrentSprint(existing.sprintId);
  if (existing.status !== "pending") {
    throw new RequestBodyError("Workflow handoff has already been resolved.", 409);
  }

  const handoff: WorkflowHandoff = {
    ...existing,
    status: input.status,
    respondedAt: Date.now(),
  };
  workflowHandoffs[index] = handoff;

  const item = requireWorkflowItem(existing.itemId);
  const event = appendWorkflowEvent(item, {
    actor: input.actor,
    kind: input.status === "accepted" ? "handoff-accepted" : "handoff-declined",
    message: `${item.linear.issueKey} handoff ${input.status} by ${input.actor.name}.`,
  });

  let updatedItem: WorkflowItem | undefined;
  if (input.status === "accepted") {
    updatedItem = {
      ...item,
      ownership: {
        ...item.ownership,
        ownerAgentId: handoff.to.agentId,
      },
      updatedAt: Date.now(),
    };
    workflowItems.set(item.id, updatedItem);
    pushActivity("workflow-handoff", `${item.linear.issueKey}: ${handoff.to.name} accepted handoff.`, input.actor.agentId);
  } else {
    pushActivity("workflow-handoff", `${item.linear.issueKey}: ${handoff.to.name} declined handoff.`, input.actor.agentId);
  }

  await finalizeMutation(workflowItems.get(item.id) ?? item);
  return {
    handoff,
    event,
    item: updatedItem,
  };
}

export async function createWorkflowComment(itemId: string, input: WorkflowCommentCreateRequest): Promise<{
  comment: WorkflowComment;
  event: WorkflowEventRecord;
}> {
  const item = requireWorkflowItem(itemId);
  const body = input.body.trim();
  if (!body) {
    throw new RequestBodyError("Comment body is required.");
  }
  if (input.target === "linear") {
    assertLinearCommentPermission(input.actor);
  }

  const comment: WorkflowComment = {
    id: generateId(),
    itemId: item.id,
    sprintId: item.sprintId,
    actor: input.actor,
    target: input.target,
    body,
    createdAt: Date.now(),
  };
  workflowComments.unshift(comment);
  const event = appendWorkflowEvent(item, {
    actor: input.actor,
    kind: "comment-added",
    message: `${item.linear.issueKey} ${input.target} comment added by ${input.actor.name}.`,
  });
  pushActivity(
    "workflow-comment",
    `${item.linear.issueKey}: ${input.target === "linear" ? "Linear" : "office"} comment by ${input.actor.name}.`,
    input.actor.agentId,
  );
  await finalizeMutation(workflowItems.get(item.id) ?? item);
  return { comment, event };
}

export async function createQaTrigger(itemId: string, input: WorkflowQaTriggerRequest): Promise<WorkflowQaTrigger> {
  const item = requireWorkflowItem(itemId);
  const reason = input.reason.trim();
  if (!reason) {
    throw new RequestBodyError("QA trigger reason is required.");
  }

  const trigger: WorkflowQaTrigger = {
    id: generateId(),
    itemId: item.id,
    sprintId: item.sprintId,
    status: "queued",
    reason,
    auto: input.auto ?? false,
    triggeredBy: input.actor,
    createdAt: Date.now(),
  };
  workflowQaTriggers.unshift(trigger);

  const updatedItem: WorkflowItem = {
    ...item,
    qa: {
      status: "queued",
      lastTriggeredAt: trigger.createdAt,
      lastTriggerReason: reason,
      lastTriggeredBy: input.actor,
    },
    updatedAt: trigger.createdAt,
    lastEventAt: trigger.createdAt,
  };
  workflowItems.set(item.id, updatedItem);
  appendWorkflowEvent(updatedItem, {
    actor: input.actor,
    kind: "qa-triggered",
    message: `${item.linear.issueKey} QA queued: ${reason}`,
  });
  pushActivity("workflow-qa", `${item.linear.issueKey}: QA queued${input.auto ? " automatically" : ""}.`, input.actor.agentId);
  await finalizeMutation(workflowItems.get(item.id) ?? updatedItem);
  return trigger;
}
