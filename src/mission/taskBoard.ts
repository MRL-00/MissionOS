import type { MissionTask, MissionTaskStatus } from "./types";

export type MissionTaskBoardStage =
  | "todo"
  | "in_progress"
  | "qa_review"
  | "uat_review"
  | "ready_to_deploy"
  | "deployed"
  | "other"
  | "backlog";

const MISSION_TASK_STAGE_RANK: Record<MissionTaskBoardStage, number> = {
  todo: 0,
  in_progress: 1,
  qa_review: 2,
  uat_review: 3,
  ready_to_deploy: 4,
  deployed: 5,
  other: 6,
  backlog: 7,
};

function normalizeStatusLabel(value?: string): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function getMissionTaskBoardStage(status: Pick<MissionTaskStatus, "name" | "type">): MissionTaskBoardStage {
  const normalizedType = normalizeStatusLabel(status.type);
  const normalizedName = normalizeStatusLabel(status.name);

  if (normalizedType === "backlog" || normalizedName === "backlog" || normalizedName === "icebox") {
    return "backlog";
  }
  if (normalizedName === "todo" || normalizedName === "to do") {
    return "todo";
  }
  if (normalizedName === "in progress") {
    return "in_progress";
  }
  if (normalizedName === "qa review" || normalizedName === "qa") {
    return "qa_review";
  }
  if (normalizedName === "uat review" || normalizedName === "uat") {
    return "uat_review";
  }
  if (normalizedName === "ready to deploy" || normalizedName === "merged ready") {
    return "ready_to_deploy";
  }
  if (normalizedName === "deployed" || normalizedName === "done" || normalizedType === "completed") {
    return "deployed";
  }

  return "other";
}

export function isMissionTaskBacklog(status: Pick<MissionTaskStatus, "name" | "type">): boolean {
  return getMissionTaskBoardStage(status) === "backlog";
}

export function compareMissionTasksForBoard(left: MissionTask, right: MissionTask): number {
  const stageDelta =
    MISSION_TASK_STAGE_RANK[getMissionTaskBoardStage(left.state)]
    - MISSION_TASK_STAGE_RANK[getMissionTaskBoardStage(right.state)];
  if (stageDelta !== 0) {
    return stageDelta;
  }

  const updatedDelta = right.updatedAt - left.updatedAt;
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return left.identifier.localeCompare(right.identifier);
}
