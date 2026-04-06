import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

function readSettingsMap(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export { readSettingsMap };

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

export async function syncLinearIssueToLocal(linearIssue: Record<string, unknown>) {
  const db = getDb();
  const id = randomUUID();
  const linearId = String(linearIssue.id);
  const labels =
    Array.isArray(linearIssue.labels) ? linearIssue.labels.map((label) => String((label as { name: string }).name)) : [];
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
      id, issue_number, title, description, status, priority, labels, source, linear_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'linear', ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      priority = excluded.priority,
      labels = excluded.labels,
      source = 'linear',
      linear_id = excluded.linear_id,
      issue_number = COALESCE(issues.issue_number, excluded.issue_number),
      updated_at = datetime('now')
    `,
  ).run(
    issueId,
    nextNumber,
    String(linearIssue.title ?? "Untitled"),
    typeof linearIssue.description === "string" ? linearIssue.description : null,
    String(linearIssue.status ?? "backlog"),
    String(linearIssue.priority ?? "medium"),
    JSON.stringify(labels),
    linearId,
  );
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
