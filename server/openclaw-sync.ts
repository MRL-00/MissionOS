import { WebSocket as WsWebSocket } from "ws";
import { createDeterministicAppearance, getKnownDeskIndex } from "../src/agentDefaults";
import type { AgentBackendLink, AgentEvent } from "../src/types";
import { pushActivity } from "./activity";
import {
  agentAppearances,
  agentStates,
  applyEvent,
  cancelTransitionTimer,
  defaultAppearances,
  formatStatusActivity,
  resolveAppearance,
  upsertRegistration,
} from "./agents";
import {
  OPENCLAW_ACTIVITY_WINDOW_MINUTES,
  OPENCLAW_IDLE_GRACE_MS,
  OPENCLAW_POLL_INTERVAL_MS,
  OPENCLAW_TOKEN,
  OPENCLAW_URL,
  type OpenClawAgentState,
  type OpenClawSessionInfo,
  type OpenClawSessionListRow,
} from "./types";
import { generateId } from "./utils";

export const openClawStates = new Map<string, OpenClawAgentState>();

export const OPENCLAW_AGENT_MAP = {
  main: "pickle",
  pickle: "pickle",
  zoe: "zoe",
  ink: "ink",
  harry: "harry",
  kevin: "kevin",
  dan: "dan",
  danny: "danny",
  johnny: "johnny",
  tommy: "tommy",
  randall: "randall",
  jared: "jared",
  charlie: "charlie",
} as const satisfies Record<string, string>;

export let openClawWs: WsWebSocket | null = null;
export let openClawWsConnected = false;
export let openClawWsPending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
export let openClawWsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
export let openClawWsConnectSent = false;

function openClawWsUrl(): string {
  return OPENCLAW_URL.replace(/^http/, "ws");
}

export function resolveOpenClawOfficeAgentId(openClawAgentId: string): string | undefined {
  return OPENCLAW_AGENT_MAP[openClawAgentId as keyof typeof OPENCLAW_AGENT_MAP];
}

export function extractOpenClawAgentId(sessionKey: string, explicitAgentId?: string): string | undefined {
  if (explicitAgentId?.trim()) {
    return explicitAgentId.trim();
  }
  if (sessionKey === "main") {
    return "main";
  }
  return sessionKey.match(/^agent:([^:]+)/)?.[1];
}

export function extractOpenClawMessageText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractOpenClawMessageText(item);
      if (text) {
        return text;
      }
    }
    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return (
    extractOpenClawMessageText(record.text)
    ?? extractOpenClawMessageText(record.content)
    ?? extractOpenClawMessageText(record.parts)
    ?? extractOpenClawMessageText(record.message)
  );
}

export function looksLikeSessionKey(text: string): boolean {
  const t = text.trim();
  return t.startsWith("agent:") || /:(telegram|discord|subagent|cron|direct):/.test(t);
}

export function normalizeToolSessions(result: unknown): OpenClawSessionInfo[] {
  const rows = Array.isArray(result)
    ? result
    : (Array.isArray((result as { sessions?: unknown[] } | null | undefined)?.sessions)
        ? (result as { sessions: unknown[] }).sessions
        : []);

  return rows.flatMap((row): OpenClawSessionInfo[] => {
    if (typeof row !== "object" || row === null) {
      return [];
    }

    const session = row as OpenClawSessionListRow;
    const sessionKey = session.key?.trim();
    if (!sessionKey) {
      return [];
    }

    const lastMessage = Array.isArray(session.messages) ? session.messages.at(-1) : undefined;
    return [{
      sessionKey,
      agentId: extractOpenClawAgentId(sessionKey, session.agentId),
      status: "active",
      label: session.displayName,
      task: extractOpenClawMessageText(lastMessage),
    }];
  });
}

export function openClawWsRequest(method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!openClawWs || !openClawWsConnected) {
      reject(new Error("OpenClaw WS not connected"));
      return;
    }
    const id = generateId();
    const timeout = setTimeout(() => {
      openClawWsPending.delete(id);
      reject(new Error(`OpenClaw WS request timeout: ${method}`));
    }, 15000);
    openClawWsPending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolve(value); },
      reject: (error) => { clearTimeout(timeout); reject(error); },
    });
    openClawWs.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

export function startOpenClawWsConnection(): void {
  if (openClawWs) {
    return;
  }
  const wsUrl = openClawWsUrl();
  openClawWsConnected = false;
  openClawWsConnectSent = false;

  const socket = new WsWebSocket(wsUrl);
  openClawWs = socket;

  socket.on("open", () => {
    setTimeout(() => {
      if (!openClawWsConnectSent && socket.readyState === WsWebSocket.OPEN) {
        sendOpenClawConnect(socket);
      }
    }, 1000);
  });

  socket.on("message", (data) => {
    try {
      const msg = JSON.parse(String(data)) as Record<string, unknown>;
      if (msg.type === "event") {
        const event = msg as { event?: string; payload?: { nonce?: string } };
        if (event.event === "connect.challenge" && event.payload?.nonce) {
          sendOpenClawConnect(socket, event.payload.nonce);
          return;
        }
        return;
      }

      if (msg.type === "res") {
        const res = msg as { id?: string; ok?: boolean; payload?: unknown; error?: { message?: string } };
        const id = res.id as string;
        const pending = openClawWsPending.get(id);
        if (!pending) {
          return;
        }
        openClawWsPending.delete(id);

        if (res.ok) {
          pending.resolve(res.payload);
        } else {
          pending.reject(new Error(res.error?.message ?? "request failed"));
        }
      }
    } catch {
      // Ignore parse errors
    }
  });

  socket.on("close", () => {
    openClawWs = null;
    openClawWsConnected = false;
    openClawWsConnectSent = false;
    for (const [, pending] of openClawWsPending) {
      pending.reject(new Error("OpenClaw WS closed"));
    }
    openClawWsPending.clear();
    if (!openClawWsReconnectTimer) {
      openClawWsReconnectTimer = setTimeout(() => {
        openClawWsReconnectTimer = null;
        startOpenClawWsConnection();
      }, 5000);
    }
  });

  socket.on("error", (err) => {
    console.error("[openclaw-sync] WebSocket error:", err.message);
  });
}

export function sendOpenClawConnect(socket: WsWebSocket, nonce?: string): void {
  if (openClawWsConnectSent) {
    return;
  }
  openClawWsConnectSent = true;

  const id = generateId();
  const connectParams: Record<string, unknown> = {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: "cli",
      version: "1.0.0",
      platform: "node",
      mode: "cli",
      instanceId: generateId(),
    },
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing"],
    caps: [],
    auth: {
      token: OPENCLAW_TOKEN || undefined,
    },
  };
  if (nonce) {
    connectParams.nonce = nonce;
  }

  const timeout = setTimeout(() => {
    openClawWsPending.delete(id);
    console.error("[openclaw-sync] Connect timed out");
    socket.close();
  }, 10000);

  openClawWsPending.set(id, {
    resolve: () => {
      clearTimeout(timeout);
      openClawWsConnected = true;
      console.log("[openclaw-sync] WebSocket connected and authenticated");
    },
    reject: (err) => {
      clearTimeout(timeout);
      console.error("[openclaw-sync] Connect auth failed:", err.message);
      socket.close();
    },
  });

  socket.send(JSON.stringify({ type: "req", id, method: "connect", params: connectParams }));
}

export async function fetchOpenClawSessions(): Promise<OpenClawSessionInfo[]> {
  if (!openClawWsConnected) {
    return [];
  }

  try {
    const result = await openClawWsRequest("sessions.list", {
      activeMinutes: OPENCLAW_ACTIVITY_WINDOW_MINUTES,
      includeGlobal: true,
      includeUnknown: false,
      limit: 200,
    }) as { sessions?: OpenClawSessionListRow[] } | null;

    return normalizeToolSessions(result);
  } catch (error) {
    console.error("[openclaw-sync] sessions.list failed:", (error as Error).message);
    return [];
  }
}

export async function ensureOpenClawAgentRegistered(officeAgentId: string, openClawAgentId: string): Promise<void> {
  const existing = agentStates.get(officeAgentId);
  const fallback = defaultAppearances.get(officeAgentId);
  const existingBackendLink = existing?.backendLink;
  const appearance = agentAppearances.get(officeAgentId)
    ?? (existing ? resolveAppearance(existing).appearance : undefined)
    ?? createDeterministicAppearance(officeAgentId);

  const connectedAt = existingBackendLink?.connectedAt ?? Date.now();
  const backendLink: AgentBackendLink = {
    provider: "openclaw",
    connected: true,
    agentId: openClawAgentId,
    connectedAt,
  };

  if (
    existing &&
    existingBackendLink?.provider === "openclaw" &&
    existingBackendLink.connected &&
    existingBackendLink.agentId === openClawAgentId
  ) {
    return;
  }

  await upsertRegistration({
    id: officeAgentId,
    name: existing?.name ?? fallback?.name ?? officeAgentId,
    role: existing?.role ?? fallback?.role ?? "OpenClaw Agent",
    emoji: existing?.emoji ?? fallback?.emoji ?? "🤖",
    appearance,
    type: existing?.type ?? "resident",
    deskIndex: existing?.deskIndex ?? getKnownDeskIndex(officeAgentId),
    backendLink,
  }, existing ? "update" : "create");
}

export async function applyOpenClawStatus(
  officeAgentId: string,
  openClawAgentId: string,
  status: "idle" | "working",
  task?: string,
): Promise<void> {
  await ensureOpenClawAgentRegistered(officeAgentId, openClawAgentId);

  const now = Date.now();
  const normalizedTask = task?.trim() || undefined;
  const previous = openClawStates.get(officeAgentId);

  if (status === "idle" && previous?.status === "working" && previous.lastSeenWorkingAt) {
    if (now - previous.lastSeenWorkingAt < OPENCLAW_IDLE_GRACE_MS) {
      return;
    }
  }

  if (status === "working") {
    if (previous?.status === status && previous?.task === normalizedTask) {
      openClawStates.set(officeAgentId, { ...previous, lastSeenWorkingAt: now });
      return;
    }
  } else if (previous?.status === status && previous?.task === normalizedTask) {
    return;
  }

  cancelTransitionTimer(officeAgentId);

  const event: AgentEvent = {
    agentId: officeAgentId,
    status,
    location: "desk",
    timestamp: now,
    task: status === "working" ? (normalizedTask ?? "") : "",
  };
  const next = applyEvent(event);
  openClawStates.set(officeAgentId, {
    openClawAgentId,
    status,
    task: normalizedTask,
    lastSeenWorkingAt: status === "working" ? now : undefined,
  });
  pushActivity("agent-status", formatStatusActivity(next, event), officeAgentId);
}

export async function pollOpenClawSessions(): Promise<void> {
  if (!OPENCLAW_URL) {
    return;
  }

  try {
    const sessions = await fetchOpenClawSessions();
    await applyOpenClawSessions(sessions);
  } catch (error) {
    console.error("[openclaw-sync] Poll error:", error);
  }
}

export async function applyOpenClawSessions(sessions: OpenClawSessionInfo[]): Promise<void> {
  const currentlyActive = new Set<string>();

  for (const session of sessions) {
    const openClawAgentId = extractOpenClawAgentId(session.sessionKey, session.agentId);
    if (!openClawAgentId) {
      continue;
    }
    const officeAgentId = resolveOpenClawOfficeAgentId(openClawAgentId);
    if (!officeAgentId) {
      continue;
    }

    currentlyActive.add(officeAgentId);
    const isWorking = session.status === "running" || session.status === "active";
    const rawTask = session.task ?? session.label;
    const task = rawTask && looksLikeSessionKey(rawTask) ? undefined : rawTask;
    await applyOpenClawStatus(officeAgentId, openClawAgentId, isWorking ? "working" : "idle", task);
  }

  for (const [officeAgentId, state] of openClawStates) {
    if (!currentlyActive.has(officeAgentId) && state.status !== "idle") {
      await applyOpenClawStatus(officeAgentId, state.openClawAgentId, "idle");
    }
  }
}

export function startOpenClawSync(): void {
  if (!OPENCLAW_URL) {
    return;
  }

  console.log(`[openclaw-sync] Connecting to ${OPENCLAW_URL} via WebSocket, polling every ${OPENCLAW_POLL_INTERVAL_MS / 1000}s`);
  startOpenClawWsConnection();

  setTimeout(() => {
    void pollOpenClawSessions();
  }, 3000);

  setInterval(() => {
    void pollOpenClawSessions();
  }, OPENCLAW_POLL_INTERVAL_MS);
}
