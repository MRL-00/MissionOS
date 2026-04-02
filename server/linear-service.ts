import type {
  MissionTask,
  MissionTaskComment,
  MissionTaskDetail,
  MissionTaskHandoff,
  MissionTaskSnapshot,
  MissionTaskUpdateRequest,
} from "../src/mission/types";
import { isMissionTaskBacklog } from "../src/mission/taskBoard";
import { LINEAR_API_KEY, LINEAR_API_URL, LINEAR_PAGE_SIZE, RequestBodyError } from "./types";

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  gitBranchName?: string | null;
  url?: string | null;
  priority?: number | null;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
  state?: {
    id?: string | null;
    name?: string | null;
    type?: string | null;
    color?: string | null;
  } | null;
  assignee?: {
    id: string;
    name?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
  team?: {
    id?: string | null;
    key?: string | null;
    name?: string | null;
    states?: {
      nodes?: Array<{
        id: string;
        name?: string | null;
        type?: string | null;
        color?: string | null;
      }>;
    } | null;
  } | null;
  project?: {
    id: string;
    name?: string | null;
  } | null;
  cycle?: {
    id: string;
    name?: string | null;
    number?: number | null;
  } | null;
  labels?: {
    nodes?: Array<{
      id: string;
      name?: string | null;
      color?: string | null;
    }>;
  } | null;
  comments?: {
    nodes?: Array<{
      id: string;
      body?: string | null;
      createdAt: string;
      user?: {
        id?: string | null;
        name?: string | null;
        displayName?: string | null;
      } | null;
    }>;
  } | null;
  attachments?: {
    nodes?: Array<{
      id: string;
      title?: string | null;
      url?: string | null;
    }>;
  } | null;
}

interface LinearCycleNode {
  id: string;
  name?: string | null;
  number?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  team?: {
    id?: string | null;
    key?: string | null;
    name?: string | null;
  } | null;
}

interface GraphQlEnvelope<T> {
  data?: T | undefined;
  errors?: Array<{ message?: string | undefined }> | undefined;
}

function parseTimestamp(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (!value) {
    return Date.now();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function missionTaskFromIssue(issue: LinearIssueNode, handoffs: MissionTaskHandoff[]): MissionTask {
  const taskHandoffs = handoffs.filter((handoff) => handoff.taskId === issue.id);
  const comments = issue.comments?.nodes ?? [];
  const pullRequestUrls = Array.from(new Set(
    (issue.attachments?.nodes ?? [])
      .map((attachment) => attachment?.url?.trim() ?? "")
      .filter((url) => /github\.com\/.+\/pull\/\d+$/i.test(url)),
  ));

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    gitBranchName: issue.gitBranchName ?? undefined,
    pullRequestUrls: pullRequestUrls.length > 0 ? pullRequestUrls : undefined,
    url: issue.url ?? undefined,
    priority: typeof issue.priority === "number" ? issue.priority : 0,
    state: {
      id: issue.state?.id ?? undefined,
      name: issue.state?.name ?? "Unknown",
      type: issue.state?.type ?? undefined,
      color: issue.state?.color ?? undefined,
    },
    team: {
      id: issue.team?.id ?? undefined,
      key: issue.team?.key ?? undefined,
      name: issue.team?.name ?? "Unassigned team",
    },
    project: issue.project?.id
      ? {
          id: issue.project.id,
          name: issue.project.name ?? "Project",
        }
      : undefined,
    cycle: issue.cycle?.id
      ? {
          id: issue.cycle.id,
          name: issue.cycle.name ?? "Cycle",
          number: issue.cycle.number ?? undefined,
        }
      : undefined,
    assignee: issue.assignee?.id
      ? {
          id: issue.assignee.id,
          name: issue.assignee.displayName ?? issue.assignee.name ?? "Unassigned",
          avatarUrl: issue.assignee.avatarUrl ?? undefined,
        }
      : undefined,
    labels: (issue.labels?.nodes ?? [])
      .filter((label): label is NonNullable<typeof label> => Boolean(label?.id))
      .map((label) => ({
        id: label.id,
        name: label.name ?? "Label",
        color: label.color ?? undefined,
      })),
    dueDate: issue.dueDate ?? undefined,
    createdAt: parseTimestamp(issue.createdAt),
    updatedAt: parseTimestamp(issue.updatedAt),
    handoffCount: taskHandoffs.length,
    commentCount: comments.length,
  };
}

function missionCommentsFromIssue(issue: LinearIssueNode): MissionTaskComment[] {
  return (issue.comments?.nodes ?? [])
    .filter((comment): comment is NonNullable<typeof comment> => Boolean(comment?.id))
    .map((comment) => ({
      id: comment.id,
      taskId: issue.id,
      body: comment.body ?? "",
      authorName: comment.user?.displayName ?? comment.user?.name ?? "Linear user",
      authorId: comment.user?.id ?? undefined,
      createdAt: parseTimestamp(comment.createdAt),
      source: "linear" as const,
    }))
    .sort((left, right) => left.createdAt - right.createdAt);
}

function describeLinearCycle(cycle: LinearCycleNode): string {
  const teamLabel = cycle.team?.key ?? cycle.team?.name ?? "Linear";
  if (cycle.name?.trim()) {
    return `${teamLabel} ${cycle.name.trim()}`;
  }
  if (typeof cycle.number === "number") {
    return `${teamLabel} cycle ${cycle.number}`;
  }
  return `${teamLabel} active cycle`;
}

function buildActiveCycleMessage(cycles: LinearCycleNode[], taskCount: number): string {
  if (cycles.length === 0) {
    return "No active Linear cycles found.";
  }
  if (cycles.length === 1) {
    const [currentCycle] = cycles;
    if (!currentCycle) {
      return `Synced ${taskCount} issue${taskCount === 1 ? "" : "s"}.`;
    }
    return `Synced ${taskCount} issue${taskCount === 1 ? "" : "s"} from ${describeLinearCycle(currentCycle)}.`;
  }
  return `Synced ${taskCount} issue${taskCount === 1 ? "" : "s"} from ${cycles.length} active Linear cycles.`;
}

async function linearGraphQl<TData>(query: string, variables: Record<string, unknown>): Promise<TData> {
  if (!LINEAR_API_KEY) {
    throw new RequestBodyError("LINEAR_API_KEY is not configured.", 503);
  }

  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json().catch(() => ({}))) as GraphQlEnvelope<TData>;
  const errorMessage = payload.errors?.[0]?.message ?? (!response.ok ? `Linear request failed (${response.status})` : undefined);
  if (errorMessage) {
    throw new RequestBodyError(errorMessage, response.ok ? 502 : response.status);
  }
  if (!payload.data) {
    throw new RequestBodyError("Linear response was empty.", 502);
  }
  return payload.data;
}

function isLinearOptionalFieldError(error: unknown): boolean {
  if (!(error instanceof RequestBodyError)) {
    return false;
  }

  return /gitbranchname|attachments/i.test(error.message);
}

const ISSUE_FIELDS_BASE = `
  id
  identifier
  title
  description
  url
  priority
  dueDate
  createdAt
  updatedAt
  state {
    id
    name
    type
    color
  }
  assignee {
    id
    name
    displayName
    avatarUrl
  }
  team {
    id
    key
    name
    states {
      nodes {
        id
        name
        type
        color
      }
    }
  }
  project {
    id
    name
  }
  cycle {
    id
    name
    number
  }
  labels {
    nodes {
      id
      name
      color
    }
  }
`;

const ISSUE_FIELDS_ENRICHED = `
  ${ISSUE_FIELDS_BASE}
  gitBranchName
  attachments {
    nodes {
      id
      title
      url
    }
  }
`;

async function fetchActiveLinearCycles(): Promise<LinearCycleNode[]> {
  const data = await linearGraphQl<{ cycles: { nodes?: LinearCycleNode[] | undefined } }>(
    `query MissionActiveCycles($first: Int!) {
      cycles(first: $first, filter: { isActive: { eq: true } }) {
        nodes {
          id
          name
          number
          startsAt
          endsAt
          team {
            id
            key
            name
          }
        }
      }
    }`,
    { first: Math.min(50, LINEAR_PAGE_SIZE) },
  );

  return (data.cycles.nodes ?? []).filter((cycle): cycle is LinearCycleNode => Boolean(cycle?.id));
}

export async function syncLinearTasks(handoffs: MissionTaskHandoff[]): Promise<MissionTaskSnapshot> {
  if (!LINEAR_API_KEY) {
    return {
      tasks: [],
      syncedAt: Date.now(),
      syncState: "idle",
      error: "Configure LINEAR_API_KEY to enable live Linear sync.",
    };
  }

  const activeCycles = await fetchActiveLinearCycles();
  const activeCycleIds = new Set(activeCycles.map((cycle) => cycle.id));

  if (activeCycleIds.size === 0) {
    return {
      tasks: [],
      syncedAt: Date.now(),
      syncState: "ok",
      message: buildActiveCycleMessage(activeCycles, 0),
    };
  }

  const variables = {
    first: LINEAR_PAGE_SIZE,
    cycleIds: Array.from(activeCycleIds),
  };

  let data: { issues: { nodes?: LinearIssueNode[] | undefined } };
  try {
    data = await linearGraphQl<{ issues: { nodes?: LinearIssueNode[] | undefined } }>(
      `query MissionTasks($first: Int!, $cycleIds: [ID!]!) {
        issues(first: $first, filter: { cycle: { id: { in: $cycleIds } } }) {
          nodes {
            ${ISSUE_FIELDS_ENRICHED}
          }
        }
      }`,
      variables,
    );
  } catch (error) {
    if (!isLinearOptionalFieldError(error)) {
      throw error;
    }

    data = await linearGraphQl<{ issues: { nodes?: LinearIssueNode[] | undefined } }>(
      `query MissionTasks($first: Int!, $cycleIds: [ID!]!) {
        issues(first: $first, filter: { cycle: { id: { in: $cycleIds } } }) {
          nodes {
            ${ISSUE_FIELDS_BASE}
          }
        }
      }`,
      variables,
    );
  }

  const tasks = (data.issues.nodes ?? [])
    .filter((issue): issue is LinearIssueNode => {
      const cycleId = issue?.cycle?.id;
      return typeof cycleId === "string" && activeCycleIds.has(cycleId);
    })
    .filter((issue) => !isMissionTaskBacklog({
      name: issue.state?.name ?? "",
      type: issue.state?.type ?? undefined,
    }))
    .map((issue) => missionTaskFromIssue(issue, handoffs))
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return {
    tasks,
    syncedAt: Date.now(),
    syncState: "ok",
    message: buildActiveCycleMessage(activeCycles, tasks.length),
  };
}

export async function fetchLinearTaskDetail(taskId: string, handoffs: MissionTaskHandoff[]): Promise<MissionTaskDetail> {
  const variables = { id: taskId };
  let data: { issue: LinearIssueNode | null };

  try {
    data = await linearGraphQl<{ issue: LinearIssueNode | null }>(
      `query MissionTask($id: String!) {
        issue(id: $id) {
          ${ISSUE_FIELDS_ENRICHED}
          comments(first: 50) {
            nodes {
              id
              body
              createdAt
              user {
                id
                name
                displayName
              }
            }
          }
        }
      }`,
      variables,
    );
  } catch (error) {
    if (!isLinearOptionalFieldError(error)) {
      throw error;
    }

    data = await linearGraphQl<{ issue: LinearIssueNode | null }>(
      `query MissionTask($id: String!) {
        issue(id: $id) {
          ${ISSUE_FIELDS_BASE}
          comments(first: 50) {
            nodes {
              id
              body
              createdAt
              user {
                id
                name
                displayName
              }
            }
          }
        }
      }`,
      variables,
    );
  }

  if (!data.issue) {
    throw new RequestBodyError("Linear issue not found.", 404);
  }

  return {
    task: missionTaskFromIssue(data.issue, handoffs),
    comments: missionCommentsFromIssue(data.issue),
    handoffs: handoffs
      .filter((handoff) => handoff.taskId === taskId)
      .sort((left, right) => right.createdAt - left.createdAt),
  };
}

async function resolveStateId(taskId: string, input: MissionTaskUpdateRequest): Promise<string | undefined> {
  if (input.stateId) {
    return input.stateId;
  }
  if (!input.stateName) {
    return undefined;
  }

  const detail = await linearGraphQl<{ issue: LinearIssueNode | null }>(
    `query MissionTaskStates($id: String!) {
      issue(id: $id) {
        team {
          states {
            nodes {
              id
              name
            }
          }
        }
      }
    }`,
    { id: taskId },
  );

  const state = detail.issue?.team?.states?.nodes?.find(
    (entry) => entry.name?.trim().toLowerCase() === input.stateName?.trim().toLowerCase(),
  );

  if (!state?.id) {
    throw new RequestBodyError(`Could not find Linear state "${input.stateName}".`, 400);
  }

  return state.id;
}

export async function updateLinearTask(
  taskId: string,
  input: MissionTaskUpdateRequest,
  handoffs: MissionTaskHandoff[],
): Promise<MissionTask> {
  const stateId = await resolveStateId(taskId, input);
  await linearGraphQl<{ issueUpdate: { success: boolean } }>(
    `mutation MissionTaskUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
      }
    }`,
    {
      id: taskId,
      input: {
        title: input.title,
        description: input.description,
        stateId,
        assigneeId: input.assigneeId === null ? null : input.assigneeId,
        priority: input.priority,
        dueDate: input.dueDate,
      },
    },
  );

  const detail = await fetchLinearTaskDetail(taskId, handoffs);
  return detail.task;
}

export async function createLinearTaskComment(taskId: string, body: string): Promise<void> {
  await linearGraphQl<{ commentCreate: { success: boolean } }>(
    `mutation MissionTaskComment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
      }
    }`,
    {
      issueId: taskId,
      body,
    },
  );
}
