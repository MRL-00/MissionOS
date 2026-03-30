import type { AgentAppearance, AgentRuntimeState } from "../../types";
import {
  resolveAppearance,
  statusColor,
  type AgentPlacement,
} from "./missionMapModel";
import {
  buildMissionOfficeRuntimeModel,
  resolveMissionOfficeDestination,
  type MissionFacing,
  type MissionOfficeAnchor,
  type MissionOfficeDestination,
  type MissionOfficeRuntimeModel,
} from "./missionOfficeRuntimeModel";
import type { MissionTileMap } from "./missionTileMap";

type PhaserModule = typeof import("phaser");
type PhaserScene = import("phaser").Scene;
type PhaserContainer = import("phaser").GameObjects.Container;
type PhaserImage = import("phaser").GameObjects.Image;
type PhaserArc = import("phaser").GameObjects.Arc;
type PhaserEllipse = import("phaser").GameObjects.Ellipse;

type RuntimeState = {
  agents: AgentPlacement[];
  selectedAgentId: string | null;
};

interface MissionPhaserRuntimeOptions {
  map: MissionTileMap;
  onSelectAgent(agentId: string): void;
  parent: HTMLElement;
}

export interface MissionPhaserRuntime {
  destroy(): void;
  setState(state: RuntimeState): void;
}

interface AgentSpriteRuntime {
  agent: AgentRuntimeState;
  appearance: AgentAppearance;
  activityCooldown: number;
  body: PhaserImage;
  container: PhaserContainer;
  destination: MissionOfficeDestination | null;
  destinationKey: string;
  facing: MissionFacing;
  marker: PhaserEllipse;
  path: Array<{ x: number; y: number }>;
  pulseElapsed: number;
  ring: PhaserEllipse;
  roamStep: number;
  shadow: PhaserEllipse;
  signal: PhaserArc;
  walkElapsed: number;
}

const CHARACTER_SPRITES = "/assets/modern-office/characters/RPGMAKERMV/Characters_MV.png";
const CHARACTER_SHEET_COLUMNS = 4;
const CHARACTER_SHEET_ROWS = 2;
const CHARACTER_CELL_WIDTH = 144;
const CHARACTER_CELL_HEIGHT = 192;
const CHARACTER_FRAME_WIDTH = 48;
const CHARACTER_FRAME_HEIGHT = 48;
const AGENT_WALK_FRAMES = 3;
const SPRITE_SCALE = 1.18;
const MOVE_SPEED = 82;
const COLLISION_PADDING = 10;
const POSITION_EPSILON = 2;
const IDLE_PAUSE_MIN_SECONDS = 1.6;
const IDLE_PAUSE_MAX_SECONDS = 3.4;
const DIRECTION_FRAME_ROW: Record<MissionFacing, number> = {
  south: 0,
  west: 1,
  east: 2,
  north: 3,
};

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function characterIndexForAgent(agent: Pick<AgentRuntimeState, "id" | "role">): number {
  return hashString(`${agent.id}:${agent.role}`) % (CHARACTER_SHEET_COLUMNS * CHARACTER_SHEET_ROWS);
}

function stationaryFrame(agent: AgentRuntimeState, destination: MissionOfficeDestination | null, elapsed: number, facing: MissionFacing): number {
  const row = DIRECTION_FRAME_ROW[facing];

  if (!agent.connected) {
    return row * AGENT_WALK_FRAMES + 1;
  }

  if (agent.status === "meeting") {
    return row * AGENT_WALK_FRAMES + 1;
  }

  if (destination?.pose === "sit" && agent.status === "working") {
    return row * AGENT_WALK_FRAMES + (Math.floor(elapsed * 4) % AGENT_WALK_FRAMES);
  }

  return row * AGENT_WALK_FRAMES + 1;
}

function walkingFrame(facing: MissionFacing, elapsed: number): number {
  const row = DIRECTION_FRAME_ROW[facing];
  return row * AGENT_WALK_FRAMES + (Math.floor(elapsed * 8) % AGENT_WALK_FRAMES);
}

function facingFromDelta(dx: number, dy: number, fallback: MissionFacing): MissionFacing {
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return fallback;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "east" : "west";
  }
  return dy > 0 ? "south" : "north";
}

function frameTextureName(characterIndex: number, row: number, frame: number): string {
  return `char-${characterIndex}-${row}-${frame}`;
}

function cropTexture(scene: PhaserScene, key: string, sourceKey: string, x: number, y: number, width: number, height: number): void {
  if (scene.textures.exists(key)) {
    return;
  }

  const source = scene.textures.get(sourceKey).getSourceImage() as CanvasImageSource;
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) {
    return;
  }

  const context = texture.getContext();
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, x, y, width, height, 0, 0, width, height);
  texture.refresh();
}

function createSheetFrames(scene: PhaserScene, sourceKey: string): void {
  for (let characterIndex = 0; characterIndex < CHARACTER_SHEET_COLUMNS * CHARACTER_SHEET_ROWS; characterIndex += 1) {
    const characterCol = characterIndex % CHARACTER_SHEET_COLUMNS;
    const characterRow = Math.floor(characterIndex / CHARACTER_SHEET_COLUMNS);
    const baseX = characterCol * CHARACTER_CELL_WIDTH;
    const baseY = characterRow * CHARACTER_CELL_HEIGHT;

    for (let row = 0; row < 4; row += 1) {
      for (let frame = 0; frame < AGENT_WALK_FRAMES; frame += 1) {
        cropTexture(
          scene,
          frameTextureName(characterIndex, row, frame),
          sourceKey,
          baseX + frame * CHARACTER_FRAME_WIDTH,
          baseY + row * CHARACTER_FRAME_HEIGHT,
          CHARACTER_FRAME_WIDTH,
          CHARACTER_FRAME_HEIGHT,
        );
      }
    }
  }
}

function nearestNode(runtime: MissionOfficeRuntimeModel, x: number, y: number, candidates?: string[]): string | undefined {
  const candidateSet = candidates ? new Set(candidates) : null;
  let bestId: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  runtime.nodes.forEach((node) => {
    if (candidateSet && !candidateSet.has(node.id)) {
      return;
    }

    const dx = node.x - x;
    const dy = node.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestId = node.id;
      bestDistance = distance;
    }
  });

  return bestId;
}

function cellIndex(map: MissionTileMap, col: number, row: number): number {
  return row * map.cols + col;
}

function pointToCell(map: MissionTileMap, x: number, y: number): { col: number; row: number } {
  return {
    col: Math.max(0, Math.min(map.cols - 1, Math.floor(x / map.tileWidth))),
    row: Math.max(0, Math.min(map.rows - 1, Math.floor(y / map.tileHeight))),
  };
}

function cellCenter(map: MissionTileMap, col: number, row: number): { x: number; y: number } {
  return {
    x: col * map.tileWidth + map.tileWidth / 2,
    y: row * map.tileHeight + map.tileHeight / 2,
  };
}

function isWalkableCell(map: MissionTileMap, col: number, row: number): boolean {
  if (col < 0 || col >= map.cols || row < 0 || row >= map.rows) {
    return false;
  }

  return map.walkableTiles[cellIndex(map, col, row)] ?? false;
}

function nearestWalkableCell(map: MissionTileMap, x: number, y: number): { col: number; row: number } | null {
  const start = pointToCell(map, x, y);
  if (isWalkableCell(map, start.col, start.row)) {
    return start;
  }

  const queue: Array<{ col: number; row: number }> = [start];
  const seen = new Set<number>([cellIndex(map, start.col, start.row)]);
  const directions = [
    { col: 1, row: 0 },
    { col: -1, row: 0 },
    { col: 0, row: 1 },
    { col: 0, row: -1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    for (const direction of directions) {
      const nextCol = current.col + direction.col;
      const nextRow = current.row + direction.row;
      if (nextCol < 0 || nextCol >= map.cols || nextRow < 0 || nextRow >= map.rows) {
        continue;
      }

      const index = cellIndex(map, nextCol, nextRow);
      if (seen.has(index)) {
        continue;
      }
      seen.add(index);

      if (isWalkableCell(map, nextCol, nextRow)) {
        return { col: nextCol, row: nextRow };
      }

      queue.push({ col: nextCol, row: nextRow });
    }
  }

  return null;
}

function compressCellPath(cells: Array<{ col: number; row: number }>): Array<{ col: number; row: number }> {
  if (cells.length <= 2) {
    return cells;
  }

  const compressed: Array<{ col: number; row: number }> = [cells[0]!];

  for (let index = 1; index < cells.length - 1; index += 1) {
    const previous = cells[index - 1]!;
    const current = cells[index]!;
    const next = cells[index + 1]!;
    const sameDirection = (current.col - previous.col === next.col - current.col)
      && (current.row - previous.row === next.row - current.row);

    if (!sameDirection) {
      compressed.push(current);
    }
  }

  compressed.push(cells.at(-1)!);
  return compressed;
}

function pushPoint(path: Array<{ x: number; y: number }>, x: number, y: number): void {
  const last = path.at(-1);
  if (last && Math.abs(last.x - x) <= 0.1 && Math.abs(last.y - y) <= 0.1) {
    return;
  }

  path.push({ x, y });
}

function buildPath(
  map: MissionTileMap,
  startX: number,
  startY: number,
  targetX: number | undefined,
  targetY: number | undefined,
): Array<{ x: number; y: number }> {
  if (typeof targetX !== "number" || typeof targetY !== "number") {
    return [];
  }

  const path: Array<{ x: number; y: number }> = [];
  const startCell = nearestWalkableCell(map, startX, startY);
  const targetCell = nearestWalkableCell(map, targetX, targetY);

  if (!startCell || !targetCell) {
    return [];
  }

  const startIndex = cellIndex(map, startCell.col, startCell.row);
  const targetIndex = cellIndex(map, targetCell.col, targetCell.row);

  if (startIndex === targetIndex) {
    const center = cellCenter(map, targetCell.col, targetCell.row);
    if (Math.hypot(center.x - startX, center.y - startY) > POSITION_EPSILON) {
      pushPoint(path, center.x, center.y);
    }
    return path;
  }

  const directions = [
    { col: 1, row: 0 },
    { col: -1, row: 0 },
    { col: 0, row: 1 },
    { col: 0, row: -1 },
  ];
  const queue: number[] = [startIndex];
  const visited = new Set<number>([startIndex]);
  const cameFrom = new Map<number, number>();
  let found = false;

  while (queue.length > 0) {
    const currentIndex = queue.shift();
    if (currentIndex === undefined) {
      break;
    }

    if (currentIndex === targetIndex) {
      found = true;
      break;
    }

    const currentRow = Math.floor(currentIndex / map.cols);
    const currentCol = currentIndex % map.cols;
    for (const direction of directions) {
      const nextCol = currentCol + direction.col;
      const nextRow = currentRow + direction.row;
      if (!isWalkableCell(map, nextCol, nextRow)) {
        continue;
      }

      const nextIndex = cellIndex(map, nextCol, nextRow);
      if (visited.has(nextIndex)) {
        continue;
      }

      visited.add(nextIndex);
      cameFrom.set(nextIndex, currentIndex);
      queue.push(nextIndex);
    }
  }

  if (!found) {
    return [];
  }

  const cells: Array<{ col: number; row: number }> = [];
  let cursor = targetIndex;
  cells.push({ col: targetCell.col, row: targetCell.row });
  while (cursor !== startIndex) {
    const previous = cameFrom.get(cursor);
    if (previous === undefined) {
      break;
    }

    cursor = previous;
    cells.push({
      col: cursor % map.cols,
      row: Math.floor(cursor / map.cols),
    });
  }

  compressCellPath(cells.reverse()).slice(1).forEach((cell) => {
    const center = cellCenter(map, cell.col, cell.row);
    pushPoint(path, center.x, center.y);
  });

  return path;
}

function shortestNodePath(runtime: MissionOfficeRuntimeModel, startId: string, targetId: string): string[] {
  if (startId === targetId) {
    return [startId];
  }

  const queue: string[] = [startId];
  const visited = new Set<string>([startId]);
  const cameFrom = new Map<string, string>();

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) {
      break;
    }

    if (currentId === targetId) {
      break;
    }

    const current = runtime.nodes.get(currentId);
    if (!current) {
      continue;
    }

    current.links.forEach((nextId) => {
      if (!runtime.nodes.has(nextId) || visited.has(nextId)) {
        return;
      }
      visited.add(nextId);
      cameFrom.set(nextId, currentId);
      queue.push(nextId);
    });
  }

  if (!visited.has(targetId)) {
    return [startId];
  }

  const path = [targetId];
  let cursor = targetId;
  while (cursor !== startId) {
    const previous = cameFrom.get(cursor);
    if (!previous) {
      break;
    }
    path.push(previous);
    cursor = previous;
  }

  return path.reverse();
}

function targetPath(
  map: MissionTileMap,
  runtime: MissionOfficeRuntimeModel,
  startX: number,
  startY: number,
  destination: MissionOfficeDestination,
  seated: boolean,
): Array<{ x: number; y: number }> {
  let approachX = destination.approachX;
  let approachY = destination.approachY;

  if (typeof approachX === "number" && typeof approachY === "number") {
    const approachCell = nearestWalkableCell(map, approachX, approachY);
    if (approachCell) {
      const center = cellCenter(map, approachCell.col, approachCell.row);
      approachX = center.x;
      approachY = center.y;
    }
  }

  const corridorPath: Array<{ x: number; y: number }> = [];
  const startNodeId = nearestNode(runtime, startX, startY);
  const targetNodeId = destination.approachNodeId && runtime.nodes.has(destination.approachNodeId)
    ? destination.approachNodeId
    : (typeof approachX === "number" && typeof approachY === "number"
      ? nearestNode(runtime, approachX, approachY)
      : undefined);

  if (startNodeId && targetNodeId) {
    const nodePath = shortestNodePath(runtime, startNodeId, targetNodeId);
    nodePath.slice(1).forEach((nodeId) => {
      const node = runtime.nodes.get(nodeId);
      if (node) {
        pushPoint(corridorPath, node.x, node.y);
      }
    });
  }

  const path = corridorPath.length > 0
    ? corridorPath
    : buildPath(map, startX, startY, approachX, approachY);

  if (typeof approachX === "number" && typeof approachY === "number") {
    pushPoint(path, approachX, approachY);
  }
  if (seated || destination.kind === "support" || destination.kind === "lead") {
    pushPoint(path, destination.x, destination.y);
  }

  return path;
}

function destinationKey(destination: MissionOfficeDestination, agent: AgentRuntimeState): string {
  return [
    destination.id,
    destination.pose,
    destination.facing,
    destination.approachNodeId ?? "none",
    Math.round(destination.approachX ?? 0),
    Math.round(destination.approachY ?? 0),
    Math.round(destination.x),
    Math.round(destination.y),
    agent.status,
    agent.connected ? "on" : "off",
  ].join(":");
}

function distanceSquared(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return (leftX - rightX) ** 2 + (leftY - rightY) ** 2;
}

function resolveDestinationAnchor(
  runtime: MissionOfficeRuntimeModel,
  destination: MissionOfficeDestination,
  occupiedAnchorIds: Set<string>,
  referenceX: number,
  referenceY: number,
): MissionOfficeDestination {
  if (!destination.anchorIds.length) {
    return destination;
  }

  const anchors = destination.anchorIds
    .map((anchorId) => runtime.anchors.get(anchorId))
    .filter((anchor): anchor is MissionOfficeAnchor => Boolean(anchor));

  if (!anchors.length) {
    return destination;
  }

  const available = anchors.filter((anchor) => !occupiedAnchorIds.has(anchor.id));
  const candidates = available.length > 0 ? available : anchors;
  const selected = [...candidates].sort((left, right) => {
    const leftDistance = distanceSquared(left.x, left.y, referenceX, referenceY);
    const rightDistance = distanceSquared(right.x, right.y, referenceX, referenceY);
    return leftDistance - rightDistance || left.priority - right.priority;
  })[0];

  if (!selected) {
    return destination;
  }

  occupiedAnchorIds.add(selected.id);
  return {
    ...destination,
    x: selected.x,
    y: selected.y,
    approachX: selected.x,
    approachY: selected.y,
    approachNodeId: selected.nodeId ?? destination.approachNodeId,
  };
}

function repelCrowdedSprites(sprites: AgentSpriteRuntime[]): void {
  for (let index = 0; index < sprites.length; index += 1) {
    const left = sprites[index];
    if (!left) {
      continue;
    }

    for (let otherIndex = index + 1; otherIndex < sprites.length; otherIndex += 1) {
      const right = sprites[otherIndex];
      if (!right) {
        continue;
      }

      const dx = right.container.x - left.container.x;
      const dy = right.container.y - left.container.y;
      const distance = Math.hypot(dx, dy);
      if (distance === 0 || distance >= COLLISION_PADDING * 2) {
        continue;
      }

      const overlap = (COLLISION_PADDING * 2 - distance) / 2;
      const offsetX = (dx / distance) * overlap;
      const offsetY = (dy / distance) * overlap;

      if (left.path.length > 0) {
        left.container.x -= offsetX;
        left.container.y -= offsetY;
      }
      if (right.path.length > 0) {
        right.container.x += offsetX;
        right.container.y += offsetY;
      }
    }
  }
}

function applySpriteFrame(sprite: AgentSpriteRuntime, frame: number): void {
  const characterIndex = characterIndexForAgent(sprite.agent);
  sprite.body.setTexture(frameTextureName(characterIndex, Math.floor(frame / AGENT_WALK_FRAMES), frame % AGENT_WALK_FRAMES));
}

function applyAgentPose(sprite: AgentSpriteRuntime): void {
  const seated = sprite.destination?.pose === "sit" && sprite.agent.status === "working" && sprite.path.length === 0;
  const bodyOffsetY = seated ? -14 : -4;
  const bodyScale = seated ? 0.9 : 1;

  sprite.body.setY(bodyOffsetY).setScale(SPRITE_SCALE, SPRITE_SCALE * bodyScale);
  sprite.shadow.setY(seated ? 10 : 6).setSize(seated ? 28 : 34, seated ? 12 : 14);
  sprite.marker.setY(seated ? 8 : 4);
  sprite.ring.setY(seated ? 8 : 4);
  sprite.signal.setY(seated ? -42 : -38);
  sprite.signal.setX(14);
}

function updateAgentMotion(sprite: AgentSpriteRuntime, deltaSeconds: number): void {
  if (sprite.path.length === 0) {
    return;
  }

  const target = sprite.path[0];
  if (!target) {
    return;
  }
  const dx = target.x - sprite.container.x;
  const dy = target.y - sprite.container.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance <= Math.max(POSITION_EPSILON, MOVE_SPEED * deltaSeconds)) {
    sprite.container.setPosition(target.x, target.y);
    sprite.path.shift();
    if (sprite.path.length === 0) {
      return;
    }
  } else {
    const step = (MOVE_SPEED * deltaSeconds) / distance;
    sprite.container.setPosition(sprite.container.x + dx * step, sprite.container.y + dy * step);
  }

  sprite.facing = facingFromDelta(dx, dy, sprite.facing);
}

function pauseDurationSeconds(agentId: string, roamStep: number): number {
  const span = IDLE_PAUSE_MAX_SECONDS - IDLE_PAUSE_MIN_SECONDS;
  const normalized = (hashString(`${agentId}:${roamStep}:pause`) % 1000) / 1000;
  return IDLE_PAUSE_MIN_SECONDS + normalized * span;
}

function roamNodeIdsForDestination(destination: MissionOfficeDestination): string[] {
  switch (destination.kind) {
    case "support":
    case "special":
      return ["support", "upper-right", "lower-right"];
    case "lead":
      return ["exec-center", "exec-door", "lower-right"];
    case "meeting":
      return ["meeting-center", "meeting-door"];
    case "entry":
      return ["entry", "upper-left"];
    case "desk":
    case "work":
      return destination.zone === "Bullpen Floor"
        ? ["upper-left", "upper-center", "upper-right", "lower-left", "lower-center", "lower-right"]
        : ["upper-center", "lower-center"];
    default:
      return ["upper-center", "lower-center"];
  }
}

function spawnNodeIdForAgent(runtime: MissionOfficeRuntimeModel, agent: AgentRuntimeState, destination: MissionOfficeDestination): string {
  const preferred = agent.status === "working"
    ? ["entry", "meeting-door", "lower-left", "upper-right"]
    : agent.status === "meeting"
      ? ["entry", "upper-left", "upper-right", "lower-center"]
      : roamNodeIdsForDestination(destination);
  const candidates = preferred.filter((id) => runtime.nodes.has(id) && id !== destination.approachNodeId);
  const fallback = destination.approachNodeId && runtime.nodes.has(destination.approachNodeId)
    ? destination.approachNodeId
    : "entry";

  if (!candidates.length) {
    return fallback;
  }

  return candidates[hashString(`${agent.id}:${agent.role}:${agent.status}`) % candidates.length] ?? fallback;
}

function queueRoamPath(map: MissionTileMap, runtime: MissionOfficeRuntimeModel, sprite: AgentSpriteRuntime): void {
  const destination = sprite.destination;
  if (!destination) {
    return;
  }

  const currentNodeId = nearestNode(runtime, sprite.container.x, sprite.container.y);
  const candidates = roamNodeIdsForDestination(destination).filter((id) => runtime.nodes.has(id));
  const filtered = candidates.filter((id) => id !== currentNodeId);
  const pickFrom = filtered.length ? filtered : candidates;

  if (!pickFrom.length) {
    sprite.activityCooldown = pauseDurationSeconds(sprite.agent.id, sprite.roamStep);
    sprite.roamStep += 1;
    return;
  }

  const startIndex = hashString(`${sprite.agent.id}:${sprite.roamStep}`) % pickFrom.length;
  for (let offset = 0; offset < pickFrom.length; offset += 1) {
    const nodeId = pickFrom[(startIndex + offset) % pickFrom.length];
    if (!nodeId) {
      continue;
    }

    const node = runtime.nodes.get(nodeId);
    if (!node) {
      continue;
    }

    const candidatePath = buildPath(map, sprite.container.x, sprite.container.y, node.x, node.y);
    if (candidatePath.length > 0) {
      sprite.path = candidatePath;
      break;
    }
  }

  sprite.activityCooldown = pauseDurationSeconds(sprite.agent.id, sprite.roamStep);
  sprite.roamStep += 1;
}

export async function createMissionPhaserRuntime(options: MissionPhaserRuntimeOptions): Promise<MissionPhaserRuntime> {
  const Phaser = (await import("phaser")) as PhaserModule;
  const runtimeModelCandidate = buildMissionOfficeRuntimeModel(options.map);
  if (!runtimeModelCandidate) {
    throw new Error("Office runtime could not resolve a background floorplan.");
  }
  const resolvedRuntimeModel: MissionOfficeRuntimeModel = runtimeModelCandidate;

  let sceneRef: OfficeScene | null = null;
  let pendingState: RuntimeState = { agents: [], selectedAgentId: null };

  class OfficeScene extends Phaser.Scene {
    private readonly runtimeModel = resolvedRuntimeModel;
    private readonly sprites = new Map<string, AgentSpriteRuntime>();
    private latestState: RuntimeState = pendingState;

    constructor() {
      super("mission-office");
      sceneRef = this;
    }

    preload(): void {
      const load = this.load;
      if (!load) {
        return;
      }

      options.map.props.forEach((prop) => {
        const key = `prop-${prop.id}`;
        if (!this.textures.exists(key)) {
          load.image(key, prop.asset.source);
        }
      });
      load.image("body-sheet", CHARACTER_SPRITES);
    }

    create(): void {
      const cameras = this.cameras;
      const add = this.add;
      if (!cameras || !add) {
        return;
      }

      cameras.main.setRoundPixels(true);

      const map = options.map;
      const zones = map.zones;
      const T = map.tileWidth;

      // Derive office bounds from walkable area
      let oLeft = map.pixelWidth;
      let oTop = map.pixelHeight;
      let oRight = 0;
      let oBottom = 0;
      for (let row = 0; row < map.rows; row += 1) {
        for (let col = 0; col < map.cols; col += 1) {
          if (map.walkableTiles[row * map.cols + col]) {
            oLeft = Math.min(oLeft, col * T);
            oTop = Math.min(oTop, row * T);
            oRight = Math.max(oRight, (col + 1) * T);
            oBottom = Math.max(oBottom, (row + 1) * T);
          }
        }
      }
      // Expand by 1 tile for the perimeter wall
      oLeft -= T;
      oTop -= T;
      oRight += T;
      oBottom += T;

      // Zone floor colors
      const ZONE_FLOOR: Record<string, number> = {
        work: 0xebe7e1,
        meeting: 0xe4ddd0,
        lead: 0xdedad4,
        support: 0xe0e8e4,
        entry: 0xdce0e8,
      };
      const CORRIDOR_COLOR = 0xedeae6;
      const WALL_COLOR = 0x3d3548;

      // Dark surround
      add.rectangle(0, 0, this.runtimeModel.width, this.runtimeModel.height, 0x1a1d24).setOrigin(0, 0).setDepth(-40);

      // Render every cell inside the office bounds
      for (let row = Math.floor(oTop / T); row < Math.ceil(oBottom / T); row += 1) {
        for (let col = Math.floor(oLeft / T); col < Math.ceil(oRight / T); col += 1) {
          const x = col * T;
          const y = row * T;
          const cx = x + T / 2;
          const cy = y + T / 2;
          const walkable = isWalkableCell(map, col, row);
          const zone = zones.find((z) => cx >= z.x && cx < z.x + z.width && cy >= z.y && cy < z.y + z.height);

          if (zone) {
            // Inside a zone: always floor (furniture props render on top)
            const color = ZONE_FLOOR[zone.kind] ?? CORRIDOR_COLOR;
            add.rectangle(x, y, T, T, color).setOrigin(0, 0).setDepth(-20);
          } else if (walkable) {
            // Corridor / hallway between zones
            add.rectangle(x, y, T, T, CORRIDOR_COLOR).setOrigin(0, 0).setDepth(-20);
          } else {
            // Structural wall or perimeter
            add.rectangle(x, y, T, T, WALL_COLOR).setOrigin(0, 0).setDepth(-15);
          }
        }
      }

      // Thin accent border around the full office
      const g = this.add.graphics();
      g.lineStyle(1, 0x2a2434);
      g.strokeRect(oLeft + T, oTop + T, oRight - oLeft - 2 * T, oBottom - oTop - 2 * T);
      g.setDepth(-12);

      // Subtle zone separator lines
      g.lineStyle(1, 0xc8c0b8);
      zones.forEach((zone) => {
        g.strokeRect(zone.x, zone.y, zone.width, zone.height);
      });

      // Render furniture props from map (48×48 singles placed in the tmj)
      [...options.map.props]
        .sort((left, right) => left.zIndex - right.zIndex)
        .forEach((prop) => {
          add.image(prop.x, prop.y, `prop-${prop.id}`)
            .setOrigin(0, 1)
            .setDisplaySize(prop.width, prop.height)
            .setDepth(prop.zIndex);
        });

      createSheetFrames(this, "body-sheet");
      this.applyState(this.latestState);
    }

    applyState(state: RuntimeState): void {
      this.latestState = state;
      const activeIds = new Set(state.agents.map((placement) => placement.agent.id));

      Array.from(this.sprites.keys()).forEach((agentId) => {
        if (!activeIds.has(agentId)) {
          const existing = this.sprites.get(agentId);
          existing?.container.destroy();
          this.sprites.delete(agentId);
        }
      });

      const occupiedAnchorIds = new Set<string>();

      state.agents.forEach((placement) => {
        const appearance = resolveAppearance(placement.agent);
        const baseDestination = resolveMissionOfficeDestination(this.runtimeModel, placement.point, placement.agent.status === "working");
        const existing = this.sprites.get(placement.agent.id);
        const resolvedDestination = resolveDestinationAnchor(
          this.runtimeModel,
          baseDestination,
          occupiedAnchorIds,
          existing?.container.x ?? baseDestination.x,
          existing?.container.y ?? baseDestination.y,
        );
        const nextKey = destinationKey(resolvedDestination, placement.agent);
        const sprite = existing ?? this.createAgentSprite(placement.agent, appearance, resolvedDestination);
        const accentColor = Number.parseInt(statusColor(placement.agent).slice(1), 16);

        sprite.agent = placement.agent;
        sprite.appearance = appearance;
        sprite.destination = resolvedDestination;
        sprite.signal.setFillStyle(accentColor, 1);
        sprite.marker.setFillStyle(accentColor, 0.22);
        sprite.ring.setVisible(state.selectedAgentId === placement.agent.id);

        if (sprite.destinationKey !== nextKey) {
          sprite.destinationKey = nextKey;
          sprite.path = targetPath(
            options.map,
            this.runtimeModel,
            sprite.container.x,
            sprite.container.y,
            resolvedDestination,
            placement.agent.status === "working" && resolvedDestination.pose === "sit",
          );
          sprite.activityCooldown = pauseDurationSeconds(sprite.agent.id, sprite.roamStep);
        }

        this.sprites.set(placement.agent.id, sprite);
        applyAgentPose(sprite);
      });
    }

    update(_time: number, delta: number): void {
      const deltaSeconds = delta / 1000;
      const spriteList = Array.from(this.sprites.values());

      spriteList.forEach((sprite) => {
        sprite.walkElapsed += deltaSeconds;
        sprite.pulseElapsed += deltaSeconds;
        sprite.activityCooldown = Math.max(0, sprite.activityCooldown - deltaSeconds);

        updateAgentMotion(sprite, deltaSeconds);
        if (sprite.path.length === 0 && sprite.agent.connected && sprite.agent.status === "idle" && sprite.activityCooldown <= 0) {
          queueRoamPath(options.map, this.runtimeModel, sprite);
        }
      });

      repelCrowdedSprites(spriteList);

      spriteList.forEach((sprite) => {
        applyAgentPose(sprite);

        const walking = sprite.path.length > 0;
        const frame = walking
          ? walkingFrame(sprite.facing, sprite.walkElapsed)
          : stationaryFrame(sprite.agent, sprite.destination, sprite.pulseElapsed, sprite.facing);

        applySpriteFrame(sprite, frame);

        sprite.container.setDepth(sprite.container.y);
        sprite.signal.setVisible(sprite.agent.connected);
      });
    }

    private createAgentSprite(agent: AgentRuntimeState, appearance: AgentAppearance, destination: MissionOfficeDestination): AgentSpriteRuntime {
      const marker = this.add.ellipse(0, 4, 26, 10, Number.parseInt(statusColor(agent).slice(1), 16), 0.22);
      const ring = this.add.ellipse(0, 4, 34, 14)
        .setStrokeStyle(2, 0x7ef3b1, 1)
        .setFillStyle(0x7ef3b1, 0.14)
        .setVisible(false);
      const shadow = this.add.ellipse(0, 6, 34, 14, 0x000000, 0.22);
      const body = this.add.image(0, -4, frameTextureName(characterIndexForAgent(agent), 0, 1)).setOrigin(0.5, 1).setScale(SPRITE_SCALE);
      const signal = this.add.circle(14, -38, 5, Number.parseInt(statusColor(agent).slice(1), 16), 1);
      signal.setStrokeStyle(2, 0x172113, 1);
      const spawnNodeId = spawnNodeIdForAgent(this.runtimeModel, agent, destination);
      const spawnNode = this.runtimeModel.nodes.get(spawnNodeId);
      const spawnX = spawnNode?.x ?? destination.approachX ?? destination.x;
      const spawnY = spawnNode?.y ?? destination.approachY ?? destination.y;

      const parts = [marker, ring, shadow, body, signal];
      const container = this.add.container(spawnX, spawnY, parts);
      container.setSize(60, 82);
      container.setInteractive(
        new Phaser.Geom.Rectangle(-30, -66, 60, 82),
        Phaser.Geom.Rectangle.Contains,
      );
      container.on("pointerdown", () => options.onSelectAgent(agent.id));

      const sprite: AgentSpriteRuntime = {
        agent,
        appearance,
        activityCooldown: pauseDurationSeconds(agent.id, 0),
        body,
        container,
        destination,
        destinationKey: destinationKey(destination, agent),
        facing: destination.facing,
        marker,
        path: [],
        pulseElapsed: 0,
        ring,
        roamStep: 1,
        shadow,
        signal,
        walkElapsed: 0,
      };

      sprite.path = targetPath(
        options.map,
        this.runtimeModel,
        spawnX,
        spawnY,
        destination,
        agent.status === "working" && destination.pose === "sit",
      );
      applySpriteFrame(sprite, stationaryFrame(agent, destination, 0, destination.facing));
      applyAgentPose(sprite);
      return sprite;
    }
  }

  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent: options.parent,
    width: options.map.pixelWidth,
    height: options.map.pixelHeight,
    pixelArt: true,
    transparent: true,
    fps: {
      target: 60,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: options.map.pixelWidth,
      height: options.map.pixelHeight,
    },
    scene: OfficeScene,
  });

  return {
    setState(state: RuntimeState) {
      pendingState = state;
      sceneRef?.applyState(state);
    },
    destroy() {
      game.destroy(true);
    },
  };
}
