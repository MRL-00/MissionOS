# Ops View Phase 1 — Implementation Handoff

Owner: Harry (delegated by Zoe).
References: `docs/office-ui-ops-view.md` (design spec), `src/ui/opsViewConfig.ts` (typed config).

## What Phase 1 delivers

A bounded ops-view camera that replaces the current free OrbitControls when active. The whole office stays visible at max zoom-out, rotation is locked, pan is clamped, and pitch stays in the supervisory band. All existing HUD and layout-editor functionality continues to work.

---

## Implementation checklist

### 1. Create `src/ui/opsViewController.ts`

A thin wrapper around `OrbitControls` that enforces the ops-view constraints.

**Exports:**

```ts
export function applyOpsView(
  controls: OrbitControls,
  camera: THREE.PerspectiveCamera,
  config?: OpsViewConfig
): OpsViewHandle;

export interface OpsViewHandle {
  /** Animate to a named preset ("overview", "bullpen", etc.) */
  focusPreset(id: OpsViewPreset["id"]): void;
  /** Reset to the default overview position */
  reset(): void;
  /** Call once per frame before controls.update() */
  clampTarget(): void;
  /** Tear down — restores previous OrbitControls settings */
  dispose(): void;
}
```

**Behavior inside `applyOpsView`:**

1. Save the current OrbitControls settings so `dispose()` can restore them.
2. Apply config values to controls:
   ```
   controls.minDistance = config.minDistance       // 16
   controls.maxDistance = config.maxDistance        // 31
   controls.minPolarAngle = config.minPolarAngle  // 50°
   controls.maxPolarAngle = config.maxPolarAngle  // 58°
   controls.minAzimuthAngle = config.minAzimuthAngle  // -45°
   controls.maxAzimuthAngle = config.maxAzimuthAngle  // -45°
   controls.enableRotate = false                   // lock rotation
   controls.enablePan = true                       // pan stays on
   controls.screenSpacePanning = false             // pan on XZ plane
   ```
3. Set initial camera position from config default target + distance + polar/azimuth angles.
4. Set `controls.target` to `config.defaultTarget`.
5. `clampTarget()` enforces `targetBounds` from `opsViewConfig.ts` using the existing `clampOpsViewTarget()` helper.
6. `focusPreset(id)` lerps `controls.target` and camera distance to the preset values over ~0.4s using a simple TWEEN or manual lerp in the frame loop.
7. `reset()` is shorthand for `focusPreset("overview")`.

**Key constraint:** `screenSpacePanning = false` makes OrbitControls pan on the world XZ plane, which is what we want for a map-style drag.

### 2. Wire into `src/main.ts`

**Minimal changes — behind a boolean toggle:**

```ts
import { applyOpsView, type OpsViewHandle } from "./ui/opsViewController";
import { OFFICE_OPS_VIEW_CONFIG } from "./ui/opsViewConfig";

let opsViewHandle: OpsViewHandle | null = null;
let opsViewActive = true; // default on; set false for layout-editor compat
```

**At init (after OrbitControls creation, ~line 61):**

```ts
if (opsViewActive) {
  opsViewHandle = applyOpsView(controls, camera, OFFICE_OPS_VIEW_CONFIG);
}
```

**In the render loop (~line 1110, before `controls.update()`):**

```ts
opsViewHandle?.clampTarget();
```

**In `resetCamera()` (~line 803):**

```ts
function resetCamera(): void {
  if (opsViewHandle) {
    opsViewHandle.reset();
  } else {
    camera.position.copy(defaultCameraPosition);
    controls.target.copy(defaultTarget);
    controls.update();
  }
}
```

**Disable WASD/arrow keyboard camera movement when ops view is active.** In the existing keydown/keyup handlers, gate on `!opsViewActive`. The ops view relies on mouse/trackpad drag for panning.

**Layout editor compatibility:** When the layout editor is enabled (`layoutEditorEnabled === true`), call `opsViewHandle.dispose()` and set `opsViewHandle = null`. When the editor is disabled, re-apply ops view. This keeps TransformControls working without conflict.

### 3. Update `resetCamera` button target

The HUD's "Reset View" button already calls `onResetCamera` (line 116). No HUD changes needed for Phase 1 — it will route through the updated `resetCamera()`.

### 4. Adjust fog to match ops-view distances

Current fog: near=28, far=52. At max ops zoom-out (distance ~31), the far edges of the room might start fogging. Adjust:

```ts
scene.fog = new THREE.Fog("#ead7b7", 35, 60);
```

This keeps the full room crisp at overview distance.

### 5. Validate whole-room visibility

At max zoom-out (distance 31, polar angle 54°, azimuth -45°):
- Camera Y ≈ 31 × sin(54°) ≈ 25
- Camera horizontal offset ≈ 31 × cos(54°) ≈ 18.2
- With FOV 45° and aspect ~16:9, the visible ground width at Y=25 is roughly ±18 units

The room footprint is ±16 x ±10, so it fits. If it's tight on the Z axis with sidebar UI, the `maxDistance` can increase to 34 or the FOV can bump to 50°. Test empirically and adjust `OFFICE_OPS_VIEW_CONFIG` values.

---

## Files touched (Phase 1 only)

| File | Change |
|------|--------|
| `src/ui/opsViewController.ts` | **NEW** — bounded camera controller |
| `src/main.ts` | Wire ops view, gate WASD keys, update resetCamera, adjust fog |
| `src/ui/opsViewConfig.ts` | No changes needed (already complete) |
| `src/styles.css` | No changes needed |
| `src/ui/overlay.ts` | No changes needed |

---

## What NOT to change in Phase 1

- Do not restructure the HUD/sidebar/dashboard layout — that's Phase 2.
- Do not add preset buttons to the UI yet — that's Phase 3 (focus & selection).
- Do not switch to orthographic camera — design spec explicitly defers this.
- Do not touch server/ or workflow files.
- Do not remove existing OrbitControls — wrap them, don't replace.

---

## Testing checklist

- [ ] Default load shows shallow isometric overview with whole room visible
- [ ] Mouse drag pans the view; camera target stays within clamped bounds
- [ ] Scroll wheel zooms between distance 16–31
- [ ] Cannot rotate the camera (azimuth and polar locked to narrow bands)
- [ ] "Reset View" button returns to full-office overview
- [ ] WASD/arrow keys do NOT move camera (ops view suppresses them)
- [ ] Layout editor toggle disables ops view, restores free controls
- [ ] Closing layout editor re-enables ops view
- [ ] World-space labels and speech bubbles still project correctly
- [ ] Agent movement and animations render normally
- [ ] No TypeScript errors (`npm run typecheck`)

---

## Acceptance criteria (from design spec)

1. Default reset view reads as a top-down or shallow isometric operations overview.
2. Users cannot rotate into low-angle cinematic views.
3. Users cannot pan far enough to lose the office footprint.
4. At max zoom-out, the whole room is visible on common desktop aspect ratios.
5. In normal overview state, the full team is generally visible at once.
6. Current functionality remains available during the migration.
7. Phase 1 ships without breaking existing office interactions or layout editing.
