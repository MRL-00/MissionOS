import { randomUUID } from "node:crypto";
import { getDb, parseJson } from "./db.js";
import { patchLinearIssueStatus } from "./linear.js";

export type WorkflowRole = "planner" | "coder" | "reviewer" | "tester";

type IssueRow = {
  id: string;
  issue_number: number | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  labels: string | null;
  mission_id: string | null;
  linear_id: string | null;
  linear_identifier: string | null;
  github_repo: string | null;
  github_branch: string | null;
  github_pr_url: string | null;
  mission_title?: string | null;
  mission_repo?: string | null;
  mission_default_branch?: string | null;
};

type AgentTemplate = {
  role: WorkflowRole;
  name: string;
  title: string;
  emoji: string;
  color: string;
  skills: string[];
  tools: string[];
  soulMd: string;
  agentsMd: string;
};

export const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Planned",
  in_progress: "In Progress",
  in_review: "Dev Review",
  qa: "QA",
  done: "Done",
  canceled: "Canceled",
};

export const WORKFLOW_ROLE_BY_STATUS: Partial<Record<string, WorkflowRole>> = {
  todo: "planner",
  in_progress: "coder",
  in_review: "reviewer",
  qa: "tester",
};

const ROLE_TEMPLATES: AgentTemplate[] = [
  {
    role: "planner",
    name: "Planner",
    title: "Planning Agent",
    emoji: "🧭",
    color: "#8b5cf6",
    skills: ["Planning", "Analysis", "Documentation"],
    tools: ["web-search"],
    soulMd: "# Identity\nYou are MissionOS Planner.\n\n# Function\nTurn Linear issues into concise implementation plans and acceptance criteria.",
    agentsMd:
      "# Output Contract\nReturn a concrete plan, risks, affected areas, and acceptance criteria. End with `PLANNING_STATUS: complete` when the issue is ready for implementation.",
  },
  {
    role: "coder",
    name: "Coder",
    title: "Implementation Agent",
    emoji: "💻",
    color: "#3b82f6",
    skills: ["Implementation", "Testing", "Documentation"],
    tools: ["code-exec", "file-system", "web-search"],
    soulMd: "# Identity\nYou are MissionOS Coder.\n\n# Function\nImplement scoped code changes from the issue and plan.",
    agentsMd:
      "# Output Contract\nReturn what changed, files changed, verification run, and blockers. Keep changes tightly scoped to the issue.",
  },
  {
    role: "reviewer",
    name: "Reviewer",
    title: "Code Review Agent",
    emoji: "🔎",
    color: "#f59e0b",
    skills: ["Code Review", "Testing", "Security"],
    tools: ["code-exec", "file-system", "web-search"],
    soulMd: "# Identity\nYou are MissionOS Reviewer.\n\n# Function\nReview the implementation for correctness, regressions, and missing verification.",
    agentsMd:
      "# Output Contract\nLead with findings. End with exactly one final decision line: `REVIEW_DECISION: approved` or `REVIEW_DECISION: changes_requested`.",
  },
  {
    role: "tester",
    name: "Tester",
    title: "QA Agent",
    emoji: "✅",
    color: "#10b981",
    skills: ["Testing", "QA", "Analysis"],
    tools: ["code-exec", "file-system", "web-search"],
    soulMd:
      "# Identity\nYou are MissionOS Tester.\n\n# Function\nValidate the implemented work through the strongest relevant tests available: web UI, API, simulator, edge, queues, or service checks.",
    agentsMd:
      "# Output Contract\nReport test coverage, failures, and residual risk. End with exactly one final decision line: `QA_DECISION: passed` or `QA_DECISION: failed`.",
  },
];

export function isWorkflowRole(value: unknown): value is WorkflowRole {
  return value === "planner" || value === "coder" || value === "reviewer" || value === "tester";
}

export function getIssueForWorkflow(issueId: string): IssueRow | null {
  return (
    getDb()
      .prepare(
        `
        SELECT
          issues.*,
          missions.title AS mission_title,
          missions.github_repo AS mission_repo,
          missions.github_default_branch AS mission_default_branch
        FROM issues
        LEFT JOIN missions ON missions.id = issues.mission_id
        WHERE issues.id = ?
        `,
      )
      .get(issueId) as IssueRow | undefined
  ) ?? null;
}

export function inferWorkflowRole(agent: Record<string, unknown>): WorkflowRole | null {
  const haystack = `${String(agent.name ?? "")} ${String(agent.role ?? "")}`.toLowerCase();
  if (/\bplanner|planning\b/u.test(haystack)) {
    return "planner";
  }
  if (/\bcoder|developer|engineer|implementation\b/u.test(haystack)) {
    return "coder";
  }
  if (/\breviewer|review|code review\b/u.test(haystack)) {
    return "reviewer";
  }
  if (/\btester|qa|quality\b/u.test(haystack)) {
    return "tester";
  }
  return null;
}

export function ensureWorkflowAgents(): Record<WorkflowRole, string> {
  const db = getDb();
  const agents = db.prepare("SELECT * FROM agents WHERE active = 1 ORDER BY created_at ASC").all() as Array<Record<string, unknown>>;
  const byRole = new Map<WorkflowRole, Record<string, unknown>>();

  for (const agent of agents) {
    const role = inferWorkflowRole(agent);
    if (role && !byRole.has(role)) {
      byRole.set(role, agent);
    }
  }

  const source = agents[0] ?? (db.prepare("SELECT * FROM agents ORDER BY created_at ASC LIMIT 1").get() as Record<string, unknown> | undefined);
  if (!source) {
    throw new Error("At least one execution agent is required before the workflow agents can be created.");
  }

  for (const template of ROLE_TEMPLATES) {
    if (byRole.has(template.role)) {
      continue;
    }

    const existing = db
      .prepare("SELECT * FROM agents WHERE lower(name) = lower(?) LIMIT 1")
      .get(template.name) as Record<string, unknown> | undefined;
    if (existing) {
      byRole.set(template.role, existing);
      continue;
    }

    const id = randomUUID();
    db.prepare(
      `
      INSERT INTO agents (
        id, name, role, emoji, color, engine, skills, tools, connection_type, connection_config,
        soul_md, agents_md, external_config, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
      `,
    ).run(
      id,
      template.name,
      template.title,
      template.emoji,
      template.color,
      source.engine,
      JSON.stringify(template.skills),
      JSON.stringify(template.tools),
      source.connection_type ?? null,
      typeof source.connection_config === "string" ? source.connection_config : JSON.stringify({}),
      template.soulMd,
      template.agentsMd,
    );
    db.prepare("INSERT OR IGNORE INTO agent_positions (agent_id, x, y) VALUES (?, 0, 0)").run(id);
    byRole.set(template.role, { ...template, id, engine: source.engine });
  }

  return {
    planner: String(byRole.get("planner")?.id),
    coder: String(byRole.get("coder")?.id),
    reviewer: String(byRole.get("reviewer")?.id),
    tester: String(byRole.get("tester")?.id),
  };
}

export function workflowRoleForStatus(status: string): WorkflowRole | null {
  return WORKFLOW_ROLE_BY_STATUS[status] ?? null;
}

export function hasActiveWorkflowRun(issueId: string, role: WorkflowRole): boolean {
  const row = getDb()
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM runs
      WHERE issue_id = ?
        AND workflow_role = ?
        AND status IN ('running', 'planning')
      `,
    )
    .get(issueId, role) as { count: number };
  return row.count > 0;
}

export async function setIssueWorkflowStatus(
  issueId: string,
  status: string,
  options: { syncLinear?: boolean } = {},
): Promise<void> {
  const issue = getIssueForWorkflow(issueId);
  if (!issue) {
    return;
  }

  getDb()
    .prepare("UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, issueId);

  if (options.syncLinear !== false && issue.linear_id) {
    await patchLinearIssueStatus(issue.linear_id, status);
  }
}

export function buildWorkflowPrompt(role: WorkflowRole, issue: IssueRow): string {
  const labels = parseJson<string[]>(issue.labels, []);
  const issueKey = issue.linear_identifier ?? (issue.issue_number != null ? `EPIC-${String(issue.issue_number).padStart(3, "0")}` : issue.id);
  const repo = issue.github_repo ?? issue.mission_repo ?? "No repository linked";
  const branch = issue.github_branch ?? issue.mission_default_branch ?? "main";
  const prLine = issue.github_pr_url ? `Pull request: ${issue.github_pr_url}` : "Pull request: none yet";
  const base = [
    `Workflow role: ${role}.`,
    `Issue: ${issueKey} - ${issue.title}`,
    `Mission: ${issue.mission_title ?? "None"}`,
    `Repository: ${repo}`,
    `Branch/context: ${branch}`,
    prLine,
    `Priority: ${issue.priority}`,
    labels.length > 0 ? `Labels: ${labels.join(", ")}` : "Labels: none",
    "",
    "Description:",
    issue.description?.trim() || "No description provided.",
  ];

  if (role === "planner") {
    return [
      ...base,
      "",
      "Create an implementation plan. Do not edit files. Include acceptance criteria and blockers. End with `PLANNING_STATUS: complete`.",
    ].join("\n");
  }
  if (role === "coder") {
    return [
      ...base,
      "",
      "Implement the issue. Use the existing codebase conventions, keep scope tight, and run the strongest relevant checks available.",
    ].join("\n");
  }
  if (role === "reviewer") {
    return [
      ...base,
      "",
      "Review the implementation. If it is good, end with `REVIEW_DECISION: approved`. If it needs changes, list required fixes and end with `REVIEW_DECISION: changes_requested`.",
    ].join("\n");
  }
  return [
    ...base,
    "",
    "Run QA using the strongest relevant validation path: web UI, API, simulator, edge services, queues, or local tests. End with `QA_DECISION: passed` or `QA_DECISION: failed`.",
  ].join("\n");
}

export function reviewerApproved(output: string): boolean {
  if (/REVIEW_DECISION:\s*approved/i.test(output)) {
    return true;
  }
  if (/REVIEW_DECISION:\s*changes_requested/i.test(output)) {
    return false;
  }
  return !/\b(changes requested|must fix|blocking|regression|not approved)\b/i.test(output);
}

export function qaPassed(output: string): boolean {
  if (/QA_DECISION:\s*passed/i.test(output)) {
    return true;
  }
  if (/QA_DECISION:\s*failed/i.test(output)) {
    return false;
  }
  return !/\b(failed|failure|blocked|regression|not pass|does not pass)\b/i.test(output);
}
