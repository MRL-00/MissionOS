import type { AgentAppearance, AgentRuntimeState, HairStyle } from "../../types";
import {
  resolveAppearance,
  statusColor,
  type AgentPlacement,
} from "./missionMapModel";
import {
  buildMissionOfficeRuntimeModel,
  resolveMissionOfficeDestination,
  type MissionFacing,
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
  hair: PhaserImage | null;
  marker: PhaserEllipse;
  outfit: PhaserImage;
  path: Array<{ x: number; y: number }>;
  pulseElapsed: number;
  ring: PhaserEllipse;
  roamStep: number;
  shadow: PhaserImage;
  signal: PhaserArc;
  walkElapsed: number;
}

const METRO_ASSET_BASE = "/assets/metro-city";
const CHARACTER_SPRITES = encodeURI(`${METRO_ASSET_BASE}/CharacterModel/Character Model.png`);
const SHADOW_SPRITE = encodeURI(`${METRO_ASSET_BASE}/CharacterModel/Shadow.png`);
const HAIR_SPRITES = encodeURI(`${METRO_ASSET_BASE}/Hair/Hairs.png`);
const OUTFIT_SPRITES = [
  `${METRO_ASSET_BASE}/Outfits/Outfit1.png`,
  `${METRO_ASSET_BASE}/Outfits/Outfit2.png`,
  `${METRO_ASSET_BASE}/Outfits/Outfit3.png`,
  `${METRO_ASSET_BASE}/Outfits/Outfit4.png`,
  `${METRO_ASSET_BASE}/Outfits/Outfit5.png`,
  `${METRO_ASSET_BASE}/Outfits/Outfit6.png`,
] as const;
const SUIT_SPRITE = `${METRO_ASSET_BASE}/Outfits/Suit.png`;
const FRAME_COLUMNS = 24;
const BASE_ROWS = 6;
const HAIR_ROWS = 8;
const AGENT_WALK_FRAMES = 6;
const FRAME_SIZE = 32;
const SPRITE_SCALE = 1.94;
const MOVE_SPEED = 86;
const POSITION_EPSILON = 2;
const IDLE_PAUSE_MIN_SECONDS = 1.6;
const IDLE_PAUSE_MAX_SECONDS = 3.4;
const HAIR_ROW_BY_STYLE: Record<Exclude<HairStyle, "none">, number> = {
  short: 0,
  long: 1,
  mohawk: 2,
  messy: 3,
  slicked: 4,
  buzz: 5,
  curly: 6,
};
const DIRECTION_FRAME_START: Record<MissionFacing, number> = {
  south: 0,
  east: 6,
  north: 12,
  west: 18,
};
const SUIT_ROLE_MATCHER = /(chief|cio|lead|advisor|director|manager|head)/i;

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function baseRowForAppearance(agentId: string, appearance: AgentAppearance): number {
  return hashString(`${agentId}:${appearance.skinColor}:${appearance.headShape}`) % BASE_ROWS;
}

function hairRowForAppearance(appearance: AgentAppearance): number | null {
  if (appearance.hairStyle === "none") {
    return null;
  }

  return HAIR_ROW_BY_STYLE[appearance.hairStyle];
}

function outfitTextureInfo(agent: Pick<AgentRuntimeState, "id" | "role">): {
  keyPrefix: string;
  row: number;
  rowCount: number;
  source: string;
} {
  const hash = hashString(`${agent.id}:${agent.role}`);
  if (SUIT_ROLE_MATCHER.test(agent.role)) {
    return {
      keyPrefix: "suit",
      source: SUIT_SPRITE,
      row: hash % 4,
      rowCount: 4,
    };
  }

  const outfitIndex = hash % OUTFIT_SPRITES.length;
  return {
    keyPrefix: `outfit-${outfitIndex + 1}`,
    source: OUTFIT_SPRITES[outfitIndex] ?? OUTFIT_SPRITES[0],
    row: 0,
    rowCount: 1,
  };
}

function stationaryFrame(agent: AgentRuntimeState, destination: MissionOfficeDestination | null, elapsed: number, facing: MissionFacing): number {
  const frameStart = DIRECTION_FRAME_START[facing];

  if (!agent.connected) {
    return frameStart;
  }

  if (agent.status === "meeting") {
    return frameStart + 1;
  }

  if (destination?.pose === "sit" && agent.status === "working") {
    return frameStart + 1 + (Math.floor(elapsed * 6) % 2);
  }

  return frameStart;
}

function walkingFrame(facing: MissionFacing, elapsed: number): number {
  const frameStart = DIRECTION_FRAME_START[facing];
  return frameStart + (Math.floor(elapsed * 12) % AGENT_WALK_FRAMES);
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

function frameTextureName(prefix: string, row: number, frame: number): string {
  return `${prefix}-${row}-${frame}`;
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

function createSheetFrames(scene: PhaserScene, sourceKey: string, prefix: string, rows: number): void {
  for (let row = 0; row < rows; row += 1) {
    for (let frame = 0; frame < FRAME_COLUMNS; frame += 1) {
      cropTexture(scene, frameTextureName(prefix, row, frame), sourceKey, frame * FRAME_SIZE, row * FRAME_SIZE, FRAME_SIZE, FRAME_SIZE);
    }
  }
}

function nearestNode(runtime: MissionOfficeRuntimeModel, x: number, y: number): string | undefined {
  let bestId: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  runtime.nodes.forEach((node) => {
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

  const path = buildPath(map, startX, startY, approachX, approachY);

  if (seated && path.length > 0) {
    pushPoint(path, destination.x, destination.y);
  }

  return path;
}

function destinationKey(destination: MissionOfficeDestination, agent: AgentRuntimeState): string {
  return [
    destination.id,
    destination.pose,
    destination.facing,
    agent.status,
    agent.connected ? "on" : "off",
  ].join(":");
}

function applySpriteFrame(sprite: AgentSpriteRuntime, frame: number): void {
  const appearanceRow = baseRowForAppearance(sprite.agent.id, sprite.appearance);
  sprite.body.setTexture(frameTextureName("body", appearanceRow, frame));

  const outfit = outfitTextureInfo(sprite.agent);
  sprite.outfit.setTexture(frameTextureName(outfit.keyPrefix, outfit.row, frame));

  const hairRow = hairRowForAppearance(sprite.appearance);
  if (hairRow !== null && sprite.hair) {
    sprite.hair.setVisible(true);
    sprite.hair.setTexture(frameTextureName("hair", hairRow, frame));
  } else if (sprite.hair) {
    sprite.hair.setVisible(false);
  }
}

function applyAgentPose(sprite: AgentSpriteRuntime): void {
  const seated = sprite.destination?.pose === "sit" && sprite.agent.status === "working" && sprite.path.length === 0;
  const bodyOffsetY = seated ? -22 : 0;
  const bodyScale = seated ? 0.82 : 1;

  sprite.body.setY(bodyOffsetY).setScale(SPRITE_SCALE, SPRITE_SCALE * bodyScale);
  sprite.outfit.setY(bodyOffsetY).setScale(SPRITE_SCALE, SPRITE_SCALE * bodyScale);
  if (sprite.hair) {
    sprite.hair.setY(bodyOffsetY).setScale(SPRITE_SCALE, SPRITE_SCALE * bodyScale);
  }
  sprite.shadow.setY(seated ? 8 : 3).setScale(seated ? 1.05 : 1.28);
  sprite.marker.setY(seated ? 7 : 2);
  sprite.ring.setY(seated ? 7 : 2);
  sprite.signal.setY(seated ? -58 : -48);
  sprite.signal.setX(seated ? 17 : 18);
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
      return ["support", "upper-right", "lower-right", "upper-center"];
    case "lead":
      return ["exec-center", "exec-door", "lower-right", "upper-right"];
    case "meeting":
      return ["meeting-center", "meeting-door", "lower-center"];
    case "entry":
      return ["entry", "upper-left", "lower-left"];
    case "desk":
    case "work":
      return destination.zone === "Bullpen Floor"
        ? ["upper-left", "upper-center", "upper-right", "lower-left", "lower-center", "lower-right"]
        : ["upper-center", "lower-center", "meeting-door"];
    default:
      return ["upper-center", "lower-center", "support", "meeting-door"];
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

      load.image("office-bg", this.runtimeModel.background.source);
      load.image("shadow", SHADOW_SPRITE);
      load.image("body-sheet", CHARACTER_SPRITES);
      load.image("hair-sheet", HAIR_SPRITES);
      load.image("suit-sheet", SUIT_SPRITE);
      OUTFIT_SPRITES.forEach((source, index) => {
        load.image(`outfit-sheet-${index + 1}`, source);
      });
    }

    create(): void {
      const cameras = this.cameras;
      const add = this.add;
      if (!cameras || !add) {
        return;
      }

      cameras.main.setRoundPixels(true);
      add.rectangle(0, 0, this.runtimeModel.width, this.runtimeModel.height, 0xd7dde5).setOrigin(0, 0).setDepth(-20);

      add.image(this.runtimeModel.background.x, this.runtimeModel.background.y, "office-bg")
        .setOrigin(0, 0)
        .setDisplaySize(this.runtimeModel.background.width, this.runtimeModel.background.height)
        .setDepth(-10);

      createSheetFrames(this, "body-sheet", "body", BASE_ROWS);
      createSheetFrames(this, "hair-sheet", "hair", HAIR_ROWS);
      createSheetFrames(this, "suit-sheet", "suit", 4);
      OUTFIT_SPRITES.forEach((_, index) => {
        createSheetFrames(this, `outfit-sheet-${index + 1}`, `outfit-${index + 1}`, 1);
      });

      this.runtimeModel.occluders.forEach((occluder) => {
        const key = `occluder-${occluder.id}`;
        cropTexture(this, key, "office-bg", occluder.cropX, occluder.cropY, occluder.cropWidth, occluder.cropHeight);
        add.image(occluder.x, occluder.y, key)
          .setOrigin(0, 0)
          .setDepth(5000);
      });

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

      state.agents.forEach((placement) => {
        const appearance = resolveAppearance(placement.agent);
        const destination = resolveMissionOfficeDestination(this.runtimeModel, placement.point, placement.agent.status === "working");
        const nextKey = destinationKey(destination, placement.agent);
        const existing = this.sprites.get(placement.agent.id) ?? this.createAgentSprite(placement.agent, appearance, destination);
        const accentColor = Number.parseInt(statusColor(placement.agent).slice(1), 16);

        existing.agent = placement.agent;
        existing.appearance = appearance;
        existing.destination = destination;
        existing.signal.setFillStyle(accentColor, 1);
        existing.marker.setFillStyle(accentColor, 0.22);
        existing.ring.setVisible(state.selectedAgentId === placement.agent.id);

        if (existing.destinationKey !== nextKey) {
          existing.destinationKey = nextKey;
          existing.path = targetPath(
            options.map,
            this.runtimeModel,
            existing.container.x,
            existing.container.y,
            destination,
            placement.agent.status === "working" && destination.pose === "sit",
          );
          existing.activityCooldown = pauseDurationSeconds(existing.agent.id, existing.roamStep);
        }

        this.sprites.set(placement.agent.id, existing);
        applyAgentPose(existing);
      });
    }

    update(_time: number, delta: number): void {
      const deltaSeconds = delta / 1000;

      this.sprites.forEach((sprite) => {
        sprite.walkElapsed += deltaSeconds;
        sprite.pulseElapsed += deltaSeconds;
        sprite.activityCooldown = Math.max(0, sprite.activityCooldown - deltaSeconds);

        updateAgentMotion(sprite, deltaSeconds);
        if (sprite.path.length === 0 && sprite.agent.connected && sprite.agent.status === "idle" && sprite.activityCooldown <= 0) {
          queueRoamPath(options.map, this.runtimeModel, sprite);
        }

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
      const hairRow = hairRowForAppearance(appearance);
      const marker = this.add.ellipse(0, 2, 26, 10, Number.parseInt(statusColor(agent).slice(1), 16), 0.22);
      const ring = this.add.ellipse(0, 2, 34, 14)
        .setStrokeStyle(2, 0x7ef3b1, 1)
        .setFillStyle(0x7ef3b1, 0.14)
        .setVisible(false);
      const shadow = this.add.image(0, 3, "shadow").setScale(1.25).setAlpha(0.68);
      const body = this.add.image(0, 0, frameTextureName("body", baseRowForAppearance(agent.id, appearance), 0)).setOrigin(0.5, 1).setScale(SPRITE_SCALE);
      const outfitInfo = outfitTextureInfo(agent);
      const outfit = this.add.image(0, 0, frameTextureName(outfitInfo.keyPrefix, outfitInfo.row, 0)).setOrigin(0.5, 1).setScale(SPRITE_SCALE);
      const hair = hairRow === null
        ? null
        : this.add.image(0, 0, frameTextureName("hair", hairRow, 0)).setOrigin(0.5, 1).setScale(SPRITE_SCALE);
      const signal = this.add.circle(18, -48, 5, Number.parseInt(statusColor(agent).slice(1), 16), 1);
      signal.setStrokeStyle(2, 0x172113, 1);
      const spawnNodeId = spawnNodeIdForAgent(this.runtimeModel, agent, destination);
      const spawnNode = this.runtimeModel.nodes.get(spawnNodeId);
      const spawnX = spawnNode?.x ?? destination.approachX ?? destination.x;
      const spawnY = spawnNode?.y ?? destination.approachY ?? destination.y;

      const parts = [marker, ring, shadow, body, outfit, ...(hair ? [hair] : []), signal];
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
        hair,
        marker,
        outfit,
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
