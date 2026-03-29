import { createDeterministicAppearance, getDefaultAgentConfig, getKnownDeskIndex } from "../../agentDefaults";
import type { AgentAppearance, AgentRuntimeState } from "../../types";
import { MISSION_MAP_URL, parseMissionMap, type MissionTileMap, type MissionMapSlot } from "./missionTileMap";
import { missionOfficeFallbackData } from "./missionOfficeFallback";

export interface MapPoint {
  kind?: string;
  slotId?: string;
  x: number;
  y: number;
  zone: string;
}

export interface AgentPlacement {
  agent: AgentRuntimeState;
  appearance: AgentAppearance;
  point: MapPoint;
}

const LEAD_ROLE_MATCHER = /(chief|cio|lead|director|manager|head)/i;
const SUPPORT_ROLE_MATCHER = /(advisor|support|ops|operations|analyst)/i;
const DEFAULT_MISSION_MAP = parseMissionMap(missionOfficeFallbackData, MISSION_MAP_URL);

function pointFromSlot(slot: MissionMapSlot): MapPoint {
  return {
    slotId: slot.id,
    kind: slot.kind,
    x: slot.x,
    y: slot.y,
    zone: slot.zone,
  };
}

export function resolveAppearance(agent: AgentRuntimeState): AgentAppearance {
  const withAppearance = agent as AgentRuntimeState & { appearance?: AgentAppearance };
  return withAppearance.appearance
    ?? getDefaultAgentConfig(agent.id)?.appearance
    ?? createDeterministicAppearance(agent.id);
}

export function formatStatus(status: AgentRuntimeState["status"], connected: boolean): string {
  if (!connected) {
    return "offline";
  }

  switch (status) {
    case "meeting":
      return "in meeting";
    case "entering":
      return "arriving";
    case "leaving":
      return "leaving";
    default:
      return status;
  }
}

export function statusColor(agent: AgentRuntimeState): string {
  if (!agent.connected) {
    return "#7d8a9c";
  }

  switch (agent.status) {
    case "working":
      return "#ffcf5c";
    case "meeting":
      return "#72a8ff";
    case "entering":
      return "#78f1c7";
    case "leaving":
      return "#ff8f7b";
    default:
      return "#d7f3b7";
  }
}

function collectSlots(map: MissionTileMap, kinds: string[]): MissionMapSlot[] {
  const normalizedKinds = new Set(kinds.map((kind) => kind.trim().toLowerCase()));
  return map.slots.filter((slot) => normalizedKinds.has(slot.kind.trim().toLowerCase()));
}

function assignPreferredSlots(
  agents: AgentRuntimeState[],
  slots: MissionMapSlot[],
  placements: Map<string, MapPoint>,
  claimedSlots: Set<string>,
) {
  agents.forEach((agent) => {
    const exactSlot = slots.find((slot) => slot.agentId === agent.id && !claimedSlots.has(slot.id));
    if (exactSlot) {
      placements.set(agent.id, pointFromSlot(exactSlot));
      claimedSlots.add(exactSlot.id);
    }
  });
}

function assignLoopSlots(
  agents: AgentRuntimeState[],
  slots: MissionMapSlot[],
  placements: Map<string, MapPoint>,
  claimedSlots: Set<string>,
) {
  const availableSlots = slots.filter((slot) => !claimedSlots.has(slot.id) && !slot.agentId);
  if (!availableSlots.length) {
    return;
  }

  agents.forEach((agent, index) => {
    if (placements.has(agent.id)) {
      return;
    }

    const slot = availableSlots[index % availableSlots.length];
    if (!slot) {
      return;
    }

    claimedSlots.add(slot.id);
    placements.set(agent.id, pointFromSlot(slot));
  });
}

function assignDeskSlots(
  agents: AgentRuntimeState[],
  deskSlots: MissionMapSlot[],
  overflowSlots: MissionMapSlot[],
  placements: Map<string, MapPoint>,
  claimedSlots: Set<string>,
) {
  const preferredSlots = [...deskSlots].filter((slot) => !slot.agentId);
  const claimedDeskIndexes = new Set<number>();

  agents.forEach((agent) => {
    if (placements.has(agent.id)) {
      return;
    }

    const preferredIndex = agent.deskIndex ?? getKnownDeskIndex(agent.id);
    const preferredSlot = typeof preferredIndex === "number" ? preferredSlots[preferredIndex] : undefined;
    if (typeof preferredIndex === "number" && preferredSlot && !claimedSlots.has(preferredSlot.id)) {
      placements.set(agent.id, pointFromSlot(preferredSlot));
      claimedSlots.add(preferredSlot.id);
      claimedDeskIndexes.add(preferredIndex);
    }
  });

  let deskCursor = 0;
  let overflowCursor = 0;

  agents.forEach((agent) => {
    if (placements.has(agent.id)) {
      return;
    }

    while (deskCursor < preferredSlots.length && (claimedDeskIndexes.has(deskCursor) || claimedSlots.has(preferredSlots[deskCursor]?.id ?? ""))) {
      deskCursor += 1;
    }

    const fallbackSlot = preferredSlots[deskCursor] ?? overflowSlots[overflowCursor];
    if (!fallbackSlot || claimedSlots.has(fallbackSlot.id)) {
      return;
    }

    if (deskCursor < preferredSlots.length) {
      claimedDeskIndexes.add(deskCursor);
      deskCursor += 1;
    } else {
      overflowCursor += 1;
    }

    claimedSlots.add(fallbackSlot.id);
    placements.set(agent.id, pointFromSlot(fallbackSlot));
  });
}

function buildFallbackSlots(map: MissionTileMap): MissionMapSlot[] {
  const fallback: MissionMapSlot[] = [];

  for (let row = 0; row < map.rows; row += 1) {
    for (let col = 0; col < map.cols; col += 1) {
      const index = row * map.cols + col;
      if (!map.walkableTiles[index]) {
        continue;
      }

      fallback.push({
        id: `fallback-${row}-${col}`,
        kind: "fallback",
        zone: "Open Ground",
        priority: fallback.length,
        x: col * map.tileWidth + map.tileWidth / 2,
        y: row * map.tileHeight + map.tileHeight / 2,
        agentId: undefined,
      });
    }
  }

  return fallback;
}

export function buildPlacements(agents: AgentRuntimeState[], map: MissionTileMap = DEFAULT_MISSION_MAP): AgentPlacement[] {
  const sortedAgents = [...agents].sort((left, right) => left.name.localeCompare(right.name));
  const placements = new Map<string, MapPoint>();
  const claimedSlots = new Set<string>();

  const meetingSlots = collectSlots(map, ["meeting"]);
  const entrySlots = collectSlots(map, ["entry"]);
  const leadSlots = collectSlots(map, ["lead"]);
  const supportSlots = collectSlots(map, ["support"]);
  const deskSlots = collectSlots(map, ["desk", "work"]);
  const overflowSlots = collectSlots(map, ["overflow", "patrol"]);
  const fallbackSlots = buildFallbackSlots(map);

  assignPreferredSlots(sortedAgents, map.slots, placements, claimedSlots);

  const unassignedAgents = sortedAgents.filter((agent) => !placements.has(agent.id));
  const meetingAgents = unassignedAgents.filter((agent) => agent.location === "meeting-room" || agent.status === "meeting");
  const doorAgents = unassignedAgents.filter((agent) => agent.location === "door" || agent.status === "entering" || agent.status === "leaving");
  const leadAgents = unassignedAgents.filter((agent) => !meetingAgents.some((entry) => entry.id === agent.id)
    && !doorAgents.some((entry) => entry.id === agent.id)
    && (agent.location === "cio-office" || LEAD_ROLE_MATCHER.test(agent.role)));
  const supportAgents = unassignedAgents.filter((agent) => !meetingAgents.some((entry) => entry.id === agent.id)
    && !doorAgents.some((entry) => entry.id === agent.id)
    && !leadAgents.some((entry) => entry.id === agent.id)
    && SUPPORT_ROLE_MATCHER.test(agent.role));
  const deskAgents = unassignedAgents.filter((agent) => !meetingAgents.some((entry) => entry.id === agent.id)
    && !doorAgents.some((entry) => entry.id === agent.id)
    && !leadAgents.some((entry) => entry.id === agent.id)
    && !supportAgents.some((entry) => entry.id === agent.id));

  assignLoopSlots(meetingAgents, meetingSlots, placements, claimedSlots);
  assignLoopSlots(doorAgents, entrySlots, placements, claimedSlots);
  assignLoopSlots(leadAgents, leadSlots, placements, claimedSlots);
  assignLoopSlots(supportAgents, supportSlots, placements, claimedSlots);
  assignDeskSlots(deskAgents, deskSlots, overflowSlots, placements, claimedSlots);
  assignLoopSlots(sortedAgents, fallbackSlots, placements, claimedSlots);

  return sortedAgents.map((agent) => {
    const point = placements.get(agent.id) ?? {
      x: map.tileWidth / 2,
      y: map.tileHeight / 2,
      zone: "Open Ground",
    };

    return {
      agent,
      appearance: resolveAppearance(agent),
      point,
    };
  });
}

export function sortPlacementsForDepth(placements: AgentPlacement[]): AgentPlacement[] {
  return [...placements].sort((left, right) => left.point.y - right.point.y || left.point.x - right.point.x);
}
