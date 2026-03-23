import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import agentsConfig from "../src/config/agents.json";
import type {
  AgentEvent,
  AgentRegistration,
  AgentRuntimeState,
  MeetingRequest,
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

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return null;
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as T;
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Partial<AgentEvent>;
  return (
    typeof event.agentId === "string" &&
    typeof event.status === "string" &&
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
  broadcastSnapshot();
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
        sendJson(response, 400, { error: "Invalid registration payload" });
        return;
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
        sendJson(response, 400, { error: "Invalid agent event payload" });
        return;
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
        sendJson(response, 400, { error: "Invalid meeting payload" });
        return;
      }

      const updated = body.agentIds.map((agentId) =>
        applyEvent(makeMeetingEvent(agentId, "meeting", "Heading to the meeting room.", "Team sync")),
      );
      sendJson(response, 200, { agents: updated });
      return;
    }

    if (method === "POST" && url.pathname === "/api/meeting/end") {
      const meetingAgents = getOrderedStates().filter((agent) => agent.status === "meeting");
      const updated = meetingAgents.map((agent) =>
        applyEvent(makeMeetingEvent(agent.id, "working", "Meeting wrapped. Back to the desk.", "Follow-up work")),
      );
      sendJson(response, 200, { agents: updated });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
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
