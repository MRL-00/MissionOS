import "./env";
import path from "node:path";
import type {
  ActivityLogEntry,
  AgentAppearance,
  AgentBackendLink,
  AgentEventLocation,
  AgentRegistration,
  WorkflowComment,
  WorkflowEventRecord,
  WorkflowHandoff,
  WorkflowItem,
  WorkflowQaTrigger,
  MeetingType,
  RealtimeAgentStatus,
} from "../src/types";
import type {
  HermesDefaults,
  MissionTaskExecution,
  MissionTaskRunArtifact,
  MissionTaskRunEvent,
  MissionProvider,
  MissionTeamSettings,
  ProviderConnector,
} from "../src/mission/types";

export const PORT = 3001;
export const HERMES_COMMAND = process.env.HERMES_COMMAND?.trim() ?? "hermes";
export const HERMES_URL = process.env.HERMES_URL?.trim() ?? "";
export const HERMES_WS_URL = process.env.HERMES_WS_URL?.trim() ?? "";
export const HERMES_RUNTIME_URL = process.env.HERMES_RUNTIME_URL?.trim() ?? "";
export const HERMES_TOKEN = process.env.HERMES_TOKEN ?? "";
export const HERMES_TOKEN_CONFIGURED = Boolean(HERMES_TOKEN.trim());
export const LINEAR_API_URL = process.env.LINEAR_API_URL?.trim() || "https://api.linear.app/graphql";
export const LINEAR_API_KEY = process.env.LINEAR_API_KEY?.trim() ?? "";
export const LINEAR_API_KEY_CONFIGURED = Boolean(LINEAR_API_KEY);
export const LINEAR_SYNC_INTERVAL_MS = Math.max(10_000, Number(process.env.LINEAR_SYNC_INTERVAL_MS ?? "30000") || 30_000);
export const LINEAR_PAGE_SIZE = Math.max(1, Math.min(250, Number(process.env.LINEAR_PAGE_SIZE ?? "100") || 100));
export const REMOTE_OFFICE_URL = process.env.REMOTE_OFFICE_URL?.trim() ?? "";
export const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Content-Type": "application/json",
} as const;

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_LOG_ENTRIES = 180;
export const DESK_COUNT = 14;
export const CURRENT_SPRINT_ID = process.env.CURRENT_SPRINT_ID?.trim() || "current";

export const VALID_STATUSES = new Set<RealtimeAgentStatus>(["idle", "working", "meeting", "entering", "leaving"]);
export const VALID_LOCATIONS = new Set<AgentEventLocation>(["desk", "meeting-room", "door", "cio-office"]);
export const VALID_MEETING_TYPES = new Set<MeetingType>(["standup", "strategy", "review"]);
export const VALID_SPEEDS = new Set([1, 2, 3] as const);
export const VALID_AGENT_TYPES = new Set<NonNullable<AgentRegistration["type"]>>(["resident", "visitor"]);
export const VALID_BACKEND_PROVIDERS = new Set<AgentBackendLink["provider"]>(["hermes", "claude", "codex", "unlinked"]);
export const VALID_ACCESSORIES = new Set<NonNullable<AgentAppearance["accessories"]>[number]>(["glasses", "hat", "tie", "beard"]);
export const MISSION_PROVIDER_LABELS: Record<MissionProvider, string> = {
  hermes: "Hermes",
  "claude-local": "Claude Code",
  "codex-local": "Codex",
};

export const dataDir = path.resolve(process.cwd(), "data");
export const agentsFilePath = path.join(dataDir, "agents.json");
export const workflowFilePath = path.join(dataDir, "workflow.json");
export const missionControlFilePath = path.join(dataDir, "mission-control.json");

export interface PersistedAgentRecord extends AgentRegistration {
  id: string;
  name: string;
  role: string;
  emoji: string;
  type: "resident" | "visitor";
  appearance: AgentAppearance;
  backendLink: AgentBackendLink;
  deskIndex?: number | undefined;
}

export interface PersistedAgentsFile {
  agents: PersistedAgentRecord[];
}

export interface PersistedWorkflowFile {
  items: WorkflowItem[];
  events: WorkflowEventRecord[];
  handoffs: WorkflowHandoff[];
  comments: WorkflowComment[];
  qaTriggers: WorkflowQaTrigger[];
}

export interface PersistedMissionConnector extends Omit<ProviderConnector, "health" | "capabilities" | "tokenConfigured"> {
  token?: string | undefined;
}

export interface PersistedHermesDefaults extends Omit<HermesDefaults, "tokenConfigured"> {
  token?: string | undefined;
}

export interface PersistedMissionControlFile {
  connectors: PersistedMissionConnector[];
  hermesDefaults?: PersistedHermesDefaults | undefined;
  teamSettings?: MissionTeamSettings | undefined;
  taskExecutions?: Array<MissionTaskExecution & { taskId: string }> | undefined;
  events?: MissionTaskRunEvent[] | undefined;
  artifacts?: MissionTaskRunArtifact[] | undefined;
}

export type ActivityEntryKind = ActivityLogEntry["kind"];

export class RequestBodyError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.statusCode = statusCode;
  }
}
