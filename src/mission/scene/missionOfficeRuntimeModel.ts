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

export interface MissionOfficeAnchor {
  id: string;
  nodeId?: string;
  priority: number;
  x: number;
  y: number;
}

export interface MissionOfficeDestination {
  anchorIds: string[];
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
  anchors: Map<string, MissionOfficeAnchor>;
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

function makeAnchor(
  background: MissionOfficeBackground,
  id: string,
  x: number,
  y: number,
  priority: number,
  nodeId?: string,
): MissionOfficeAnchor {
  const point = makeLocal(background, x, y);
  return {
    id,
    x: point.x,
    y: point.y,
    priority,
    ...(nodeId ? { nodeId } : {}),
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
    makeNode(background, "entry", 24, 176, ["upper-left"]),
    makeNode(background, "upper-left", 96, 176, ["entry", "upper-center", "lower-left"]),
    makeNode(background, "upper-center", 192, 176, ["upper-left", "upper-right", "lower-center"]),
    makeNode(background, "upper-right", 304, 176, ["upper-center", "support", "lower-right"]),
    makeNode(background, "support", 352, 176, ["upper-right", "lower-right"]),
    makeNode(background, "lower-left", 128, 272, ["upper-left", "lower-center", "meeting-center"]),
    makeNode(background, "lower-center", 224, 272, ["upper-center", "lower-left", "lower-right", "meeting-center", "exec-center"]),
    makeNode(background, "lower-right", 320, 272, ["upper-right", "support", "lower-center", "exec-center"]),
    makeNode(background, "meeting-center", 160, 320, ["lower-left", "lower-center"]),
    makeNode(background, "exec-center", 336, 320, ["lower-center", "lower-right"]),
  ];

  nodeList.forEach((node) => nodes.set(node.id, node));

  const anchors = new Map<string, MissionOfficeAnchor>();
  const anchorList = [
    makeAnchor(background, "desk-ul-a", 92, 202, 1, "upper-left"),
    makeAnchor(background, "desk-ul-b", 112, 202, 2, "upper-left"),
    makeAnchor(background, "desk-uc-a", 188, 202, 1, "upper-center"),
    makeAnchor(background, "desk-uc-b", 220, 202, 2, "upper-center"),
    makeAnchor(background, "desk-ur-a", 284, 202, 1, "upper-right"),
    makeAnchor(background, "desk-ur-b", 316, 202, 2, "upper-right"),
    makeAnchor(background, "desk-lc-a", 156, 264, 1, "lower-left"),
    makeAnchor(background, "desk-lc-b", 204, 264, 2, "lower-center"),
    makeAnchor(background, "desk-lc-c", 252, 264, 3, "lower-center"),
    makeAnchor(background, "support-a", 368, 192, 1, "support"),
    makeAnchor(background, "support-b", 352, 216, 2, "support"),
    makeAnchor(background, "meeting-a", 144, 328, 1, "meeting-center"),
    makeAnchor(background, "meeting-b", 176, 328, 2, "meeting-center"),
    makeAnchor(background, "meeting-c", 208, 328, 3, "meeting-center"),
    makeAnchor(background, "exec-seat", 332, 328, 1, "exec-center"),
    makeAnchor(background, "exec-side", 364, 328, 2, "exec-center"),
    makeAnchor(background, "entry-a", 28, 176, 1, "entry"),
    makeAnchor(background, "entry-b", 56, 192, 2, "entry"),
    makeAnchor(background, "overflow-a", 248, 176, 1, "upper-center"),
    makeAnchor(background, "overflow-b", 248, 248, 2, "lower-center"),
  ];
  anchorList.forEach((anchor) => anchors.set(anchor.id, anchor));

  const occluders = [
    makeOccluder(background, "desk-upper-left", 68, 156, 84, 28),
    makeOccluder(background, "desk-upper-center", 168, 156, 96, 28),
    makeOccluder(background, "desk-upper-right", 264, 156, 92, 28),
    makeOccluder(background, "desk-lower-center", 140, 234, 132, 26),
    makeOccluder(background, "desk-support", 344, 154, 56, 24),
    makeOccluder(background, "desk-exec", 314, 314, 88, 30)
  ];

  return {
    width: map.pixelWidth,
    height: map.pixelHeight,
    background,
    nodes,
    anchors,
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

function nearestAnchorIds(runtime: MissionOfficeRuntimeModel, x: number, y: number, prefix: string): string[] {
  return Array.from(runtime.anchors.values())
    .filter((anchor) => anchor.id.startsWith(prefix))
    .sort((left, right) => {
      const leftDistance = (left.x - x) ** 2 + (left.y - y) ** 2;
      const rightDistance = (right.x - x) ** 2 + (right.y - y) ** 2;
      return leftDistance - rightDistance || left.priority - right.priority;
    })
    .map((anchor) => anchor.id);
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

function destinationFromAnchorIds(
  runtime: MissionOfficeRuntimeModel,
  point: MapPoint,
  kind: string,
  facing: MissionFacing,
  pose: MissionPose,
  anchorIds: string[],
  fallbackNodeCandidates: string[],
): MissionOfficeDestination {
  const primaryAnchor = anchorIds.map((id) => runtime.anchors.get(id)).find(Boolean);
  return {
    id: point.slotId ?? `${kind}-${point.x}-${point.y}`,
    kind,
    zone: point.zone,
    x: point.x,
    y: point.y,
    facing,
    pose,
    anchorIds,
    approachX: primaryAnchor?.x ?? point.x,
    approachY: primaryAnchor?.y ?? point.y,
    approachNodeId: primaryAnchor?.nodeId ?? nearestNode(runtime, point.x, point.y, fallbackNodeCandidates),
  };
}

export function resolveMissionOfficeDestination(
  runtime: MissionOfficeRuntimeModel,
  point: MapPoint,
  working: boolean,
): MissionOfficeDestination {
  const kind = point.kind?.toLowerCase() ?? "overflow";
  const localY = point.y - runtime.background.y;
  const facing = facingForPoint(point);

  if (kind === "desk" || kind === "work") {
    const upperRow = localY < 270;
    const anchorIds = upperRow
      ? nearestAnchorIds(runtime, point.x, point.y, "desk-u")
      : nearestAnchorIds(runtime, point.x, point.y, "desk-l");
    return destinationFromAnchorIds(
      runtime,
      point,
      kind,
      facing,
      working ? "sit" : "stand",
      anchorIds,
      upperRow ? ["upper-left", "upper-center", "upper-right"] : ["lower-left", "lower-center", "lower-right"],
    );
  }

  if (kind === "lead") {
    return destinationFromAnchorIds(runtime, point, kind, facing, working ? "sit" : "stand", ["exec-seat", "exec-side"], ["exec-door", "exec-center"]);
  }

  if (kind === "support" || kind === "special") {
    return destinationFromAnchorIds(runtime, point, kind, facing, "stand", ["support-a", "support-b"], ["support", "upper-right", "lower-right"]);
  }

  if (kind === "meeting") {
    return destinationFromAnchorIds(runtime, point, kind, facing, "stand", ["meeting-a", "meeting-b", "meeting-c"], ["meeting-center", "meeting-door"]);
  }

  if (kind === "entry") {
    return destinationFromAnchorIds(runtime, point, kind, facing, "stand", ["entry-a", "entry-b"], ["entry", "upper-left"]);
  }

  return destinationFromAnchorIds(runtime, point, kind, facing, "stand", ["overflow-a", "overflow-b"], ["upper-center", "lower-center", "support", "meeting-door", "exec-door"]);
}
