# Mission Map Authoring

The mission scene now supports a `Tiled`-style JSON map at:

- `public/assets/modern-office/mission-office.tmj`

If that file is missing, the UI falls back to the built-in office template in:

- `src/mission/scene/missionOfficeFallback.ts`

## Recommended tool

- Use [Tiled](https://www.mapeditor.org) as the primary editor.
- Save the map as JSON (`.tmj`) with embedded tileset definitions.
- Keep image paths relative to the map file so office assets like `6_Office_Designs/...` or other local packs resolve under `public/assets/modern-office`.

## Supported layers

- `ground`
  Terrain tile layer. Usually grass.
- `farmland`
  Optional terrain tile layer for farm or dirt patches.
- `water`
  Non-walkable terrain tile layer.
- `paths`
  Walkable path and plaza layer.
- `zones`
  Rectangle objects with labels and summaries.
- `props`
  Tile objects for buildings, trees, chests, and other decor.
- `blocked`
  Rectangle objects marking footprints agents must not occupy.
- `slots`
  Point objects for agent placement.

## Supported object properties

- `zones`
  `accent`: hex color string for the label and outline.
  `summary`: description shown in the HUD when that zone is active.
- `props`
  `label`: optional prop label.
  `accent`: label color.
  `filter`: optional CSS filter for recoloring duplicate sprites.
  `depth`: optional string. Use `background` for floorplans/underlays and `foreground` for walls or props that should sit in front of agents.
  `zIndex`: optional numeric override when you need exact draw order.
- `slots`
  `zone`: display name used in agent labels.
  `agentId`: optional hard binding for a specific agent, such as `charlie`.

## Slot types

- `meeting`
- `desk`
- `entry`
- `lead`
- `support`
- `overflow`
- `special`

## Current behavior

- Meeting agents use `meeting` slots.
- Entering and leaving agents use `entry` slots.
- Leadership-style roles prefer `lead` slots.
- Support-style roles prefer `support` slots.
- Everyone else uses `desk`, then `overflow`.
- `agentId` bindings override the automatic assignment.
