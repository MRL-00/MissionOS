import type { MapPoint } from "./missionMapModel";
import type { MissionMapProp, MissionTileMap } from "./missionTileMap";

export type MissionFacing = "south" | "east" | "north" | "west";
export type MissionPose = "stand" | "sit";

export interface MissionOfficeBackground {
  height: number;
  imageHeight: number;
  imageWidth: number;
  source: string;
  width: number;
  x: number;
  y: number;
}

export interface MissionOfficeNode {
  id: string;
  links: string[];
  x: number;
  y: number;
}

export interface MissionOfficeOccluder {
  cropHeight: number;
  cropWidth: number;
  cropX: number;
  cropY: number;
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
}

export interface MissionOfficeDestination {
  approachNodeId: string | undefined;
  approachX: number | undefined;
  approachY: number | undefined;
  facing: MissionFacing;
  id: string;
  kind: string;
  pose: MissionPose;
  x: number;
  y: number;
  zone: string;
}

export interface MissionOfficeRuntimeModel {
  background: MissionOfficeBackground;
  height: number;
  nodes: Map<string, MissionOfficeNode>;
  occluders: MissionOfficeOccluder[];
  width: number;
}

function largestProp(map: MissionTileMap): MissionMapProp | null {
  return map.props.reduce<MissionMapProp | null>((largest, current) => {
    if (!largest) {
      return current;
    }
    return current.width * current.height > largest.width * largest.height ? current : largest;
  }, null);
}

function clampBackground(map: MissionTileMap, prop: MissionMapProp): MissionOfficeBackground {
  return {
    source: prop.asset.source,
    imageWidth: prop.asset.imageWidth,
    imageHeight: prop.asset.imageHeight,
    x: prop.x,
    y: prop.y - prop.height,
    width: prop.width,
    height: prop.height,
  };
}

function makeLocal(background: MissionOfficeBackground, localX: number, localY: number): { x: number; y: number } {
  return {
    x: background.x + localX,
    y: background.y + localY,
  };
}

function makeNode(background: MissionOfficeBackground, id: string, x: number, y: number, links: string[]): MissionOfficeNode {
  const point = makeLocal(background, x, y);
  return {
    id,
    links,
    x: point.x,
    y: point.y,
  };
}

function makeOccluder(
  background: MissionOfficeBackground,
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): MissionOfficeOccluder {
  const point = makeLocal(background, x, y);
  return {
    id,
    x: point.x,
    y: point.y,
    width,
    height,
    cropX: x,
    cropY: y,
    cropWidth: width,
    cropHeight: height,
  };
}

export function buildMissionOfficeRuntimeModel(map: MissionTileMap): MissionOfficeRuntimeModel | null {
  const backgroundProp = largestProp(map);
  if (!backgroundProp) {
    return null;
  }

  const background = clampBackground(map, backgroundProp);
  const nodes = new Map<string, MissionOfficeNode>();
  const nodeList = [
    makeNode(background, "entry", 40, 160, ["upper-left"]),
    makeNode(background, "upper-left", 112, 176, ["entry", "upper-center", "lower-left"]),
    makeNode(background, "upper-center", 240, 208, ["upper-left", "upper-right", "lower-center", "meeting-door"]),
    makeNode(background, "upper-right", 408, 176, ["upper-center", "support"]),
    makeNode(background, "support", 448, 232, ["upper-right", "lower-right"]),
    makeNode(background, "lower-left", 144, 336, ["upper-left", "lower-center", "meeting-door"]),
    makeNode(background, "lower-center", 256, 336, ["upper-center", "lower-left", "lower-right", "meeting-door", "exec-door"]),
    makeNode(background, "lower-right", 400, 336, ["support", "lower-center", "exec-door"]),
    makeNode(background, "meeting-door", 208, 384, ["upper-center", "lower-left", "lower-center", "meeting-center"]),
    makeNode(background, "meeting-center", 176, 432, ["meeting-door"]),
    makeNode(background, "exec-door", 384, 400, ["lower-center", "lower-right", "exec-center"]),
    makeNode(background, "exec-center", 400, 456, ["exec-door"]),
  ];

  nodeList.forEach((node) => nodes.set(node.id, node));

  const occluders = [
    // Only the desk fronts need to occlude agents. Cropping the full furniture banks
    // hides the characters entirely and makes "seated" agents disappear into the scene.
    makeOccluder(background, "desk-upper-left", 88, 171, 80, 36),
    makeOccluder(background, "desk-upper-center", 176, 171, 102, 36),
    makeOccluder(background, "desk-upper-right", 274, 171, 112, 36),
    makeOccluder(background, "desk-lower-left", 76, 334, 104, 36),
    makeOccluder(background, "desk-lower-center-left", 176, 334, 106, 36),
    makeOccluder(background, "desk-lower-center-right", 270, 334, 106, 36),
    makeOccluder(background, "desk-lower-right", 370, 334, 106, 36),
    makeOccluder(background, "desk-exec", 394, 454, 96, 40),
  ];

  return {
    width: map.pixelWidth,
    height: map.pixelHeight,
    background,
    nodes,
    occluders,
  };
}

function nearestNode(runtime: MissionOfficeRuntimeModel, x: number, y: number, candidates: string[]): string | undefined {
  let bestId: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((candidateId) => {
    const node = runtime.nodes.get(candidateId);
    if (!node) {
      return;
    }

    const dx = node.x - x;
    const dy = node.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = candidateId;
    }
  });

  return bestId;
}

function facingForPoint(point: MapPoint): MissionFacing {
  const zone = point.zone.toLowerCase();
  const kind = point.kind?.toLowerCase() ?? "";

  if (kind === "meeting") {
    return "east";
  }
  if (zone.includes("support") || zone.includes("executive")) {
    return "west";
  }
  if (kind === "entry" || zone.includes("entry") || zone.includes("hall")) {
    return "south";
  }
  return "north";
}

export function resolveMissionOfficeDestination(
  runtime: MissionOfficeRuntimeModel,
  point: MapPoint,
  working: boolean,
): MissionOfficeDestination {
  const kind = point.kind?.toLowerCase() ?? "overflow";
  const localX = point.x - runtime.background.x;
  const localY = point.y - runtime.background.y;
  const facing = facingForPoint(point);

  if (kind === "desk" || kind === "work") {
    const upperRow = localY < 270;
    return {
      id: point.slotId ?? `${kind}-${point.x}-${point.y}`,
      kind,
      zone: point.zone,
      x: point.x,
      y: point.y,
      facing,
      pose: working ? "sit" : "stand",
      approachX: point.x,
      approachY: point.y + (upperRow ? 22 : 26),
      approachNodeId: nearestNode(runtime, point.x, point.y, upperRow ? ["upper-left", "upper-center", "upper-right"] : ["lower-left", "lower-center", "lower-right"]),
    };
  }

  if (kind === "lead") {
    return {
      id: point.slotId ?? `${kind}-${point.x}-${point.y}`,
      kind,
      zone: point.zone,
      x: point.x,
      y: point.y,
      facing,
      pose: working ? "sit" : "stand",
      approachX: runtime.background.x + 392,
      approachY: runtime.background.y + 412,
      approachNodeId: "exec-door",
    };
  }

  if (kind === "support" || kind === "special") {
    return {
      id: point.slotId ?? `${kind}-${point.x}-${point.y}`,
      kind,
      zone: point.zone,
      x: point.x,
      y: point.y,
      facing,
      pose: "stand",
      approachX: point.x,
      approachY: point.y,
      approachNodeId: "support",
    };
  }

  if (kind === "meeting") {
    return {
      id: point.slotId ?? `${kind}-${point.x}-${point.y}`,
      kind,
      zone: point.zone,
      x: point.x,
      y: point.y,
      facing,
      pose: "stand",
      approachX: point.x,
      approachY: point.y,
      approachNodeId: nearestNode(runtime, point.x, point.y, ["meeting-center", "meeting-door"]),
    };
  }

  if (kind === "entry") {
    return {
      id: point.slotId ?? `${kind}-${point.x}-${point.y}`,
      kind,
      zone: point.zone,
      x: point.x,
      y: point.y,
      facing,
      pose: "stand",
      approachX: point.x,
      approachY: point.y,
      approachNodeId: "entry",
    };
  }

  return {
    id: point.slotId ?? `${kind}-${point.x}-${point.y}`,
    kind,
    zone: point.zone,
    x: point.x,
    y: point.y,
    facing,
    pose: "stand",
    approachX: point.x,
    approachY: point.y,
    approachNodeId: nearestNode(runtime, point.x, point.y, ["upper-center", "lower-center", "support", "meeting-door", "exec-door"]),
  };
}
