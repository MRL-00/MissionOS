type PropertyValue = string | number | boolean;

interface TiledProperty {
  name: string;
  value: PropertyValue;
}

interface TiledTileDefinition {
  id: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  properties?: TiledProperty[];
}

interface TiledTileset {
  firstgid: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  margin?: number;
  name: string;
  spacing?: number;
  tilecount?: number;
  tileheight: number;
  tiles?: TiledTileDefinition[];
  tilewidth: number;
  columns?: number;
}

interface TiledTileLayer {
  data: number[];
  height: number;
  id?: number;
  name: string;
  opacity?: number;
  properties?: TiledProperty[];
  type: "tilelayer";
  visible?: boolean;
  width: number;
}

interface TiledObject {
  gid?: number;
  height?: number;
  id: number;
  name?: string;
  point?: boolean;
  properties?: TiledProperty[];
  type?: string;
  visible?: boolean;
  width?: number;
  x: number;
  y: number;
}

interface TiledObjectLayer {
  draworder?: string;
  id?: number;
  name: string;
  objects: TiledObject[];
  opacity?: number;
  properties?: TiledProperty[];
  type: "objectgroup";
  visible?: boolean;
}

interface TiledMap {
  height: number;
  infinite: boolean;
  layers: Array<TiledTileLayer | TiledObjectLayer>;
  properties?: TiledProperty[];
  tileheight: number;
  tilesets: TiledTileset[];
  tilewidth: number;
  width: number;
}

interface MissionSpriteAsset {
  cropHeight: number;
  cropWidth: number;
  cropX: number;
  cropY: number;
  imageHeight: number;
  imageWidth: number;
  source: string;
}

export interface MissionMapTile {
  asset: MissionSpriteAsset;
  height: number;
  id: string;
  opacity: number;
  width: number;
  x: number;
  y: number;
  zIndex: number;
}

export interface MissionMapProp {
  accent: string | undefined;
  asset: MissionSpriteAsset;
  filter: string | undefined;
  height: number;
  id: string;
  label: string | undefined;
  width: number;
  x: number;
  y: number;
  zIndex: number;
}

export interface MissionMapZone {
  accent: string | undefined;
  height: number;
  id: string;
  kind: string;
  label: string;
  summary: string | undefined;
  width: number;
  x: number;
  y: number;
}

export interface MissionMapSlot {
  agentId: string | undefined;
  id: string;
  kind: string;
  priority: number;
  x: number;
  y: number;
  zone: string;
}

export interface MissionTileMap {
  cols: number;
  description: string;
  pixelHeight: number;
  pixelWidth: number;
  props: MissionMapProp[];
  rows: number;
  slots: MissionMapSlot[];
  theme: string;
  tileHeight: number;
  tileWidth: number;
  tiles: MissionMapTile[];
  title: string;
  walkableTiles: boolean[];
  zones: MissionMapZone[];
}

interface RegistryTile {
  accent: string | undefined;
  asset: MissionSpriteAsset;
  filter: string | undefined;
  kind: string | undefined;
  label: string | undefined;
  walkable: boolean;
}

const DEFAULT_TITLE = "Mission Town";
const DEFAULT_DESCRIPTION = "Tile-authored mission district with explicit blockers, zones, and agent slots.";
const DEFAULT_THEME = "Structured mission map";
const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
const FLIPPED_VERTICALLY_FLAG = 0x40000000;
const FLIPPED_DIAGONALLY_FLAG = 0x20000000;
const FLIP_MASK = FLIPPED_HORIZONTALLY_FLAG | FLIPPED_VERTICALLY_FLAG | FLIPPED_DIAGONALLY_FLAG;

export const MISSION_MAP_URL = "/assets/modern-office/mission-office.tmj";

function propertyBag(properties?: TiledProperty[]): Record<string, PropertyValue> {
  if (!properties?.length) {
    return {};
  }

  return properties.reduce<Record<string, PropertyValue>>((record, property) => {
    record[property.name] = property.value;
    return record;
  }, {});
}

function stringValue(value: PropertyValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: PropertyValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: PropertyValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function resolvePropZIndex(
  object: TiledObject,
  objectProperties: Record<string, PropertyValue>,
  layerProperties: Record<string, PropertyValue>,
): number {
  const explicitZIndex = numberValue(objectProperties.zIndex) ?? numberValue(layerProperties.zIndex);
  if (typeof explicitZIndex === "number") {
    return explicitZIndex;
  }

  const depth = (stringValue(objectProperties.depth) ?? stringValue(layerProperties.depth) ?? "").trim().toLowerCase();
  if (depth === "background" || depth === "underlay") {
    return 0;
  }
  if (depth === "foreground" || depth === "overlay") {
    return 5000 + Math.round(object.y);
  }

  return Math.round(object.y);
}

function resolveAssetUrl(source: string, mapUrl: string): string {
  if (source.startsWith("/") || source.startsWith("http://") || source.startsWith("https://")) {
    return source;
  }

  const resolved = new URL(source, new URL(mapUrl, window.location.origin));
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function tileAssetFromImage(
  imageSource: string,
  imageWidth: number,
  imageHeight: number,
  cropX = 0,
  cropY = 0,
  cropWidth = imageWidth,
  cropHeight = imageHeight,
): MissionSpriteAsset {
  return {
    source: imageSource,
    imageWidth,
    imageHeight,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}

function buildTileRegistry(map: TiledMap, mapUrl: string): Map<number, RegistryTile> {
  const registry = new Map<number, RegistryTile>();

  map.tilesets.forEach((tileset) => {
    const tileProps = new Map<number, TiledTileDefinition>();
    tileset.tiles?.forEach((tile) => {
      tileProps.set(tile.id, tile);
    });

    if (tileset.image && tileset.imagewidth && tileset.imageheight && tileset.tilecount && tileset.columns) {
      const imageSource = resolveAssetUrl(tileset.image, mapUrl);
      const spacing = tileset.spacing ?? 0;
      const margin = tileset.margin ?? 0;

      for (let tileId = 0; tileId < tileset.tilecount; tileId += 1) {
        const column = tileId % tileset.columns;
        const row = Math.floor(tileId / tileset.columns);
        const definition = tileProps.get(tileId);
        const properties = propertyBag(definition?.properties);
        const cropX = margin + column * (tileset.tilewidth + spacing);
        const cropY = margin + row * (tileset.tileheight + spacing);

        registry.set(tileset.firstgid + tileId, {
          asset: tileAssetFromImage(
            imageSource,
            tileset.imagewidth,
            tileset.imageheight,
            cropX,
            cropY,
            tileset.tilewidth,
            tileset.tileheight,
          ),
          walkable: booleanValue(properties.walkable) ?? true,
          kind: stringValue(properties.kind),
          label: stringValue(properties.label),
          accent: stringValue(properties.accent),
          filter: stringValue(properties.filter),
        });
      }

      return;
    }

    tileset.tiles?.forEach((tile) => {
      if (!tile.image || !tile.imagewidth || !tile.imageheight) {
        return;
      }

      const properties = propertyBag(tile.properties);
      registry.set(tileset.firstgid + tile.id, {
        asset: tileAssetFromImage(
          resolveAssetUrl(tile.image, mapUrl),
          tile.imagewidth,
          tile.imageheight,
        ),
        walkable: booleanValue(properties.walkable) ?? true,
        kind: stringValue(properties.kind),
        label: stringValue(properties.label),
        accent: stringValue(properties.accent),
        filter: stringValue(properties.filter),
      });
    });
  });

  return registry;
}

function normalizeGid(rawGid: number): number {
  return (rawGid & ~FLIP_MASK) >>> 0;
}

function applyBlockedRect(
  walkableTiles: boolean[],
  cols: number,
  rows: number,
  tileWidth: number,
  tileHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (width <= 0 || height <= 0) {
    return;
  }

  const startCol = Math.max(0, Math.floor(x / tileWidth));
  const endCol = Math.min(cols - 1, Math.ceil((x + width) / tileWidth) - 1);
  const startRow = Math.max(0, Math.floor(y / tileHeight));
  const endRow = Math.min(rows - 1, Math.ceil((y + height) / tileHeight) - 1);

  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      walkableTiles[row * cols + col] = false;
    }
  }
}

function isTiledMap(value: unknown): value is TiledMap {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TiledMap>;
  return typeof candidate.width === "number"
    && typeof candidate.height === "number"
    && typeof candidate.tilewidth === "number"
    && typeof candidate.tileheight === "number"
    && Array.isArray(candidate.layers)
    && Array.isArray(candidate.tilesets);
}

export function parseMissionMap(raw: unknown, mapUrl = MISSION_MAP_URL): MissionTileMap {
  if (!isTiledMap(raw)) {
    throw new Error("Mission map is not a valid Tiled JSON map.");
  }

  const mapProperties = propertyBag(raw.properties);
  const registry = buildTileRegistry(raw, mapUrl);
  const walkableTiles = Array(raw.width * raw.height).fill(true);
  const tiles: MissionMapTile[] = [];
  const props: MissionMapProp[] = [];
  const zones: MissionMapZone[] = [];
  const slots: MissionMapSlot[] = [];

  raw.layers.forEach((layer, layerIndex) => {
    if (layer.visible === false) {
      return;
    }

    if (layer.type === "tilelayer") {
      const opacity = layer.opacity ?? 1;

      layer.data.forEach((rawGid, index) => {
        const gid = normalizeGid(rawGid);
        if (!gid) {
          return;
        }

        const tile = registry.get(gid);
        if (!tile) {
          return;
        }

        const col = index % layer.width;
        const row = Math.floor(index / layer.width);

        tiles.push({
          id: `${layer.name}-${index}`,
          asset: tile.asset,
          x: col * raw.tilewidth,
          y: row * raw.tileheight,
          width: raw.tilewidth,
          height: raw.tileheight,
          opacity,
          zIndex: layerIndex + 1,
        });

        if (!tile.walkable) {
          walkableTiles[row * raw.width + col] = false;
        }
      });

      return;
    }

    const layerProperties = propertyBag(layer.properties);
    const layerName = layer.name.trim().toLowerCase();
    const opacity = layer.opacity ?? 1;

    layer.objects.forEach((object) => {
      if (object.visible === false) {
        return;
      }

      const properties = propertyBag(object.properties);
      const objectKind = stringValue(properties.kind) ?? object.type ?? "";
      const objectLabel = object.name?.trim() || stringValue(properties.label) || "";

      if (layerName === "blocked") {
        applyBlockedRect(
          walkableTiles,
          raw.width,
          raw.height,
          raw.tilewidth,
          raw.tileheight,
          object.x,
          object.y,
          object.width ?? 0,
          object.height ?? 0,
        );
        return;
      }

      if (layerName === "zones") {
        zones.push({
          id: `zone-${object.id}`,
          label: objectLabel || "Mission Zone",
          kind: objectKind || "zone",
          x: object.x,
          y: object.y,
          width: object.width ?? raw.tilewidth,
          height: object.height ?? raw.tileheight,
          accent: stringValue(properties.accent),
          summary: stringValue(properties.summary),
        });
        return;
      }

      if (layerName === "slots") {
        slots.push({
          id: `slot-${object.id}`,
          kind: objectKind || "desk",
          zone: stringValue(properties.zone) ?? objectLabel ?? "Mission Zone",
          x: object.point ? object.x : object.x + (object.width ?? 0) / 2,
          y: object.point ? object.y : object.y + (object.height ?? 0) / 2,
          agentId: stringValue(properties.agentId),
          priority: numberValue(properties.priority) ?? 0,
        });
        return;
      }

      if (!object.gid) {
        return;
      }

      const gid = normalizeGid(object.gid);
      const tile = registry.get(gid);
      if (!tile) {
        return;
      }

      const width = object.width ?? tile.asset.cropWidth;
      const height = object.height ?? tile.asset.cropHeight;
      const accent = stringValue(properties.accent) ?? tile.accent;
      const filter = stringValue(properties.filter) ?? tile.filter;
      const label = stringValue(properties.label) ?? (objectLabel || tile.label);
      const kind = stringValue(layerProperties.kind) ?? layer.name;

      props.push({
        id: `${kind}-${object.id}`,
        asset: tile.asset,
        x: object.x,
        y: object.y,
        width,
        height,
        zIndex: resolvePropZIndex(object, properties, layerProperties),
        label,
        accent,
        filter,
      });

      const shouldBlock = booleanValue(properties.blocked);
      if (shouldBlock) {
        const footprintWidth = numberValue(properties.footprintWidth) ?? width;
        const footprintHeight = numberValue(properties.footprintHeight) ?? height;
        const footprintOffsetX = numberValue(properties.footprintOffsetX) ?? 0;
        const footprintOffsetY = numberValue(properties.footprintOffsetY) ?? height - footprintHeight;

        applyBlockedRect(
          walkableTiles,
          raw.width,
          raw.height,
          raw.tilewidth,
          raw.tileheight,
          object.x + footprintOffsetX,
          object.y - height + footprintOffsetY,
          footprintWidth,
          footprintHeight,
        );
      }
    });
  });

  props.sort((left, right) => left.zIndex - right.zIndex || left.x - right.x);
  slots.sort((left, right) => left.priority - right.priority || left.y - right.y || left.x - right.x);

  return {
    cols: raw.width,
    rows: raw.height,
    tileWidth: raw.tilewidth,
    tileHeight: raw.tileheight,
    pixelWidth: raw.width * raw.tilewidth,
    pixelHeight: raw.height * raw.tileheight,
    title: stringValue(mapProperties.title) ?? DEFAULT_TITLE,
    description: stringValue(mapProperties.description) ?? DEFAULT_DESCRIPTION,
    theme: stringValue(mapProperties.theme) ?? DEFAULT_THEME,
    tiles,
    props,
    zones,
    slots,
    walkableTiles,
  };
}

export async function loadMissionMap(mapUrl = MISSION_MAP_URL): Promise<MissionTileMap> {
  const response = await fetch(mapUrl, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to load mission map (${response.status}).`);
  }

  const payload = await response.json();
  return parseMissionMap(payload, mapUrl);
}
