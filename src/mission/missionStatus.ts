import type { RunRecord } from "@/mission/appTypes";

const ACTIVE_RUN_STATUSES = new Set(["running", "planning"]);

export function missionHasActiveRuns(missionId: string, runs: Pick<RunRecord, "mission_id" | "status">[]) {
  return runs.some((run) => run.mission_id === missionId && ACTIVE_RUN_STATUSES.has(run.status));
}
