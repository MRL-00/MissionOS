# Office UI Ops-View Redesign

Owner: Harry, delegated by Zoe for Matt/Pickle's office UI redesign workstream.

## Why this exists

The current office UI is built around a free `OrbitControls` camera plus keyboard panning. That makes the scene explorable, but it does not yet behave like an operations view where the whole room, the active team, and the key workflow surfaces stay legible at a glance.

This document defines the target direction for a top-down or shallow isometric office overview that prioritizes workflow clarity over free cinematic motion.

## Current structure

### Camera and navigation

- `src/main.ts` uses a `THREE.PerspectiveCamera` with a default position of `(-17, 14, 17)` and `OrbitControls`.
- Camera interaction is currently freeform:
  - pan enabled
  - damping enabled
  - zoom distance bounded only by `minDistance = 7` and `maxDistance = 42`
  - additional `WASD` / arrow-key camera translation moves both camera and target together
- `resetCamera()` restores the default perspective view and target.
- There is no room-fit guarantee, pan clamp, or explicit camera preset model.

### Scene bounds that matter

- `src/config/office-layout.json` defines the main floor at roughly `32 x 20` units, centered on `(0, 0, 0)`.
- The playable room footprint is effectively bounded near `x = -16..16` and `z = -10..10`.
- Team activity is distributed across bullpen desks, meeting room, kitchen, reception, and CIO office, so the view needs to preserve awareness of the whole room, not just the bullpen.

### HUD and dashboard

- `src/ui/overlay.ts` already provides the right building blocks for an ops-oriented shell:
  - top bar
  - left roster sidebar
  - activity panel
  - transcript panel
  - admin/control panel
  - world-space labels and speech bubbles
- The current layout behaves more like floating app chrome over a free camera than a purpose-built operations dashboard.

## Goals

- Establish a stable overview camera that reads as an office operations map.
- Keep the whole room visible when zoomed out.
- Keep the full team visible in normal overview mode whenever practical.
- Bound pan and zoom so the camera cannot drift into unhelpful or cinematic angles.
- Make side-panel/dashboard information first-class instead of secondary overlays.
- Preserve enough spatial depth to keep movement, desks, and rooms understandable.
- Move toward a Claw3D-style overview feel: legible, supervisory, and workflow-oriented.

## Non-goals

- Full free-camera exploration.
- Ground-level cinematic framing.
- Large scene/layout rewrites in the first pass.
- Replacing all current HUD surfaces at once.
- Solving every label-density problem in one iteration.

## Camera model

### Recommended default

- Use a shallow isometric-style perspective camera, not a fully top-down orthographic camera in phase 1.
- Lock the pitch into a narrow band centered around a supervisory angle.
- Lock azimuth to one approved overview heading, or a very small set of headings if rotation proves necessary.
- Treat the camera as a bounded ops viewport over the room, not an exploratory rig.

### Baseline numbers for implementation

- Default target: room center, slightly biased toward the team work area.
  - initial target proposal: `(1.5, 0.8, 0.4)`
- Default pitch: about `50` to `58` degrees downward from horizontal.
- Default azimuth: one stable diagonal overview angle, close to the current northwest-to-southeast read.
- Zoom should be implemented as target-distance changes within a fixed pitch/azimuth model.

### Why perspective first

- The existing scene already reads well in perspective.
- A shallow perspective preserves depth cues for agent movement, furniture, and room separation.
- It is a smaller migration from the current Three.js stack than switching immediately to orthographic framing.

## Pan and zoom bounds

### Pan model

- Pan should move the camera target across the room plane only.
- Clamp target movement to a fixed room-safe rectangle.
- Proposed initial target clamp:
  - `x = -4.5..7.5`
  - `z = -6.5..6.5`
- Clamp more tightly than the physical room edges so the camera never exposes dead space or cuts off critical rooms.

### Zoom model

- Define zoom as distance-to-target, not unrestricted orbit radius.
- Proposed initial zoom bounds:
  - overview max zoom-out distance: about `31`
  - detail max zoom-in distance: about `16`
- At max zoom-out, the whole office footprint must remain visible inside the viewport with sidebar-safe margins.
- At max zoom-in, the user may inspect a work cluster or meeting room, but the view should still preserve ops context.

### Rotation model

- Disable free rotation in the ops view.
- If rotation is kept at all, limit it to preset snaps only, such as:
  - main isometric overview
  - mirrored overview for accessibility/testing

## Keeping the whole room in frame

- Define a canonical room bounds box from the current layout footprint.
- Fit the max zoom-out distance against that box plus UI-safe padding.
- Reserve screen margin for the persistent sidebar and right-side dashboard surfaces when calculating fit.
- Acceptance rule: when the view is reset or fully zoomed out, the full office floor and all key rooms remain visible without manual camera correction.

## Sidebar and dashboard layout

### Layout direction

- Keep a persistent left operations sidebar for team roster and quick filters.
- Convert the right side into the primary contextual dashboard region instead of separate competing overlays.
- Keep the top bar slimmer and more status-oriented.

### Proposed shell

- Left sidebar:
  - live roster
  - team health/status counts
  - filters by activity or role
  - selected agent summary
- Right dashboard:
  - active workflow feed
  - meeting/transcript card
  - queue or blockers card
  - selected room/desk/agent details
- Top bar:
  - room state
  - connection state
  - global mode toggles
  - reset/focus controls

### Dashboard behavior

- Right-side content should be docked and persistent on desktop.
- Mobile/tablet can collapse dashboard surfaces into drawers, but desktop should read as a control-room layout.
- Scene labels should defer to the dashboard when detail density is high.

## Information hierarchy

1. Where is everyone?
2. What is each person doing?
3. Is there a meeting, blocker, or handoff that needs attention?
4. What area of the office is currently important?
5. What detailed transcript or activity context supports that state?

The 3D scene answers location and movement first. The side panels answer status, workflow, and detail.

## Interaction model

- Primary mode is passive supervision, not navigation play.
- Mouse wheel or trackpad pinch adjusts bounded zoom.
- Drag pans within clamps.
- Double-click or roster selection recenters on an agent or room cluster.
- Reset returns to the canonical full-office overview.
- Keyboard support should favor focus jumps and panel shortcuts over free camera translation.
- Speech bubbles and labels should be density-managed:
  - show essentials in overview
  - expand detail on selection or hover

## Incremental implementation phases

### Phase 1: camera foundation

- Introduce an ops-view camera config and room bounds model.
- Add a bounded camera controller or constrained `OrbitControls` wrapper.
- Remove or disable free keyboard translation while ops view is active.
- Keep current HUD and behavior otherwise intact.

### Phase 2: dashboard shell

- Restructure existing overlay panels into a more explicit left-sidebar/right-dashboard layout.
- Preserve current activity/transcript/admin functionality, but dock it into fewer, more intentional surfaces.
- Add a compact overview summary card set.

### Phase 3: focus and selection

- Add focus presets for bullpen, meeting room, CIO office, and whole office.
- Add selection-driven recentering and richer contextual detail cards.
- Reduce scene label noise based on zoom level and selection state.

### Phase 4: polish

- Refine animation easing and camera transitions.
- Tune label density, card priority, and mobile behaviors.
- Consider orthographic evaluation only if shallow perspective still hides too much information.

## Acceptance criteria

- The default reset view reads as a top-down or shallow isometric operations overview.
- Users cannot rotate into low-angle cinematic views.
- Users cannot pan far enough to lose the office footprint.
- At max zoom-out, the whole room is visible on common desktop aspect ratios.
- In normal overview state, the full team is generally visible at once.
- The left roster and right dashboard feel like part of one ops shell, not unrelated overlays.
- Current functionality remains available during the migration.
- Phase 1 can ship without breaking existing office interactions or layout editing.

## Recommended first code slice

- Add a typed ops-view config module with:
  - room bounds
  - target clamp bounds
  - zoom limits
  - preset pitch/azimuth values
  - named focus targets
- Wire it into `src/main.ts` in a later pass behind a minimal switch, after validating layout-editor interactions.

## Notes for the next implementation pass

- Layout editor interactions in `src/main.ts` currently rely on the active camera and `TransformControls`, so the first runtime integration should keep compatibility with editor mode.
- World-space labels and speech bubbles already exist and should continue to project correctly if the camera remains perspective-based.
- The current left sidebar, transcript, and activity panel are viable to refactor instead of replace.
