import { compareMissionTasksForBoard, getMissionTaskBoardStage, isMissionTaskBacklog } from "./taskBoard";
import type { MissionTask } from "./types";

function makeTask(identifier: string, stateName: string, updatedAt: number, stateType?: string): MissionTask {
  return {
    id: identifier,
    identifier,
    title: identifier,
    priority: 0,
    state: {
      name: stateName,
      type: stateType,
    },
    team: {
      name: "Ops",
    },
    labels: [],
    createdAt: updatedAt,
    updatedAt,
    handoffCount: 0,
    commentCount: 0,
  };
}

describe("taskBoard helpers", () => {
  it("detects backlog tasks from either state name or Linear state type", () => {
    expect(isMissionTaskBacklog({ name: "Backlog", type: "unstarted" })).toBe(true);
    expect(isMissionTaskBacklog({ name: "Triage", type: "backlog" })).toBe(true);
    expect(getMissionTaskBoardStage({ name: "To Do", type: "unstarted" })).toBe("todo");
  });

  it("sorts tasks in the requested board order before recency", () => {
    const sorted = [
      makeTask("LIN-6", "Deployed", 60_000),
      makeTask("LIN-4", "QA Review", 40_000),
      makeTask("LIN-2", "In Progress", 20_000),
      makeTask("LIN-1", "To Do", 10_000),
      makeTask("LIN-3", "UAT Review", 30_000),
      makeTask("LIN-5", "Ready to Deploy", 50_000),
    ].sort(compareMissionTasksForBoard);

    expect(sorted.map((task) => task.identifier)).toEqual([
      "LIN-1",
      "LIN-2",
      "LIN-4",
      "LIN-3",
      "LIN-5",
      "LIN-6",
    ]);
  });
});
