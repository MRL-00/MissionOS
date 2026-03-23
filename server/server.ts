import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import agentsConfig from "../src/config/agents.json";
import type {
  AgentEvent,
  AgentEventLocation,
  AgentRegistration,
  AgentRuntimeState,
  MeetingRequest,
  RealtimeAgentStatus,
  ServerMessage,
} from "../src/types";

const PORT = 3001;
const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Content-Type": "application/json",
} as const;

const builtInAgentIds = new Set<string>();
const agentStates = new Map<string, AgentRuntimeState>();
const MAX_BODY_BYTES = 64 * 1024;
const VALID_STATUSES = new Set<RealtimeAgentStatus>(["idle", "working", "meeting", "entering", "leaving"]);
const VALID_LOCATIONS = new Set<AgentEventLocation>(["desk", "meeting-room", "door", "cio-office"]);

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

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw) as T;
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

function makeMeetingEvent(agentId: string, status: AgentEvent["status"], message: string, task: string): AgentEvent {
  return {
    agentId,
    status,
    task,
    message,
    location: status === "meeting" ? "meeting-room" : "desk",
    timestamp: Date.now(),
  };
}

seedBuiltInAgents();

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
        timestamp: Date.now(),
      };
      agentStates.set(body.id, next);
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
      broadcastSnapshot();
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/start") {
      const body = await readJson<unknown>(request);
      if (!isMeetingRequest(body)) {
        throw new RequestBodyError("Invalid meeting payload");
      }
      const unknownAgentId = body.agentIds.find((agentId) => !agentStates.has(agentId));
      if (unknownAgentId) {
        throw new RequestBodyError(`Unknown agent id: ${unknownAgentId}`);
      }

      const updated = body.agentIds.map((agentId) =>
        applyEvent(makeMeetingEvent(agentId, "meeting", "Heading to the meeting room.", "Team sync")),
      );
      broadcastSnapshot();
      sendJson(response, 200, { agents: updated });
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/end") {
      const meetingAgents = getOrderedStates().filter((agent) => agent.status === "meeting");
      const updated = meetingAgents.map((agent) =>
        applyEvent(makeMeetingEvent(agent.id, "working", "Meeting wrapped. Back to the desk.", "Follow-up work")),
      );
      broadcastSnapshot();
      sendJson(response, 200, { agents: updated });
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
});

httpServer.listen(PORT, () => {
  console.log(`Realtime server listening on http://localhost:${PORT}`);
});
