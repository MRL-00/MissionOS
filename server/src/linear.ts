import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { normalizeImportedIssueDescription, normalizeImportedIssueLabels, normalizeImportedIssueTitle } from "./issueImport.js";

export type LocalIssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "qa" | "done" | "canceled";

type LinearState = {
  id: string;
  name: string;
  type: string;
};

type LinearIssueNode = {
  id: string;
  identifier?: string | null;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  priorityLabel?: string | null;
  state?: { id?: string; name?: string; type?: string } | null;
  labels?: { nodes?: Array<{ name: string }> } | null;
};

const LINEAR_STATUS_ALIASES: Record<LocalIssueStatus, string[]> = {
  backlog: ["backlog"],
  todo: ["planned", "planning", "plan", "ready", "todo", "to do", "selected for development"],
  in_progress: ["in progress", "in-progress", "doing", "started"],
  in_review: ["dev review", "development review", "code review", "review", "in review"],
  qa: ["qa", "testing", "test", "quality assurance"],
  done: ["done", "complete", "completed", "merged", "shipped"],
  canceled: ["canceled", "cancelled"],
};

const LINEAR_TYPE_FALLBACKS: Record<LocalIssueStatus, string[]> = {
  backlog: ["backlog", "unstarted"],
  todo: ["unstarted", "backlog"],
  in_progress: ["started"],
  in_review: ["started"],
  qa: ["started"],
  done: ["completed"],
  canceled: ["canceled"],
};

function normalizeStatusName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ");
}

function readSettingsMap(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export { readSettingsMap };

export function normalizeLinearIssueStatus(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/gu, "_") : "";
  if (normalized === "todo" || normalized === "to_do") {
    return "todo";
  }
  if (normalized === "in_progress" || normalized === "started") {
    return "in_progress";
  }
  if (normalized === "in_review" || normalized === "review") {
    return "in_review";
  }
  if (normalized === "done" || normalized === "completed") {
    return "done";
  }
  return "backlog";
}

export function normalizeLinearIssuePriority(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["urgent", "high", "medium", "low"].includes(normalized) ? normalized : "medium";
}

export async function linearRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const settings = readSettingsMap();
  const apiKey = settings.linear_api_key;
  if (!apiKey) {
    throw new Error("Linear API key is not configured.");
  }

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((item) => item.message).join(", ") || response.statusText;
    throw new Error(message);
  }

  if (!payload.data) {
    throw new Error("Linear returned no data.");
  }

  return payload.data;
}

export function localStatusFromLinearState(stateName?: string | null, stateType?: string | null): LocalIssueStatus {
  const normalizedName = normalizeStatusName(stateName ?? "");
  const normalizedType = normalizeStatusName(stateType ?? "");

  for (const [status, aliases] of Object.entries(LINEAR_STATUS_ALIASES) as Array<[LocalIssueStatus, string[]]>) {
    if (aliases.map(normalizeStatusName).includes(normalizedName)) {
      return status;
    }
  }

  if (normalizedType === "completed") {
    return "done";
  }
  if (normalizedType === "canceled") {
    return "canceled";
  }
  if (normalizedType === "started") {
    return "in_progress";
  }
  if (normalizedType === "backlog") {
    return "backlog";
  }
  return "todo";
}

async function loadLinearStatesForIssue(linearId: string): Promise<LinearState[]> {
  const data = await linearRequest<{
    issue: {
      team: {
        states: {
          nodes: LinearState[];
        };
      } | null;
    } | null;
  }>(
    `
    query MissionOSIssueStates($id: String!) {
      issue(id: $id) {
        team {
          states {
            nodes {
              id
              name
              type
            }
          }
        }
      }
    }
    `,
    { id: linearId },
  );

  return data.issue?.team?.states.nodes ?? [];
}

function pickLinearStateId(states: LinearState[], localStatus: string): string | null {
  const status = (Object.keys(LINEAR_STATUS_ALIASES) as LocalIssueStatus[]).includes(localStatus as LocalIssueStatus)
    ? (localStatus as LocalIssueStatus)
    : localStatusFromLinearState(localStatus);
  const aliases = LINEAR_STATUS_ALIASES[status].map(normalizeStatusName);

  const byName = states.find((state) => aliases.includes(normalizeStatusName(state.name)));
  if (byName) {
    return byName.id;
  }

  const fallbackTypes = LINEAR_TYPE_FALLBACKS[status].map(normalizeStatusName);
  return states.find((state) => fallbackTypes.includes(normalizeStatusName(state.type)))?.id ?? null;
}

async function findLinearTeamId(): Promise<string | null> {
  const settings = readSettingsMap();
  const configured = settings.linear_team_id?.trim();
  if (configured) {
    return configured;
  }

  const data = await linearRequest<{
    teams: {
      nodes: Array<{ id: string; name: string; key: string }>;
    };
  }>(`
    query MissionOSTeamsForIssueCreate {
      teams(first: 1) {
        nodes {
          id
          name
          key
        }
      }
    }
  `);

  return data.teams.nodes[0]?.id ?? null;
}

async function findLinearStateIdForTeam(teamId: string, localStatus: string): Promise<string | null> {
  const data = await linearRequest<{
    team: {
      states: {
        nodes: LinearState[];
      };
    } | null;
  }>(
    `
    query MissionOSTeamStates($id: String!) {
      team(id: $id) {
        states {
          nodes {
            id
            name
            type
          }
        }
      }
    }
    `,
    { id: teamId },
  );

  return pickLinearStateId(data.team?.states.nodes ?? [], localStatus);
}

export async function createLinearIssue(input: {
  title: string;
  description?: string | null;
  status?: string | null;
}): Promise<LinearIssueNode | null> {
  const teamId = await findLinearTeamId();
  if (!teamId) {
    throw new Error("No Linear team is available for issue creation.");
  }

  const stateId = input.status ? await findLinearStateIdForTeam(teamId, input.status) : null;
  const data = await linearRequest<{
    issueCreate: {
      success: boolean;
      issue: LinearIssueNode | null;
    };
  }>(
    `
    mutation MissionOSCreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          url
          title
          description
          priorityLabel
          state {
            id
            name
            type
          }
          labels {
            nodes {
              name
            }
          }
        }
      }
    }
    `,
    {
      input: {
        teamId,
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        ...(stateId ? { stateId } : {}),
      },
    },
  );

  return data.issueCreate.success ? data.issueCreate.issue : null;
}

export async function createLinearComment(linearIssueId: string, body: string): Promise<void> {
  await linearRequest(
    `
    mutation MissionOSCreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
      }
    }
    `,
    { input: { issueId: linearIssueId, body } },
  );
}

export async function syncLinearIssueToLocal(linearIssue: Record<string, unknown>) {
  const db = getDb();
  const id = randomUUID();
  const linearId = String(linearIssue.id);
  const labels = normalizeImportedIssueLabels(linearIssue.labels);
  const state = linearIssue.state as { name?: string; type?: string } | null | undefined;
  const existing = db.prepare("SELECT id FROM issues WHERE linear_id = ?").get(linearId) as { id: string } | undefined;
  const issueId = existing?.id ?? id;

  const isNew = !existing;
  let nextNumber: number | null = null;
  if (isNew) {
    const maxRow = db.prepare("SELECT COALESCE(MAX(issue_number), 0) AS m FROM issues").get() as { m: number };
    nextNumber = maxRow.m + 1;
  }
  db.prepare(
    `
    INSERT INTO issues (
      id, issue_number, title, description, status, priority, labels, source, linear_id, linear_identifier, linear_url, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'linear', ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      priority = excluded.priority,
      labels = excluded.labels,
      source = 'linear',
      linear_id = excluded.linear_id,
      linear_identifier = excluded.linear_identifier,
      linear_url = excluded.linear_url,
      issue_number = COALESCE(issues.issue_number, excluded.issue_number),
      updated_at = datetime('now')
    `,
  ).run(
    issueId,
    nextNumber,
    normalizeImportedIssueTitle(linearIssue.title),
    normalizeImportedIssueDescription(linearIssue.description),
    localStatusFromLinearState(
      typeof linearIssue.status === "string" ? linearIssue.status : state?.name,
      state?.type,
    ),
    normalizeLinearIssuePriority(linearIssue.priority),
    JSON.stringify(labels),
    linearId,
    typeof linearIssue.identifier === "string" ? linearIssue.identifier : null,
    typeof linearIssue.url === "string" ? linearIssue.url : null,
  );

  return issueId;
}

export async function patchLinearIssue(
  linearId: string,
  payload: { title?: string | undefined; description?: string | undefined; stateId?: string | undefined },
) {
  try {
    await linearRequest(
      `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
        }
      }
      `,
      { id: linearId, input: payload },
    );
  } catch (error) {
    console.error("Failed to patch Linear issue:", error);
  }
}

export async function patchLinearIssueStatus(linearId: string, localStatus: string): Promise<void> {
  try {
    const states = await loadLinearStatesForIssue(linearId);
    const stateId = pickLinearStateId(states, localStatus);
    if (!stateId) {
      console.warn(`[linear] No matching Linear state for local status "${localStatus}".`);
      return;
    }
    await patchLinearIssue(linearId, { stateId });
  } catch (error) {
    console.error("Failed to patch Linear issue status:", error);
  }
}
