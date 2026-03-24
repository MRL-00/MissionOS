import { WebSocket as WsWebSocket } from "ws";
import type { AgentRuntimeState, ServerMessage } from "../src/types";
import { agentAppearances, agentStates, applyEvent } from "./agents";
import { queuePersistAgents } from "./persistence";
import { REMOTE_OFFICE_URL } from "./types";

let broadcast: ((message: ServerMessage) => void) | null = null;
let broadcastSnapshot: (() => void) | null = null;

export let remoteOfficeWs: WsWebSocket | null = null;
export let remoteOfficeReconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function configureRemoteOfficeMirror(options: {
  broadcast(message: ServerMessage): void;
  broadcastSnapshot(): void;
}): void {
  broadcast = options.broadcast;
  broadcastSnapshot = options.broadcastSnapshot;
}

export function startRemoteOfficeMirror(): void {
  if (!REMOTE_OFFICE_URL) {
    return;
  }

  const wsUrl = REMOTE_OFFICE_URL.replace(/^http/, "ws");
  console.log(`[remote-mirror] Connecting to ${wsUrl}`);
  connectRemoteOffice(wsUrl);
}

export function connectRemoteOffice(wsUrl: string): void {
  const socket = new WsWebSocket(wsUrl);
  remoteOfficeWs = socket;

  socket.on("open", () => {
    console.log("[remote-mirror] Connected to remote office");
  });

  socket.on("message", (data) => {
    try {
      const msg = JSON.parse(String(data)) as ServerMessage;

      if (msg.type === "agents-snapshot") {
        for (const agent of msg.agents) {
          const existing = agentStates.get(agent.id);
          agentAppearances.set(agent.id, agent.appearance);

          const state: AgentRuntimeState = {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            emoji: agent.emoji,
            type: agent.type,
            backendLink: agent.backendLink,
            connected: agent.connected,
            status: agent.status,
            location: agent.location,
            timestamp: agent.timestamp,
            task: agent.task,
            message: agent.message,
            deskIndex: agent.deskIndex,
          };

          agentStates.set(agent.id, state);

          if (!existing) {
            void queuePersistAgents();
          }
        }
        broadcastSnapshot?.();
      }

      if (msg.type === "agent-event") {
        applyEvent(msg.event);
        broadcast?.(msg);
      }

      if (msg.type === "agent-registered") {
        const { appearance, ...state } = msg.agent;
        if (appearance) {
          agentAppearances.set(state.id, appearance);
        }
        agentStates.set(state.id, state);
        void queuePersistAgents();
        broadcast?.(msg);
      }

      if (msg.type === "agent-removed") {
        agentStates.delete(msg.agentId);
        agentAppearances.delete(msg.agentId);
        void queuePersistAgents();
        broadcast?.(msg);
      }

      if (msg.type === "meeting-start" || msg.type === "meeting-turn" || msg.type === "meeting-end" || msg.type === "meeting-status") {
        broadcast?.(msg);
      }
    } catch {
      // Ignore parse errors
    }
  });

  socket.on("close", () => {
    remoteOfficeWs = null;
    console.log("[remote-mirror] Disconnected from remote office");
    if (!remoteOfficeReconnectTimer) {
      remoteOfficeReconnectTimer = setTimeout(() => {
        remoteOfficeReconnectTimer = null;
        connectRemoteOffice(wsUrl);
      }, 5000);
    }
  });

  socket.on("error", (err) => {
    console.error("[remote-mirror] WebSocket error:", err.message);
  });
}
