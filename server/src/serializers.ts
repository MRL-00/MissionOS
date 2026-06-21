import { asFlag, parseJson } from "./db.js";
import { engineMap } from "./engines/index.js";
import { maskEngineConfig } from "./secretConfig.js";

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  avatar_emoji: string | null;
  created_at: string;
};

export type AuthenticatedRequest = import("express").Request & { user?: UserRow };

export function serializeUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarEmoji: row.avatar_emoji ?? "👤",
    createdAt: row.created_at,
  };
}

export function serializeAgent(row: Record<string, unknown>) {
  const engine = String(row.engine ?? "");
  const connectionConfig = parseJson<Record<string, unknown>>(
    typeof row.connection_config === "string" ? row.connection_config : null,
    {},
  );

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    emoji: row.emoji,
    color: row.color,
    engine: row.engine,
    skills: parseJson<string[]>(typeof row.skills === "string" ? row.skills : null, []),
    tools: parseJson<string[]>(typeof row.tools === "string" ? row.tools : null, []),
    connection_type: row.connection_type,
    connection_config: maskEngineConfig(engine, connectionConfig, engineMap),
    soul_md: row.soul_md,
    agents_md: row.agents_md,
    external_config: asFlag(typeof row.external_config === "number" ? row.external_config : 0),
    active: asFlag(typeof row.active === "number" ? row.active : 0),
    created_at: row.created_at,
    position: {
      x: Number(row.pos_x ?? 0),
      y: Number(row.pos_y ?? 0),
    },
  };
}

export function serializeMission(row: Record<string, unknown>, assignedAgents: unknown[]) {
  const totalIssues = Number(row.total_issues ?? 0);
  const doneIssues = Number(row.done_issues ?? 0);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    team_name: row.team_name ?? "General",
    color: row.color ?? null,
    lead_agent_id: row.lead_agent_id,
    lead_agent_name: row.lead_agent_name,
    lead_agent_emoji: row.lead_agent_emoji,
    linear_project_id: row.linear_project_id,
    github_repo: row.github_repo ?? null,
    github_default_branch: row.github_default_branch ?? "main",
    created_at: row.created_at,
    updated_at: row.updated_at,
    assigned_agents: assignedAgents,
    issue_counts: {
      total: totalIssues,
      complete: doneIssues,
    },
    progress: totalIssues > 0 ? Math.round((doneIssues / totalIssues) * 100) : 0,
    last_active_at: row.last_active_at ?? row.updated_at,
  };
}

export function serializeIssue(row: Record<string, unknown>) {
  return {
    id: row.id,
    issue_number: row.issue_number ?? null,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignee_agent_id: row.assignee_agent_id,
    mission_id: row.mission_id,
    labels: parseJson<string[]>(typeof row.labels === "string" ? row.labels : null, []),
    source: row.source,
    linear_id: row.linear_id,
    linear_identifier: row.linear_identifier ?? null,
    linear_url: row.linear_url ?? null,
    github_id: row.github_id ?? null,
    github_number: row.github_number ?? null,
    github_repo: row.github_repo ?? null,
    github_branch: row.github_branch ?? null,
    github_pr_number: row.github_pr_number ?? null,
    github_pr_url: row.github_pr_url ?? null,
    estimation: row.estimation ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    assignee_name: row.assignee_name,
    assignee_emoji: row.assignee_emoji,
    mission_title: row.mission_title,
    mission_color: row.mission_color ?? null,
  };
}

export function serializeRun(row: Record<string, unknown>) {
  return {
    id: row.id,
    agent_id: row.agent_id,
    mission_id: row.mission_id,
    issue_id: row.issue_id,
    schedule_id: row.schedule_id ?? null,
    engine: row.engine,
    status: row.status,
    prompt: row.prompt,
    output: row.output,
    tool_calls: parseJson<string[]>(typeof row.tool_calls === "string" ? row.tool_calls : null, []),
    workflow_role: row.workflow_role ?? null,
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms,
    working_directory: row.working_directory ?? null,
    github_branch: row.github_branch ?? null,
    github_pr_url: row.github_pr_url ?? null,
    parent_run_id: row.parent_run_id ?? null,
    plan_step_id: row.plan_step_id ?? null,
    execution_plan: typeof row.execution_plan === "string" ? parseJson(row.execution_plan, null) : null,
    agent_name: row.agent_name,
    agent_emoji: row.agent_emoji,
    agent_color: row.agent_color ?? null,
    mission_title: row.mission_title,
    issue_title: row.issue_title,
  };
}

export function serializeSchedule(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    mission_id: row.mission_id ?? null,
    agent_id: row.agent_id,
    prompt: row.prompt,
    cron_expression: row.cron_expression,
    enabled: asFlag(typeof row.enabled === "number" ? row.enabled : 0),
    max_runs: typeof row.max_runs === "number" ? row.max_runs : null,
    run_count: Number(row.run_count ?? 0),
    last_run_at: row.last_run_at ?? null,
    next_run_at: row.next_run_at ?? null,
    last_error: row.last_error ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    agent_name: row.agent_name ?? null,
    agent_emoji: row.agent_emoji ?? null,
    mission_title: row.mission_title ?? null,
    mission_color: row.mission_color ?? null,
  };
}
