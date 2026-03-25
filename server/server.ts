import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { AgentEvent, AgentRegistration, ServerMessage } from "../src/types";
import { handleClaudeAuth } from "./auth/claude";
import { handleCodexAuth } from "./auth/codex";
import { activityLog, configureActivityBroadcast, pushActivity, pushAgentMessageActivity } from "./activity";
import {
  agentAppearances,
  agentStates,
  applyEvent,
  buildLegacyMeetingScript,
  buildSnapshotStates,
  cancelTransitionTimer,
  configureAgentRuntime,
  ensureKnownAgents,
  formatStatusActivity,
  getOrderedStates,
  isAgentCompleteRequest,
  isAgentSpawnRequest,
  isMeetingRequest,
  isMeetingRunRequest,
  isRegistration,
  readStatusEvent,
  residentDeskAssignments,
  scheduleTransition,
  upsertRegistration,
} from "./agents";
import { MeetingEngine } from "./meeting";
import { normalizeToolSessions, openClawStates, applyOpenClawSessions, startOpenClawSync } from "./openclaw-sync";
import { loadPersistedAgents, queuePersistAgents } from "./persistence";
import { configureRemoteOfficeMirror, startRemoteOfficeMirror } from "./remote-mirror";
import { DEFAULT_HEADERS, PORT, RequestBodyError } from "./types";
import { readJson, sendJson } from "./utils";

try { process.loadEnvFile?.(); } catch { /* .env is optional */ }

let websocketServer: WebSocketServer;
let meetingStartActivityEmitted = false;

function broadcast(message: ServerMessage): void {
  if (!websocketServer) {
    return;
  }

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
    agents: buildSnapshotStates(),
  });
}

configureActivityBroadcast(broadcast);
configureAgentRuntime({
  broadcast,
  broadcastSnapshot,
  queuePersistAgents,
});
configureRemoteOfficeMirror({
  broadcast,
  broadcastSnapshot,
});

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
      pushAgentMessageActivity("agent-message", state, event.message);
      pushActivity("agent-status", formatStatusActivity(state, event), event.agentId);
      return;
    }
    if (event.status === "meeting" && event.message) {
      pushAgentMessageActivity("meeting-turn", state, event.message);
      return;
    }
    if (event.message) {
      pushAgentMessageActivity("agent-message", state, event.message);
      return;
    }
    pushActivity("agent-status", formatStatusActivity(state, event), event.agentId);
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

function handleAgentStatusEvent(event: AgentEvent): AgentEvent {
  const next = applyEvent(event);
  if (event.message) {
    pushAgentMessageActivity(event.status === "meeting" ? "meeting-turn" : "agent-message", next, event.message);
  } else {
    pushActivity("agent-status", formatStatusActivity(next, event), next.id);
  }
  return event;
}

const httpServer = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "OPTIONS") {
    response.writeHead(204, DEFAULT_HEADERS);
    response.end();
    return;
  }

  try {
    if (await handleClaudeAuth(url.pathname, url, response)) {
      return;
    }
    if (await handleCodexAuth(url.pathname, url, response)) {
      return;
    }

    if (method === "GET" && url.pathname === "/api/agents") {
      sendJson(response, 200, { agents: getOrderedStates() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/activity") {
      sendJson(response, 200, { entries: activityLog });
      return;
    }

    if (method === "POST" && (url.pathname === "/api/agents/register" || url.pathname === "/api/agent/register")) {
      const body = await readJson<unknown>(request);
      if (!isRegistration(body)) {
        throw new RequestBodyError("Invalid registration payload");
      }

      const state = await upsertRegistration(body, "create");
      sendJson(response, 201, {
        ...state,
        appearance: agentAppearances.get(state.id),
      });
      return;
    }

    const updateMatch = method === "PUT" || method === "PATCH" ? url.pathname.match(/^\/api\/agents\/([^/]+)$/) : null;
    if (updateMatch) {
      const agentId = decodeURIComponent(updateMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isRegistration(body)) {
        throw new RequestBodyError("Invalid registration payload");
      }
      if (body.id !== agentId) {
        throw new RequestBodyError("Agent id in URL does not match payload");
      }

      const state = await upsertRegistration(body, "update");
      sendJson(response, 200, {
        ...state,
        appearance: agentAppearances.get(state.id),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/agent/status") {
      const body = await readJson<unknown>(request);
      const event = readStatusEvent(body);
      handleAgentStatusEvent(event);
      sendJson(response, 200, agentStates.get(event.agentId));
      return;
    }

    const statusPathMatch = method === "POST" ? url.pathname.match(/^\/api\/agent\/([^/]+)\/status$/) : null;
    if (statusPathMatch) {
      const body = await readJson<unknown>(request);
      const event = readStatusEvent(body, decodeURIComponent(statusPathMatch[1] ?? ""));
      handleAgentStatusEvent(event);
      sendJson(response, 200, agentStates.get(event.agentId));
      return;
    }

    const messagePathMatch = method === "POST" ? url.pathname.match(/^\/api\/agent\/([^/]+)\/message$/) : null;
    if (messagePathMatch) {
      const agentId = decodeURIComponent(messagePathMatch[1] ?? "");
      const state = agentStates.get(agentId);
      if (!state) {
        sendJson(response, 404, { error: "Agent not found" });
        return;
      }
      const body = await readJson<{ message?: string }>(request);
      const message = body?.message?.trim();
      if (!message) {
        throw new RequestBodyError("Missing message");
      }
      const timestamp = Date.now();
      const next = {
        ...state,
        message,
        timestamp,
      };
      agentStates.set(agentId, next);
      broadcast({
        type: "agent-event",
        event: {
          agentId,
          status: next.status,
          task: next.task,
          message,
          location: next.location,
          timestamp,
        },
      });
      const entry = pushAgentMessageActivity("agent-message", state, message);
      sendJson(response, 200, entry);
      return;
    }

    if (method === "POST" && url.pathname === "/api/openclaw/sessions") {
      const body = await readJson<{ sessions?: unknown[] }>(request);
      const sessions = normalizeToolSessions(body);
      await applyOpenClawSessions(sessions);
      sendJson(response, 200, { ok: true, processed: sessions.length });
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
      pushAgentMessageActivity("agent-message", entering, body.message);
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
      pushAgentMessageActivity("agent-message", next, body.message);
      pushActivity("agent-complete", `${next.name} completed work${body.result ? `: ${body.result}` : "."}`, body.agentId);
      sendJson(response, 200, next);
      return;
    }

    const deleteMatch = method === "DELETE" ? url.pathname.match(/^\/api\/agents\/([^/]+)$/) : null;
    const legacyDeleteMatch = method === "DELETE" ? url.pathname.match(/^\/api\/agent\/([^/]+)$/) : null;
    const deleteAgentId = decodeURIComponent(deleteMatch?.[1] ?? legacyDeleteMatch?.[1] ?? "");
    if (method === "DELETE" && deleteAgentId) {
      const existing = agentStates.get(deleteAgentId);
      if (!existing) {
        sendJson(response, 404, { error: "Agent not found" });
        return;
      }

      cancelTransitionTimer(deleteAgentId);
      const leavingTimestamp = Date.now();
      agentStates.set(deleteAgentId, {
        ...existing,
        status: "leaving",
        location: "door",
        timestamp: leavingTimestamp,
      });
      broadcast({
        type: "agent-event",
        event: {
          agentId: deleteAgentId,
          status: "leaving",
          location: "door",
          timestamp: leavingTimestamp,
        },
      });
      pushActivity("agent-status", `${existing.name} is leaving the office.`, deleteAgentId);
      sendJson(response, 200, { ok: true });

      scheduleTransition(deleteAgentId, () => {
        void (async () => {
          agentStates.delete(deleteAgentId);
          residentDeskAssignments.delete(deleteAgentId);
          agentAppearances.delete(deleteAgentId);
          openClawStates.delete(deleteAgentId);
          await queuePersistAgents();
          broadcast({ type: "agent-removed", agentId: deleteAgentId });
          pushActivity("agent-status", `Removed agent ${existing.name}.`, deleteAgentId);
          broadcastSnapshot();
        })().catch((error) => {
          console.error(`Failed to remove agent ${deleteAgentId}`, error);
        });
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

async function ensureCharlie(): Promise<void> {
  if (agentStates.has("charlie")) {
    return;
  }
  await upsertRegistration(
    {
      id: "charlie",
      name: "Charlie",
      role: "Support Agent",
      emoji: "🐟",
      type: "resident",
      appearance: {
        height: 0.85,
        headShape: "round",
        skinColor: "#FF6B35",
        hairStyle: "none",
        hairColor: "#FFFFFF",
        bodyColor: "#FF6B35",
        pantsColor: "#1A1A1A",
        accessories: [],
      },
    },
    "create",
  );
}

export async function start(): Promise<void> {
  await loadPersistedAgents();
  await ensureCharlie();

  websocketServer = new WebSocketServer({ server: httpServer });
  websocketServer.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "agents-snapshot",
        agents: buildSnapshotStates(),
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

  startOpenClawSync();
  startRemoteOfficeMirror();
}

void start();
