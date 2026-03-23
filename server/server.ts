import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import agentsConfig from "../src/config/agents.json";
import { FACILITATOR_ROTATION } from "../src/config/meeting-rules";
import type {
  ActivityLogEntry,
  AgentCompleteRequest,
  AgentEvent,
  AgentEventLocation,
  AgentRegistration,
  AgentRuntimeState,
  AgentSpawnRequest,
  MeetingConfig,
  MeetingRequest,
  MeetingRunRequest,
  MeetingScript,
  MeetingSpeed,
  MeetingType,
  RealtimeAgentStatus,
  ServerMessage,
} from "../src/types";
import { MeetingEngine } from "./meeting";

const PORT = 3001;
const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Content-Type": "application/json",
} as const;

const builtInAgentIds = new Set<string>();
const agentStates = new Map<string, AgentRuntimeState>();
const activityLog: ActivityLogEntry[] = [];
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOG_ENTRIES = 60;
const VALID_STATUSES = new Set<RealtimeAgentStatus>(["idle", "working", "meeting", "entering", "leaving"]);
const VALID_LOCATIONS = new Set<AgentEventLocation>(["desk", "meeting-room", "door", "cio-office"]);
const VALID_MEETING_TYPES = new Set<MeetingType>(["standup", "strategy", "review"]);
const VALID_SPEEDS = new Set<MeetingSpeed>([1, 2, 3]);

class RequestBodyError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.statusCode = statusCode;
  }
}

function seedBuiltInAgents(): void {
  agentsConfig.forEach((agent) => {
    builtInAgentIds.add(agent.id);
    agentStates.set(agent.id, {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      connected: true,
      status: "idle",
      location: "desk",
      timestamp: Date.now(),
    });
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, DEFAULT_HEADERS);
  response.end(JSON.stringify(body));
}

async function readJson<T>(request: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new RequestBodyError("Request body too large");
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new RequestBodyError("Invalid JSON payload");
  }
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Partial<AgentEvent>;
  return (
    typeof event.agentId === "string" &&
    VALID_STATUSES.has(event.status as RealtimeAgentStatus) &&
    (event.location === undefined || VALID_LOCATIONS.has(event.location as AgentEventLocation)) &&
    typeof event.timestamp === "number"
  );
}

function isRegistration(value: unknown): value is AgentRegistration {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const registration = value as Partial<AgentRegistration>;
  return (
    typeof registration.id === "string" &&
    typeof registration.name === "string" &&
    typeof registration.role === "string"
  );
}

function isMeetingRequest(value: unknown): value is MeetingRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<MeetingRequest>;
  return Array.isArray(request.agentIds) && request.agentIds.every((agentId) => typeof agentId === "string");
}

function isAgentSpawnRequest(value: unknown): value is AgentSpawnRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<AgentSpawnRequest>;
  return typeof request.agentId === "string" && typeof request.task === "string";
}

function isAgentCompleteRequest(value: unknown): value is AgentCompleteRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<AgentCompleteRequest>;
  return typeof request.agentId === "string";
}

function isMeetingConfig(value: unknown): value is MeetingConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const config = value as Partial<MeetingConfig>;
  return (
    VALID_MEETING_TYPES.has(config.type as MeetingType) &&
    Array.isArray(config.participants) &&
    config.participants.every((agentId) => typeof agentId === "string") &&
    typeof config.facilitatorId === "string" &&
    (config.topic === undefined || typeof config.topic === "string") &&
    (config.presenter === undefined || typeof config.presenter === "string")
  );
}

function isMeetingTurn(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const turn = value as Partial<MeetingScript["turns"][number]>;
  return typeof turn.agentId === "string" && typeof turn.message === "string" && typeof turn.timestamp === "number";
}

function isMeetingRunRequest(value: unknown): value is MeetingRunRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<MeetingRunRequest>;
  const script = request.script as Partial<MeetingScript> | undefined;
  return (
    !!script &&
    isMeetingConfig(script.config) &&
    Array.isArray(script.turns) &&
    script.turns.every((turn) => isMeetingTurn(turn)) &&
    typeof script.summary === "string" &&
    (request.speed === undefined || VALID_SPEEDS.has(request.speed as MeetingSpeed))
  );
}

function getOrderedStates(): AgentRuntimeState[] {
  return Array.from(agentStates.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function broadcast(message: ServerMessage): void {
  const payload = JSON.stringify(message);
  websocketServer.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastSnapshot(): void {
  broadcast({
    type: "agents-snapshot",
    agents: getOrderedStates(),
  });
}

function pushActivity(
  kind: ActivityLogEntry["kind"],
  message: string,
  agentId?: string,
): ActivityLogEntry {
  const entry: ActivityLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    kind,
    message,
    agentId,
  };
  activityLog.unshift(entry);
  activityLog.splice(MAX_LOG_ENTRIES);
  broadcast({
    type: "activity-log",
    entry,
  });
  return entry;
}

function ensureAgentState(agentId: string): AgentRuntimeState {
  const existing = agentStates.get(agentId);
  if (existing) {
    return existing;
  }

  const fallback: AgentRuntimeState = {
    id: agentId,
    name: agentId,
    role: "Temporary Agent",
    connected: true,
    status: "idle",
    location: "desk",
    timestamp: Date.now(),
  };
  agentStates.set(agentId, fallback);
  return fallback;
}

function applyEvent(event: AgentEvent): AgentRuntimeState {
  const current = ensureAgentState(event.agentId);
  const next: AgentRuntimeState = {
    ...current,
    connected: true,
    status: event.status,
    timestamp: event.timestamp,
  };

  if (event.task !== undefined) {
    next.task = event.task;
  }
  if (event.message !== undefined) {
    next.message = event.message;
  }
  if (event.location !== undefined) {
    next.location = event.location;
  }

  agentStates.set(event.agentId, next);
  broadcast({
    type: "agent-event",
    event,
  });
  return next;
}

function ensureKnownAgents(agentIds: string[]): void {
  const unknownAgentId = agentIds.find((agentId) => !agentStates.has(agentId));
  if (unknownAgentId) {
    throw new RequestBodyError(`Unknown agent id: ${unknownAgentId}`);
  }
}

function chooseFacilitator(participants: string[]): string {
  const rotated = FACILITATOR_ROTATION.find((agentId) => participants.includes(agentId));
  if (!rotated) {
    throw new RequestBodyError("Meeting requires at least one participant");
  }
  return rotated;
}

function buildLegacyMeetingScript(agentIds: string[]): MeetingScript {
  ensureKnownAgents(agentIds);
  const facilitatorId = chooseFacilitator(agentIds);
  return {
    config: {
      type: "standup",
      participants: agentIds,
      facilitatorId,
    },
    turns: agentIds.map((agentId, index) => ({
      agentId,
      message: index === 0 ? "Status update from the floor." : "I’m aligned and moving my tasks forward.",
      timestamp: Date.now() + index,
    })),
    summary: "Standup complete. Back to execution.",
  };
}

seedBuiltInAgents();

const meetingEngine = new MeetingEngine({
  onBroadcast: broadcast,
  onApplyEvent(event) {
    applyEvent(event);
    const state = agentStates.get(event.agentId);
    if (!state) {
      return;
    }
    if (event.status === "entering") {
      pushActivity("agent-status", `${state.name} is moving to ${event.location ?? "the office"}.`, event.agentId);
      return;
    }
    if (event.status === "meeting" && event.message) {
      pushActivity("meeting-turn", `${state.name}: ${event.message}`, event.agentId);
      return;
    }
    pushActivity("agent-status", `${state.name} is now ${event.status}.`, event.agentId);
  },
  onMeetingState(state) {
    if (state.active && state.config && state.progress.currentTurn === 0) {
      pushActivity("meeting-start", `${state.config.type} meeting started.`, state.config.facilitatorId);
      return;
    }
    if (!state.active && state.summary) {
      pushActivity("meeting-end", state.summary, state.config?.facilitatorId);
      return;
    }
    if (!state.active && state.stopped) {
      pushActivity("meeting-stop", "Meeting stopped early.");
    }
  },
});

const httpServer = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "OPTIONS") {
    response.writeHead(204, DEFAULT_HEADERS);
    response.end();
    return;
  }

  try {
    if (method === "GET" && url.pathname === "/api/agents") {
      sendJson(response, 200, { agents: getOrderedStates() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/activity") {
      sendJson(response, 200, { entries: activityLog });
      return;
    }

    if (method === "POST" && url.pathname === "/api/agent/register") {
      const body = await readJson<unknown>(request);
      if (!isRegistration(body)) {
        throw new RequestBodyError("Invalid registration payload");
      }

      const next: AgentRuntimeState = {
        id: body.id,
        name: body.name,
        role: body.role,
        connected: true,
        status: "idle",
        location: "desk",
        timestamp: Date.now(),
      };
      agentStates.set(body.id, next);
      pushActivity("registration", `Registered external agent ${body.name}.`, body.id);
      broadcastSnapshot();
      sendJson(response, 201, next);
      return;
    }

    if (method === "POST" && url.pathname === "/api/agent/status") {
      const body = await readJson<unknown>(request);
      if (!isAgentEvent(body)) {
        throw new RequestBodyError("Invalid agent event payload");
      }

      const next = applyEvent(body);
      pushActivity("agent-status", `${next.name} is now ${next.status}.`, next.id);
      sendJson(response, 200, next);
      return;
    }

    if (method === "POST" && url.pathname === "/api/agent/spawn") {
      const body = await readJson<unknown>(request);
      if (!isAgentSpawnRequest(body)) {
        throw new RequestBodyError("Invalid spawn payload");
      }

      ensureKnownAgents([body.agentId]);
      const enteringEvent: AgentEvent = {
        agentId: body.agentId,
        status: "entering",
        task: body.task,
        message: body.message,
        location: "door",
        timestamp: Date.now(),
      };
      const entering = applyEvent(enteringEvent);
      pushActivity("agent-spawn", `${entering.name} spawned on task: ${body.task}.`, body.agentId);
      sendJson(response, 200, entering);

      setTimeout(() => {
        applyEvent({
          agentId: body.agentId,
          status: "working",
          task: body.task,
          message: body.message,
          location: "desk",
          timestamp: Date.now(),
        });
      }, 900);
      return;
    }

    if (method === "POST" && url.pathname === "/api/agent/complete") {
      const body = await readJson<unknown>(request);
      if (!isAgentCompleteRequest(body)) {
        throw new RequestBodyError("Invalid complete payload");
      }

      ensureKnownAgents([body.agentId]);
      const next = applyEvent({
        agentId: body.agentId,
        status: "idle",
        task: body.result,
        message: body.message,
        location: "desk",
        timestamp: Date.now(),
      });
      pushActivity("agent-complete", `${next.name} completed work${body.result ? `: ${body.result}` : "."}`, body.agentId);
      sendJson(response, 200, next);
      return;
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/agent/")) {
      const agentId = decodeURIComponent(url.pathname.slice("/api/agent/".length));
      if (!agentId) {
        sendJson(response, 400, { error: "Missing agent id" });
        return;
      }
      if (builtInAgentIds.has(agentId)) {
        sendJson(response, 400, { error: "Built-in agents cannot be deregistered" });
        return;
      }

      const existed = agentStates.delete(agentId);
      if (!existed) {
        sendJson(response, 404, { error: "Agent not found" });
        return;
      }

      broadcast({ type: "agent-removed", agentId });
      pushActivity("agent-status", `Removed external agent ${agentId}.`, agentId);
      broadcastSnapshot();
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/run") {
      const body = await readJson<unknown>(request);
      if (!isMeetingRunRequest(body)) {
        throw new RequestBodyError("Invalid meeting run payload");
      }
      ensureKnownAgents(body.script.config.participants);
      if (!body.script.config.participants.includes(body.script.config.facilitatorId)) {
        throw new RequestBodyError("Facilitator must be a participant");
      }
      if (body.script.config.presenter && !body.script.config.participants.includes(body.script.config.presenter)) {
        throw new RequestBodyError("Presenter must be a participant");
      }

      const state = await meetingEngine.run(body);
      sendJson(response, 200, state);
      return;
    }

    if (method === "GET" && url.pathname === "/api/meeting/status") {
      sendJson(response, 200, meetingEngine.getState());
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/stop") {
      const state = await meetingEngine.stop();
      sendJson(response, 200, state);
      return;
    }

    if (method === "GET" && url.pathname === "/api/meeting/transcript") {
      sendJson(response, 200, { transcript: meetingEngine.getLastTranscript() });
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/start") {
      const body = await readJson<unknown>(request);
      if (!isMeetingRequest(body)) {
        throw new RequestBodyError("Invalid meeting payload");
      }
      const state = await meetingEngine.run({
        script: buildLegacyMeetingScript(body.agentIds),
        speed: 2,
      });
      sendJson(response, 200, state);
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/end") {
      const state = await meetingEngine.stop();
      sendJson(response, 200, state);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown server error";
    sendJson(response, 500, { error: message });
  }
});

const websocketServer = new WebSocketServer({ server: httpServer });

websocketServer.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "agents-snapshot",
      agents: getOrderedStates(),
    } satisfies ServerMessage),
  );
  socket.send(
    JSON.stringify({
      type: "meeting-status",
      state: meetingEngine.getState(),
    } satisfies ServerMessage),
  );
});

httpServer.listen(PORT, () => {
  console.log(`Realtime server listening on http://localhost:${PORT}`);
});
