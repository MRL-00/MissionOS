import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import defaultAppearancesJson from "../src/config/default-appearances.json";
import { createDeterministicAppearance, getKnownDeskIndex } from "../src/agentDefaults";
import { FACILITATOR_ROTATION } from "../src/config/meeting-rules";
import type {
  ActivityLogEntry,
  AgentAppearance,
  AgentCompleteRequest,
  AgentConfig,
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

const agentStates = new Map<string, AgentRuntimeState>();
const activityLog: ActivityLogEntry[] = [];
const transitionTimers = new Map<string, NodeJS.Timeout>();
const residentDeskAssignments = new Map<string, number>();
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOG_ENTRIES = 60;
const DESK_COUNT = 10;
const VALID_STATUSES = new Set<RealtimeAgentStatus>(["idle", "working", "meeting", "entering", "leaving"]);
const VALID_LOCATIONS = new Set<AgentEventLocation>(["desk", "meeting-room", "door", "cio-office"]);
const VALID_MEETING_TYPES = new Set<MeetingType>(["standup", "strategy", "review"]);
const VALID_SPEEDS = new Set<MeetingSpeed>([1, 2, 3]);
const VALID_AGENT_TYPES = new Set<NonNullable<AgentRegistration["type"]>>(["resident", "visitor"]);
const defaultAppearanceConfigs = defaultAppearancesJson as AgentConfig[];
const defaultAppearances = new Map(defaultAppearanceConfigs.map((agent) => [agent.id, agent]));

class RequestBodyError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.statusCode = statusCode;
  }
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
    typeof registration.role === "string" &&
    (registration.emoji === undefined || typeof registration.emoji === "string") &&
    (registration.type === undefined || VALID_AGENT_TYPES.has(registration.type)) &&
    (registration.appearance === undefined || isAgentAppearance(registration.appearance))
  );
}

function isAgentAppearance(value: unknown): value is AgentAppearance {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const appearance = value as Partial<AgentAppearance>;
  return (
    (appearance.height === undefined || typeof appearance.height === "number") &&
    (appearance.headShape === "round" || appearance.headShape === "oval" || appearance.headShape === "square") &&
    typeof appearance.skinColor === "string" &&
    (appearance.hairStyle === "none" ||
      appearance.hairStyle === "short" ||
      appearance.hairStyle === "long" ||
      appearance.hairStyle === "mohawk" ||
      appearance.hairStyle === "messy" ||
      appearance.hairStyle === "slicked" ||
      appearance.hairStyle === "buzz" ||
      appearance.hairStyle === "curly") &&
    typeof appearance.hairColor === "string" &&
    typeof appearance.bodyColor === "string" &&
    typeof appearance.pantsColor === "string" &&
    (appearance.accessories === undefined ||
      (Array.isArray(appearance.accessories) &&
        appearance.accessories.every((accessory) =>
          ["glasses", "hat", "tie", "beard"].includes(accessory),
        )))
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
    type: "visitor",
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

function getAvailableDeskIndex(excludedAgentId?: string): number | undefined {
  const occupied = new Set<number>();

  agentStates.forEach((state) => {
    if (state.id !== excludedAgentId && typeof state.deskIndex === "number") {
      occupied.add(state.deskIndex);
    }
  });

  for (let deskIndex = 0; deskIndex < DESK_COUNT; deskIndex += 1) {
    if (!occupied.has(deskIndex)) {
      return deskIndex;
    }
  }

  return undefined;
}

function resolveDeskIndex(registration: AgentRegistration, existing?: AgentRuntimeState): number {
  if (typeof existing?.deskIndex === "number") {
    return existing.deskIndex;
  }

  const agentType = registration.type ?? existing?.type ?? "visitor";

  if (agentType === "resident") {
    const reservedDesk = residentDeskAssignments.get(registration.id) ?? getKnownDeskIndex(registration.id);
    if (reservedDesk !== undefined) {
      residentDeskAssignments.set(registration.id, reservedDesk);
      const occupyingAgent = Array.from(agentStates.values()).find(
        (state) => state.id !== registration.id && state.deskIndex === reservedDesk,
      );
      if (!occupyingAgent) {
        return reservedDesk;
      }
    }

    const availableDesk = getAvailableDeskIndex(registration.id);
    if (availableDesk === undefined) {
      throw new RequestBodyError("No desks available", 409);
    }
    residentDeskAssignments.set(registration.id, availableDesk);
    return availableDesk;
  }

  const availableDesk = getAvailableDeskIndex(registration.id);
  if (availableDesk === undefined) {
    throw new RequestBodyError("No hot desks available", 409);
  }
  return availableDesk;
}

function resolveAppearance(registration: AgentRegistration): { appearance: AgentAppearance; emoji: string } {
  const fallback = defaultAppearances.get(registration.id);
  return {
    appearance: registration.appearance ?? fallback?.appearance ?? createDeterministicAppearance(registration.id),
    emoji: registration.emoji ?? fallback?.emoji ?? "🙂",
  };
}

function scheduleTransition(agentId: string, callback: () => void, delayMs: number): void {
  cancelTransitionTimer(agentId);
  const timer = setTimeout(() => {
    transitionTimers.delete(agentId);
    callback();
  }, delayMs);
  transitionTimers.set(agentId, timer);
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

let meetingStartActivityEmitted = false;

function cancelTransitionTimer(agentId: string): void {
  const timer = transitionTimers.get(agentId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  transitionTimers.delete(agentId);
}

function readStatusEvent(body: unknown, agentIdFromPath?: string): AgentEvent {
  if (typeof body !== "object" || body === null) {
    throw new RequestBodyError("Invalid agent event payload");
  }

  const payload = body as Partial<AgentEvent>;
  const agentId = agentIdFromPath ?? payload.agentId;

  if (!agentId) {
    throw new RequestBodyError("Missing agent id");
  }
  if (agentIdFromPath && payload.agentId && payload.agentId !== agentIdFromPath) {
    throw new RequestBodyError("Agent id in URL does not match payload");
  }

  const normalized: AgentEvent = {
    agentId,
    status: payload.status as RealtimeAgentStatus,
    timestamp: payload.timestamp as number,
  };

  if (payload.task !== undefined) {
    normalized.task = payload.task;
  }
  if (payload.message !== undefined) {
    normalized.message = payload.message;
  }
  if (payload.location !== undefined) {
    normalized.location = payload.location;
  }

  if (!isAgentEvent(normalized)) {
    throw new RequestBodyError("Invalid agent event payload");
  }

  return normalized;
}

const meetingEngine = new MeetingEngine({
  onBroadcast: broadcast,
  onApplyEvent(event) {
    if (event.status === "meeting" || event.location === "meeting-room") {
      cancelTransitionTimer(event.agentId);
    }
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
      if (!meetingStartActivityEmitted) {
        meetingStartActivityEmitted = true;
        pushActivity("meeting-start", `${state.config.type} meeting started.`, state.config.facilitatorId);
      }
      return;
    }
    if (!state.active && state.summary) {
      meetingStartActivityEmitted = false;
      pushActivity("meeting-end", state.summary, state.config?.facilitatorId);
      return;
    }
    if (!state.active && state.stopped) {
      meetingStartActivityEmitted = false;
      pushActivity("meeting-stop", "Meeting stopped early.");
      return;
    }
    if (!state.active) {
      meetingStartActivityEmitted = false;
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

      const existing = agentStates.get(body.id);
      const { appearance, emoji } = resolveAppearance(body);
      const type = body.type ?? existing?.type ?? "visitor";
      const deskIndex = resolveDeskIndex(body, existing);
      const timestamp = Date.now();
      const enteringState: AgentRuntimeState = {
        id: body.id,
        name: body.name,
        role: body.role,
        emoji,
        type,
        deskIndex,
        connected: true,
        status: "entering",
        location: "door",
        timestamp,
      };

      if (type === "resident") {
        residentDeskAssignments.set(body.id, deskIndex);
      }

      agentStates.set(body.id, enteringState);
      pushActivity("registration", `Registered agent ${body.name} at desk ${deskIndex}.`, body.id);
      broadcast({
        type: "agent-registered",
        agent: {
          ...enteringState,
          appearance,
        },
      });
      broadcast({
        type: "agent-event",
        event: {
          agentId: body.id,
          status: "entering",
          location: "door",
          timestamp,
        },
      });
      broadcastSnapshot();
      sendJson(response, 201, {
        ...enteringState,
        appearance,
      });

      scheduleTransition(body.id, () => {
        if (!agentStates.has(body.id)) {
          return;
        }
        applyEvent({
          agentId: body.id,
          status: "idle",
          location: "desk",
          timestamp: Date.now(),
        });
      }, 900);
      return;
    }

    if (method === "POST" && url.pathname === "/api/agent/status") {
      const body = await readJson<unknown>(request);
      const event = readStatusEvent(body);

      const next = applyEvent(event);
      pushActivity("agent-status", `${next.name} is now ${next.status}.`, next.id);
      sendJson(response, 200, next);
      return;
    }

    const statusPathMatch = method === "POST" ? url.pathname.match(/^\/api\/agent\/([^/]+)\/status$/) : null;
    if (statusPathMatch) {
      const body = await readJson<unknown>(request);
      const event = readStatusEvent(body, decodeURIComponent(statusPathMatch[1] ?? ""));

      const next = applyEvent(event);
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

      scheduleTransition(body.agentId, () => {
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
      const existing = agentStates.get(agentId);
      if (!existing) {
        sendJson(response, 404, { error: "Agent not found" });
        return;
      }

      cancelTransitionTimer(agentId);
      const leavingTimestamp = Date.now();
      agentStates.set(agentId, {
        ...existing,
        status: "leaving",
        location: "door",
        timestamp: leavingTimestamp,
      });
      broadcast({
        type: "agent-event",
        event: {
          agentId,
          status: "leaving",
          location: "door",
          timestamp: leavingTimestamp,
        },
      });
      pushActivity("agent-status", `${existing.name} is leaving the office.`, agentId);
      sendJson(response, 200, { ok: true });

      scheduleTransition(agentId, () => {
        agentStates.delete(agentId);
        broadcast({ type: "agent-removed", agentId });
        pushActivity("agent-status", `Removed agent ${existing.name}.`, agentId);
        broadcastSnapshot();
      }, 350);
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

      void meetingEngine.run(body).catch((error) => {
        console.error("Meeting run failed", error);
      });
      sendJson(response, 200, meetingEngine.getState());
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
      void meetingEngine.run({
        script: buildLegacyMeetingScript(body.agentIds),
        speed: 2,
      }).catch((error) => {
        console.error("Legacy meeting run failed", error);
      });
      sendJson(response, 200, meetingEngine.getState());
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
