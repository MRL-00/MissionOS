import defaultAppearancesJson from "../src/config/default-appearances.json";
import { FACILITATOR_ROTATION } from "../src/config/meeting-rules";
import { createDeterministicAppearance, getKnownDeskIndex } from "../src/agentDefaults";
import type {
  Accessory,
  AgentAppearance,
  AgentBackendLink,
  AgentCompleteRequest,
  AgentConfig,
  AgentEvent,
  AgentEventLocation,
  AgentRegistration,
  AgentRuntimeState,
  AgentSnapshotState,
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
import { pushActivity } from "./activity";
import {
  DESK_COUNT,
  RequestBodyError,
  VALID_ACCESSORIES,
  VALID_AGENT_TYPES,
  VALID_BACKEND_PROVIDERS,
  VALID_LOCATIONS,
  VALID_MEETING_TYPES,
  VALID_SPEEDS,
  VALID_STATUSES,
} from "./types";

const defaultAppearanceConfigs = defaultAppearancesJson as AgentConfig[];
export const defaultAppearances = new Map(defaultAppearanceConfigs.map((agent) => [agent.id, agent]));

export const agentStates = new Map<string, AgentRuntimeState>();
export const agentAppearances = new Map<string, AgentAppearance>();
export const residentDeskAssignments = new Map<string, number>();
export const transitionTimers = new Map<string, NodeJS.Timeout>();

let broadcast: ((message: ServerMessage) => void) | null = null;
let broadcastSnapshot: (() => void) | null = null;
let queuePersistAgents: (() => Promise<void>) | null = null;

export function configureAgentRuntime(options: {
  broadcast(message: ServerMessage): void;
  broadcastSnapshot(): void;
  queuePersistAgents(): Promise<void>;
}): void {
  broadcast = options.broadcast;
  broadcastSnapshot = options.broadcastSnapshot;
  queuePersistAgents = options.queuePersistAgents;
}

export function isRealtimeAgentStatus(value: unknown): value is RealtimeAgentStatus {
  return typeof value === "string" && VALID_STATUSES.has(value as RealtimeAgentStatus);
}

export function isAgentEventLocation(value: unknown): value is AgentEventLocation {
  return typeof value === "string" && VALID_LOCATIONS.has(value as AgentEventLocation);
}

export function isAgentAppearance(value: unknown): value is AgentAppearance {
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
      (Array.isArray(appearance.accessories) && appearance.accessories.every((accessory) => VALID_ACCESSORIES.has(accessory as Accessory))))
  );
}

export function isBackendLink(value: unknown): value is AgentBackendLink {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const link = value as Partial<AgentBackendLink>;
  return (
    VALID_BACKEND_PROVIDERS.has(link.provider as AgentBackendLink["provider"]) &&
    typeof link.connected === "boolean" &&
    (link.agentId === undefined || typeof link.agentId === "string") &&
    (link.tokenId === undefined || typeof link.tokenId === "string") &&
    (link.connectedAt === undefined || typeof link.connectedAt === "number")
  );
}

export function isRegistration(value: unknown): value is AgentRegistration {
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
    (registration.appearance === undefined || isAgentAppearance(registration.appearance)) &&
    (registration.backendLink === undefined || isBackendLink(registration.backendLink))
  );
}

export function isAgentEvent(value: unknown): value is AgentEvent {
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

export function isMeetingRequest(value: unknown): value is MeetingRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<MeetingRequest>;
  return Array.isArray(request.agentIds) && request.agentIds.every((agentId) => typeof agentId === "string");
}

export function isAgentSpawnRequest(value: unknown): value is AgentSpawnRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<AgentSpawnRequest>;
  return typeof request.agentId === "string" && typeof request.task === "string";
}

export function isAgentCompleteRequest(value: unknown): value is AgentCompleteRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const request = value as Partial<AgentCompleteRequest>;
  return typeof request.agentId === "string";
}

export function isMeetingConfig(value: unknown): value is MeetingConfig {
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

export function isMeetingTurn(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const turn = value as Partial<MeetingScript["turns"][number]>;
  return typeof turn.agentId === "string" && typeof turn.message === "string" && typeof turn.timestamp === "number";
}

export function isMeetingRunRequest(value: unknown): value is MeetingRunRequest {
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

export function getOrderedStates(): AgentRuntimeState[] {
  return Array.from(agentStates.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function buildSnapshotStates(): AgentSnapshotState[] {
  return getOrderedStates().map((state) => ({
    ...state,
    appearance: agentAppearances.get(state.id) ?? resolveAppearance(state).appearance,
  }));
}

export function formatStatusActivity(state: AgentRuntimeState, event: AgentEvent): string {
  switch (event.status) {
    case "entering":
      return `${state.name} is moving to ${event.location ?? "the office"}.`;
    case "leaving":
      return `${state.name} is leaving the office.`;
    case "working":
      return `${state.name} is working${event.task ? ` on ${event.task}` : ""}.`;
    case "meeting":
      return `${state.name} is in a meeting.`;
    case "idle":
    default:
      return `${state.name} is idle${event.task ? ` after ${event.task}` : ""}.`;
  }
}

export function getAvailableDeskIndex(excludedAgentId?: string): number | undefined {
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

export function resolveAppearance(registration: AgentRegistration): { appearance: AgentAppearance; emoji: string } {
  const fallback = defaultAppearances.get(registration.id);
  return {
    appearance: registration.appearance ?? fallback?.appearance ?? createDeterministicAppearance(registration.id),
    emoji: registration.emoji ?? fallback?.emoji ?? "🙂",
  };
}

export function normalizeBackendLink(
  incoming?: AgentBackendLink,
  existing?: AgentBackendLink,
): AgentBackendLink {
  const base = incoming ?? existing;
  if (!base || base.provider === "unlinked") {
    return {
      provider: "unlinked",
      connected: false,
    };
  }

  return {
    provider: base.provider,
    connected: base.connected,
    agentId: base.agentId,
    tokenId: base.tokenId,
    connectedAt: base.connectedAt ?? (base.connected ? Date.now() : undefined),
  };
}

export function resolveDeskIndex(registration: AgentRegistration, existing?: AgentRuntimeState): number {
  if (typeof registration.deskIndex === "number") {
    return registration.deskIndex;
  }
  if (typeof existing?.deskIndex === "number" && (registration.type ?? existing.type) === existing.type) {
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

  residentDeskAssignments.delete(registration.id);
  const availableDesk = getAvailableDeskIndex(registration.id);
  if (availableDesk === undefined) {
    throw new RequestBodyError("No desks available", 409);
  }
  return availableDesk;
}

export function ensureAgentState(agentId: string): AgentRuntimeState {
  const existing = agentStates.get(agentId);
  if (existing) {
    return existing;
  }

  const fallbackAppearance = resolveAppearance({
    id: agentId,
    name: agentId,
    role: "Temporary Agent",
  });
  const fallback: AgentRuntimeState = {
    id: agentId,
    name: agentId,
    role: "Temporary Agent",
    emoji: fallbackAppearance.emoji,
    backendLink: normalizeBackendLink(),
    connected: true,
    type: "visitor",
    status: "idle",
    location: "desk",
    timestamp: Date.now(),
  };
  agentStates.set(agentId, fallback);
  agentAppearances.set(agentId, fallbackAppearance.appearance);
  return fallback;
}

export function applyEvent(event: AgentEvent): AgentRuntimeState {
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
  broadcast?.({
    type: "agent-event",
    event,
  });
  return next;
}

export function scheduleTransition(agentId: string, callback: () => void | Promise<void>, delayMs: number): void {
  cancelTransitionTimer(agentId);
  const timer = setTimeout(() => {
    transitionTimers.delete(agentId);
    const pending = callback();
    if (pending && typeof pending === "object" && "catch" in pending) {
      void pending.catch((error: unknown) => {
        console.error(`Transition failed for ${agentId}`, error);
      });
    }
  }, delayMs);
  transitionTimers.set(agentId, timer);
}

export function cancelTransitionTimer(agentId: string): void {
  const timer = transitionTimers.get(agentId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  transitionTimers.delete(agentId);
}

export function readStatusEvent(body: unknown, agentIdFromPath?: string): AgentEvent {
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
  if (!isRealtimeAgentStatus(payload.status)) {
    throw new RequestBodyError("Invalid agent event payload");
  }
  if (typeof payload.timestamp !== "number") {
    throw new RequestBodyError("Invalid agent event payload");
  }
  if (payload.task !== undefined && typeof payload.task !== "string") {
    throw new RequestBodyError("Invalid agent event payload");
  }
  if (payload.message !== undefined && typeof payload.message !== "string") {
    throw new RequestBodyError("Invalid agent event payload");
  }
  if (payload.location !== undefined && !isAgentEventLocation(payload.location)) {
    throw new RequestBodyError("Invalid agent event payload");
  }

  const normalized: AgentEvent = {
    agentId,
    status: payload.status,
    timestamp: payload.timestamp,
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

export function ensureKnownAgents(agentIds: string[]): void {
  const unknownAgentId = agentIds.find((agentId) => !agentStates.has(agentId));
  if (unknownAgentId) {
    throw new RequestBodyError(`Unknown agent id: ${unknownAgentId}`);
  }
}

export function chooseFacilitator(participants: string[]): string {
  const rotated = FACILITATOR_ROTATION.find((agentId) => participants.includes(agentId));
  if (!rotated) {
    throw new RequestBodyError("Meeting requires at least one participant");
  }
  return rotated;
}

export function buildLegacyMeetingScript(agentIds: string[]): MeetingScript {
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

export async function upsertRegistration(body: AgentRegistration, mode: "create" | "update"): Promise<AgentRuntimeState> {
  const existing = agentStates.get(body.id);
  if (mode === "create" && existing) {
    throw new RequestBodyError(`Agent ${body.id} already exists`, 409);
  }
  if (mode === "update" && !existing) {
    throw new RequestBodyError("Agent not found", 404);
  }

  const { appearance, emoji } = resolveAppearance(body);
  const type = body.type ?? existing?.type ?? "visitor";
  const backendLink = normalizeBackendLink(body.backendLink, existing?.backendLink);
  const timestamp = Date.now();
  const deskIndex = resolveDeskIndex({ ...body, type }, existing);
  const nextStatus: RealtimeAgentStatus = mode === "create" ? "entering" : (existing?.status ?? "idle");
  const nextLocation: AgentEventLocation = mode === "create" ? "door" : (existing?.location ?? "desk");

  const nextState: AgentRuntimeState = {
    id: body.id,
    name: body.name,
    role: body.role,
    emoji,
    type,
    backendLink,
    connected: true,
    status: nextStatus,
    location: nextLocation,
    timestamp,
    task: existing?.task,
    message: existing?.message,
    deskIndex,
  };

  if (type === "resident") {
    residentDeskAssignments.set(body.id, deskIndex);
  } else {
    residentDeskAssignments.delete(body.id);
  }

  agentStates.set(body.id, nextState);
  agentAppearances.set(body.id, appearance);
  await queuePersistAgents?.();

  const action = mode === "create" ? "Registered" : "Updated";
  pushActivity("registration", `${action} agent ${body.name} at desk ${deskIndex + 1}.`, body.id);
  broadcast?.({
    type: "agent-registered",
    agent: {
      ...nextState,
      appearance,
    },
  });
  broadcastSnapshot?.();

  if (mode === "create") {
    broadcast?.({
      type: "agent-event",
      event: {
        agentId: body.id,
        status: "entering",
        location: "door",
        timestamp,
      },
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
  }

  return nextState;
}
