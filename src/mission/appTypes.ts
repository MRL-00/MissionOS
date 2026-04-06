export interface BootstrapState {
  hasAccount: boolean;
  hasAgents: boolean;
  hasProject: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarEmoji: string;
  createdAt: string;
}

export interface EngineField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "url";
  placeholder?: string;
  defaultValue?: string | number;
  required?: boolean;
}

export interface EngineDefinition {
  id: string;
  label: string;
  description: string;
  connectionType: "cli" | "http" | "local";
  fields: EngineField[];
}

export interface EngineConnectionResult {
  ok: boolean;
  message: string;
  latency_ms: number;
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  upgradeCommand?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  created_at?: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  role: string | null;
  emoji: string;
  color: string;
  engine: string;
  skills: string[];
  tools: string[];
  connection_type: string | null;
  connection_config: Record<string, unknown>;
  soul_md: string | null;
  agents_md: string | null;
  external_config: boolean;
  active: boolean;
  created_at: string;
  position: {
    x: number;
    y: number;
  };
}

export interface RelationshipRecord {
  id: string;
  parent_id: string;
  child_id: string;
}

export interface MissionAssignedAgent {
  id: string;
  name: string;
  role: string | null;
  emoji: string;
  color: string;
}

export interface MissionRecord {
  id: string;
  title: string;
  description: string | null;
  status: string;
  color: string | null;
  lead_agent_id: string | null;
  lead_agent_name: string | null;
  lead_agent_emoji: string | null;
  linear_project_id: string | null;
  github_repo: string | null;
  github_default_branch: string | null;
  created_at: string;
  updated_at: string;
  assigned_agents: MissionAssignedAgent[];
  issue_counts: {
    total: number;
    complete: number;
  };
  progress: number;
  last_active_at: string;
}

export interface IssueRecord {
  id: string;
  issue_number: number | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_agent_id: string | null;
  mission_id: string | null;
  labels: string[];
  source: string;
  linear_id: string | null;
  github_id: number | null;
  github_number: number | null;
  github_repo: string | null;
  github_branch: string | null;
  github_pr_number: number | null;
  github_pr_url: string | null;
  created_at: string;
  updated_at: string;
  assignee_name?: string | null;
  assignee_emoji?: string | null;
  mission_title?: string | null;
  mission_color?: string | null;
}

export interface IssueCommentRecord {
  id: string;
  issue_id: string;
  parent_id: string | null;
  author_type: "user" | "agent";
  author_id: string | null;
  body: string;
  created_at: string;
  author_name?: string | null;
  author_emoji?: string | null;
}

export interface RunRecord {
  id: string;
  agent_id: string | null;
  mission_id: string | null;
  issue_id: string | null;
  schedule_id: string | null;
  engine: string;
  status: string;
  prompt: string;
  output: string;
  tool_calls: string[];
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  working_directory: string | null;
  github_branch: string | null;
  github_pr_url: string | null;
  parent_run_id: string | null;
  plan_step_id: string | null;
  execution_plan: { plan: Array<{ id: string; agent: string; task: string; dependsOn?: string[] }>; summary?: string } | null;
  agent_name?: string | null;
  agent_emoji?: string | null;
  agent_color?: string | null;
  mission_title?: string | null;
  issue_title?: string | null;
}

export interface ScheduleRecord {
  id: string;
  name: string;
  agent_id: string;
  prompt: string;
  cron_expression: string;
  enabled: boolean;
  max_runs: number | null;
  run_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  agent_name?: string | null;
  agent_emoji?: string | null;
}

export interface AgentMessageRecord {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  mission_id: string | null;
  run_id: string | null;
  message: string;
  created_at: string;
  from_agent_name?: string | null;
  from_agent_emoji?: string | null;
  to_agent_name?: string | null;
  to_agent_emoji?: string | null;
}

export interface SearchResults {
  agents: Array<{ id: string; name: string; role: string | null }>;
  missions: Array<{ id: string; title: string; description: string | null }>;
  issues: Array<{ id: string; title: string; description: string | null }>;
  runs: Array<{ id: string; prompt: string; output: string }>;
  comments: Array<{ id: string; issue_id: string; body: string }>;
}

export interface DocFileRecord {
  path: string;
  title: string;
}
