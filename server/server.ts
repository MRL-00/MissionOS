import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
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
import { launchAgentOnRuntimeTarget } from "./runtime-launcher";
import { DEFAULT_HEADERS, PORT, RequestBodyError } from "./types";
import type { MissionProvider } from "../src/mission/types";
import { readJson, sendJson } from "./utils";
import {
  buildWorkflowSnapshot,
  configureWorkflowRuntime,
  createQaTrigger,
  createWorkflowComment,
  createWorkflowEvent,
  createWorkflowHandoff,
  createWorkflowItem,
  isWorkflowCommentCreateRequest,
  isWorkflowEventCreateRequest,
  isWorkflowHandoffCreateRequest,
  isWorkflowHandoffResponseRequest,
  isWorkflowItemCreateRequest,
  isWorkflowItemUpdateRequest,
  isWorkflowQaTriggerRequest,
  listWorkflowComments,
  listWorkflowEvents,
  listWorkflowHandoffs,
  listWorkflowItems,
  listWorkflowQaTriggers,
  loadPersistedWorkflow,
  respondToWorkflowHandoff,
  updateWorkflowItem,
} from "./workflow";
import {
  addMissionTaskComment,
  configureMissionControlRuntime,
  createMissionTaskHandoff,
  getMissionControlSnapshot,
  getMissionTaskDetail,
  isMissionTaskCommentCreateRequest,
  isMissionTaskHandoffCreateRequest,
  isMissionTaskHandoffResponseRequest,
  isMissionTaskUpdateRequest,
  isProviderConnectorUpdateRequest,
  listMissionConnectors,
  listMissionSchedules,
  listMissionTasks,
  listProviderAgents,
  respondMissionTaskHandoff,
  startMissionControl,
  syncMissionConnector,
  testMissionConnector,
  updateMissionConnector,
  updateMissionTask,
} from "./mission-control";

let websocketServer: WebSocketServer;
let meetingStartActivityEmitted = false;

function listeningUrls(port: number): string[] {
  const urls = new Set<string>([`http://localhost:${port}`]);
  const interfaces = networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) {
        continue;
      }

      if (entry.family === "IPv4") {
        urls.add(`http://${entry.address}:${port}`);
        continue;
      }

      const normalized = entry.address.split("%")[0];
      if (normalized) {
        urls.add(`http://[${normalized}]:${port}`);
      }
    }
  }

  return [...urls];
}

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
configureWorkflowRuntime(broadcast);
configureMissionControlRuntime(broadcast);
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

    if (method === "GET" && url.pathname === "/api/mission") {
      sendJson(response, 200, getMissionControlSnapshot());
      return;
    }

    if (method === "GET" && url.pathname === "/api/mission/connectors") {
      sendJson(response, 200, { connectors: listMissionConnectors() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/mission/schedules") {
      sendJson(response, 200, { schedules: listMissionSchedules() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/mission/provider-agents") {
      sendJson(response, 200, { agents: listProviderAgents() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/mission/tasks") {
      sendJson(response, 200, { tasks: listMissionTasks() });
      return;
    }

    const connectorMatch = (method === "PATCH" || method === "PUT" || method === "POST")
      ? url.pathname.match(/^\/api\/mission\/connectors\/([^/]+)$/)
      : null;
    if (connectorMatch && (method === "PATCH" || method === "PUT")) {
      const provider = decodeURIComponent(connectorMatch[1] ?? "") as MissionProvider;
      const body = await readJson<unknown>(request);
      if (!isProviderConnectorUpdateRequest(body)) {
        throw new RequestBodyError("Invalid connector update payload");
      }

      const connector = await updateMissionConnector(provider, body);
      sendJson(response, 200, { connector });
      return;
    }

    const connectorTestMatch = method === "POST" ? url.pathname.match(/^\/api\/mission\/connectors\/([^/]+)\/test$/) : null;
    if (connectorTestMatch) {
      const provider = decodeURIComponent(connectorTestMatch[1] ?? "") as MissionProvider;
      const connector = await testMissionConnector(provider);
      sendJson(response, 200, { connector });
      return;
    }

    const connectorSyncMatch = method === "POST" ? url.pathname.match(/^\/api\/mission\/connectors\/([^/]+)\/sync$/) : null;
    if (connectorSyncMatch) {
      const provider = decodeURIComponent(connectorSyncMatch[1] ?? "") as MissionProvider;
      const connector = await syncMissionConnector(provider);
      sendJson(response, 200, { connector });
      return;
    }

    const missionTaskMatch = (method === "GET" || method === "PATCH" || method === "PUT")
      ? url.pathname.match(/^\/api\/mission\/tasks\/([^/]+)$/)
      : null;
    if (missionTaskMatch && method === "GET") {
      const taskId = decodeURIComponent(missionTaskMatch[1] ?? "");
      sendJson(response, 200, await getMissionTaskDetail(taskId));
      return;
    }
    if (missionTaskMatch && (method === "PATCH" || method === "PUT")) {
      const taskId = decodeURIComponent(missionTaskMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isMissionTaskUpdateRequest(body)) {
        throw new RequestBodyError("Invalid mission task update payload");
      }
      const task = await updateMissionTask(taskId, body);
      sendJson(response, 200, { ok: true, task });
      return;
    }

    const missionTaskCommentMatch = method === "POST" ? url.pathname.match(/^\/api\/mission\/tasks\/([^/]+)\/comments$/) : null;
    if (missionTaskCommentMatch) {
      const taskId = decodeURIComponent(missionTaskCommentMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isMissionTaskCommentCreateRequest(body)) {
        throw new RequestBodyError("Invalid mission comment payload");
      }
      const detail = await addMissionTaskComment(taskId, body);
      sendJson(response, 201, detail);
      return;
    }

    const missionTaskHandoffMatch = method === "POST" ? url.pathname.match(/^\/api\/mission\/tasks\/([^/]+)\/handoffs$/) : null;
    if (missionTaskHandoffMatch) {
      const taskId = decodeURIComponent(missionTaskHandoffMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isMissionTaskHandoffCreateRequest(body)) {
        throw new RequestBodyError("Invalid mission handoff payload");
      }
      const handoff = await createMissionTaskHandoff(taskId, body);
      sendJson(response, 201, { handoff });
      return;
    }

    const missionHandoffResponseMatch = (method === "PATCH" || method === "POST")
      ? url.pathname.match(/^\/api\/mission\/handoffs\/([^/]+)$/)
      : null;
    if (missionHandoffResponseMatch && (method === "PATCH" || method === "POST")) {
      const handoffId = decodeURIComponent(missionHandoffResponseMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isMissionTaskHandoffResponseRequest(body)) {
        throw new RequestBodyError("Invalid mission handoff response payload");
      }
      const handoff = await respondMissionTaskHandoff(handoffId, body);
      sendJson(response, 200, { handoff });
      return;
    }

    if (method === "GET" && url.pathname === "/api/workflow") {
      sendJson(response, 200, buildWorkflowSnapshot());
      return;
    }

    if (method === "GET" && url.pathname === "/api/workflow/items") {
      sendJson(response, 200, {
        currentSprintId: buildWorkflowSnapshot().currentSprintId,
        items: listWorkflowItems(),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/workflow/events") {
      sendJson(response, 200, {
        events: listWorkflowEvents(url.searchParams.get("itemId") ?? undefined),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/workflow/handoffs") {
      sendJson(response, 200, {
        handoffs: listWorkflowHandoffs(url.searchParams.get("itemId") ?? undefined),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/workflow/comments") {
      sendJson(response, 200, {
        comments: listWorkflowComments(url.searchParams.get("itemId") ?? undefined),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/workflow/qa-triggers") {
      sendJson(response, 200, {
        qaTriggers: listWorkflowQaTriggers(url.searchParams.get("itemId") ?? undefined),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/workflow/items") {
      const body = await readJson<unknown>(request);
      if (!isWorkflowItemCreateRequest(body)) {
        throw new RequestBodyError("Invalid workflow item payload");
      }
      const result = await createWorkflowItem(body);
      sendJson(response, 201, result);
      return;
    }

    const workflowItemMatch = (method === "PATCH" || method === "PUT" || method === "POST")
      ? url.pathname.match(/^\/api\/workflow\/items\/([^/]+)$/)
      : null;
    if (workflowItemMatch && (method === "PATCH" || method === "PUT")) {
      const itemId = decodeURIComponent(workflowItemMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isWorkflowItemUpdateRequest(body)) {
        throw new RequestBodyError("Invalid workflow item update payload");
      }
      const result = await updateWorkflowItem(itemId, body);
      sendJson(response, 200, result);
      return;
    }

    const workflowEventMatch = method === "POST" ? url.pathname.match(/^\/api\/workflow\/items\/([^/]+)\/events$/) : null;
    if (workflowEventMatch) {
      const itemId = decodeURIComponent(workflowEventMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isWorkflowEventCreateRequest(body)) {
        throw new RequestBodyError("Invalid workflow event payload");
      }
      const event = await createWorkflowEvent(itemId, body);
      sendJson(response, 201, { event });
      return;
    }

    const workflowHandoffMatch = method === "POST" ? url.pathname.match(/^\/api\/workflow\/items\/([^/]+)\/handoffs$/) : null;
    if (workflowHandoffMatch) {
      const itemId = decodeURIComponent(workflowHandoffMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isWorkflowHandoffCreateRequest(body)) {
        throw new RequestBodyError("Invalid workflow handoff payload");
      }
      const result = await createWorkflowHandoff(itemId, body);
      sendJson(response, 201, result);
      return;
    }

    const workflowHandoffResponseMatch = (method === "PATCH" || method === "POST")
      ? url.pathname.match(/^\/api\/workflow\/handoffs\/([^/]+)$/)
      : null;
    if (workflowHandoffResponseMatch && (method === "PATCH" || method === "POST")) {
      const handoffId = decodeURIComponent(workflowHandoffResponseMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isWorkflowHandoffResponseRequest(body)) {
        throw new RequestBodyError("Invalid workflow handoff response payload");
      }
      const result = await respondToWorkflowHandoff(handoffId, body);
      sendJson(response, 200, result);
      return;
    }

    const workflowCommentMatch = method === "POST" ? url.pathname.match(/^\/api\/workflow\/items\/([^/]+)\/comments$/) : null;
    if (workflowCommentMatch) {
      const itemId = decodeURIComponent(workflowCommentMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isWorkflowCommentCreateRequest(body)) {
        throw new RequestBodyError("Invalid workflow comment payload");
      }
      const result = await createWorkflowComment(itemId, body);
      sendJson(response, 201, result);
      return;
    }

    const workflowQaMatch = method === "POST" ? url.pathname.match(/^\/api\/workflow\/items\/([^/]+)\/qa-triggers$/) : null;
    if (workflowQaMatch) {
      const itemId = decodeURIComponent(workflowQaMatch[1] ?? "");
      const body = await readJson<unknown>(request);
      if (!isWorkflowQaTriggerRequest(body)) {
        throw new RequestBodyError("Invalid workflow QA trigger payload");
      }
      const qaTrigger = await createQaTrigger(itemId, body);
      sendJson(response, 201, { qaTrigger });
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
      const registeredState = agentStates.get(body.agentId);
      if (!registeredState) {
        throw new RequestBodyError(`Unknown agent id: ${body.agentId}`);
      }
      const launch = await launchAgentOnRuntimeTarget(registeredState, body);
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
      if (launch) {
        pushActivity("agent-status", `${entering.name} launch forwarded to ${launch.targetLabel}.`, body.agentId);
      }
      pushAgentMessageActivity("agent-message", entering, body.message);
      sendJson(response, 200, { agent: entering, launch });

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

const CORE_MISSION_TEAM = [
  {
    id: "lead-engineer",
    name: "Lead Engineer",
    role: "Lead Engineer",
    emoji: "🧠",
    appearance: {
      height: 1.08,
      headShape: "square",
      skinColor: "#D7B394",
      hairStyle: "short",
      hairColor: "#3A2A22",
      bodyColor: "#6E56CF",
      pantsColor: "#1E2130",
      accessories: ["tie"],
    },
  },
  {
    id: "ios-dev",
    name: "iOS Dev",
    role: "iOS developer",
    emoji: "📱",
    appearance: {
      height: 0.98,
      headShape: "oval",
      skinColor: "#D9B08A",
      hairStyle: "slicked",
      hairColor: "#151515",
      bodyColor: "#111827",
      pantsColor: "#2D3748",
      accessories: ["glasses"],
    },
  },
  {
    id: "fullstack-dev",
    name: "Full-stack Dev",
    role: "Full-stack Developer",
    emoji: "💻",
    appearance: {
      height: 1.02,
      headShape: "oval",
      skinColor: "#E2BC97",
      hairStyle: "messy",
      hairColor: "#6B4423",
      bodyColor: "#0F766E",
      pantsColor: "#1F2937",
      accessories: [],
    },
  },
  {
    id: "qa",
    name: "QA",
    role: "QA Engineer",
    emoji: "🧪",
    appearance: {
      height: 0.96,
      headShape: "round",
      skinColor: "#D4AA84",
      hairStyle: "buzz",
      hairColor: "#5B3A29",
      bodyColor: "#F8FAFC",
      pantsColor: "#475569",
      accessories: [],
    },
  },
  {
    id: "support",
    name: "Support",
    role: "Support Specialist",
    emoji: "🎧",
    appearance: {
      height: 0.94,
      headShape: "round",
      skinColor: "#CFA27F",
      hairStyle: "curly",
      hairColor: "#2B1D16",
      bodyColor: "#EF4444",
      pantsColor: "#1F2937",
      accessories: ["glasses"],
    },
  },
] satisfies Array<{
  id: string;
  name: string;
  role: string;
  emoji: string;
  appearance: {
    height: number;
    headShape: "round" | "oval" | "square";
    skinColor: string;
    hairStyle: "none" | "short" | "long" | "mohawk" | "messy" | "slicked" | "buzz" | "curly";
    hairColor: string;
    bodyColor: string;
    pantsColor: string;
    accessories: Array<"glasses" | "hat" | "tie" | "beard">;
  };
}>;

async function ensureCoreMissionTeam(): Promise<void> {
  for (const member of CORE_MISSION_TEAM) {
    await upsertRegistration({
      ...member,
      type: "resident",
    }, agentStates.has(member.id) ? "update" : "create");
  }
}

export async function start(): Promise<void> {
  await loadPersistedAgents();
  await loadPersistedWorkflow();
  await ensureCoreMissionTeam();
  await startMissionControl();

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
    socket.send(
      JSON.stringify({
        type: "workflow-snapshot",
        snapshot: buildWorkflowSnapshot(),
      } satisfies ServerMessage),
    );
    socket.send(
      JSON.stringify({
        type: "mission-snapshot",
        snapshot: getMissionControlSnapshot(),
      } satisfies ServerMessage),
    );
  });

  httpServer.listen(PORT, () => {
    console.log(`Realtime server listening on ${listeningUrls(PORT).join(", ")}`);
  });

  startOpenClawSync();
  startRemoteOfficeMirror();
}

void start();
