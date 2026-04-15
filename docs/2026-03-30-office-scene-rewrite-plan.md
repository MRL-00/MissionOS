# Office Scene Rewrite Implementation Plan

> For Hermes: use subagent-driven-development if we want to execute this in isolated tasks.

Goal: Replace the current mission office game/view with a cleaner, Linear-inspired command scene that supports robust pathing, proper occlusion, semantic overlays, and a polished HUD for the five core Hermes agents plus ephemeral subagents.

Architecture: Keep MissionOS as the control-plane app, but rewrite the office scene as a distinct feature slice with clear boundaries: scene shell UI in React, deterministic office simulation/runtime in Phaser, authored office metadata from map assets, and normalized mission state from the existing mission-control backend. Remove debug-first rendering assumptions and rebuild around production semantics.

Tech stack: React 19, Vite, TypeScript, Phaser 3, existing mission-control websocket/backend, existing Tiled-authored office assets.

---

## Why a rewrite is the right call

The current scene is trying to do too many things at once:
- in-world room labels
- debug-ish zone overlays
- HUD panels duplicated across top and bottom
- tile/grid pathing mixed with hand-authored office nodes
- static occluder slices that only partially match real furniture/walls

This is why it still feels prototype-y even after incremental fixes.

The rewrite should optimize for:
1. visual clarity first
2. semantic state, not debug geometry
3. path corridors and waypoints, not generalized tile crawling everywhere
4. deterministic depth/occlusion rules
5. one polished HUD language aligned with the Linear-like shell

---

## Rewrite target

The office scene should feel like:
- Linear in information hierarchy and restraint
- a tactical operations map in layout and status density
- pixel-art in scene rendering only

It should answer at a glance:
- who is working on what
- where each agent is physically represented in the office
- which tasks are blocked / in review / in QA
- which subagents are active and who spawned them
- what room/zone is currently active

---

## Phase 1: Scene shell rewrite

### Task 1: Replace the current MissionScene overlay layout

Objective: remove duplicated HUD/ticker patterns and use one clean top overlay plus one compact bottom detail bar.

Files:
- Modify: src/mission/scene/MissionScene.tsx
- Modify: src/app.css

Deliverables:
- top command bar with:
  - office title
  - selected agent badge
  - working / review / QA / linked counts
  - optional runtime health indicator
- bottom detail rail with:
  - selected agent summary
  - current task
  - room / activity / last update
- remove always-visible room label boxes from the map overlay
- remove the duplicated descriptive ticker copy

Acceptance:
- no duplicated status text
- no giant in-world labels obscuring the office art
- scene reads as one composed product surface

### Task 2: Add explicit scene display modes

Objective: make production and debug views separate.

Files:
- Modify: src/mission/scene/MissionScene.tsx
- Modify: src/app.css
- Possibly add: src/mission/scene/sceneDisplayModes.ts

Modes:
- cinematic (default): no debug overlays
- operational: show room anchors + assignment markers
- debug: show path nodes, corridors, occluders, blocked geometry

Acceptance:
- user can inspect routing/debug info without polluting the main scene

---

## Phase 2: Simulation/pathing rewrite

### Task 3: Replace ad hoc tile pathing with corridor-first navigation

Objective: stop agents walking through desks/walls by making authored corridor routing the primary navigation system.

Files:
- Rewrite: src/mission/scene/missionPhaserRuntime.ts
- Modify or split: src/mission/scene/missionOfficeRuntimeModel.ts
- Add: src/mission/scene/missionNavigationGraph.ts

Approach:
- represent office navigation as graph nodes + corridor segments
- destinations (desk, QA station, review table, support station, executive office) map to approach anchors
- movement path = spawn anchor -> corridor graph -> room anchor -> destination anchor
- tile fallback only for recovery, never as primary planning path

Acceptance:
- agents do not cut through walls or furniture
- desk approach paths are deterministic
- room transitions look intentional

### Task 4: Add occupancy-aware local steering

Objective: avoid agents stacking on top of each other or colliding awkwardly near desks/doors.

Files:
- Modify: src/mission/scene/missionPhaserRuntime.ts
- Add: src/mission/scene/missionSteering.ts

Rules:
- reserve destination anchors
- if occupied, queue nearby hold points
- apply slight repulsion around other moving agents
- prevent idle roam from entering blocked/high-traffic anchors

Acceptance:
- fewer overlaps
- no jittering at chokepoints
- movement feels deliberate

### Task 5: Rewrite idle behavior

Objective: stop weird “wandering because we can” behavior.

Files:
- Modify: src/mission/scene/missionPhaserRuntime.ts

Idle patterns:
- residents return to their base station
- occasional context-aware micro-movement only inside safe room-specific anchors
- subagents disappear when complete instead of lingering aimlessly

Acceptance:
- office feels alive but not chaotic

---

## Phase 3: Depth / occlusion rewrite

### Task 6: Replace static occluder slices with semantic occlusion layers

Objective: produce believable layering for desks, walls, and executive office furniture.

Files:
- Modify: src/mission/scene/missionOfficeRuntimeModel.ts
- Modify: src/mission/scene/missionPhaserRuntime.ts
- Add: src/mission/scene/missionOcclusionModel.ts

Approach:
- classify scene props into:
  - floor decoration
  - low furniture
  - desk-front occluder
  - wall/partition occluder
  - tall decor
- compute depth from world Y
- attach fade/partial alpha when the selected agent is hidden behind foreground art

Acceptance:
- agents render behind desk fronts where appropriate
- agents don’t appear under walls
- selected agent stays legible

### Task 7: Add path-safe destination offsets and sit/stand anchors

Objective: desk seating should feel physically correct.

Files:
- Modify: src/mission/scene/missionOfficeRuntimeModel.ts

Rules:
- each desk has:
  - stand anchor
  - sit anchor
  - approach anchor
- QA and support stations have working anchors
- review/meeting spaces have grouped anchors

Acceptance:
- no clipping into desk faces
- sit positions look consistent

---

## Phase 4: Office semantics rewrite

### Task 8: Redesign zones around actual workflow

Objective: make rooms correspond to the five-agent workflow.

Files:
- Modify: src/mission/scene/missionMapModel.ts
- Modify: src/mission/scene/missionOfficeRuntimeModel.ts
- Possibly update map metadata references

Target zones:
- Bullpen: iOS Dev + Full-stack Dev
- Review Table / Lead Office: Lead Engineer
- QA Lab: QA agent and emulator/testing state
- Support Desk: Support triage
- Dispatch / Entry: subagent arrivals and task intake

Acceptance:
- room purpose aligns with workflow state
- movement patterns reinforce the mental model

### Task 9: Add ephemeral subagent rendering

Objective: visualize spawned subagents without making the office noisy.

Files:
- Modify: src/types.ts
- Modify: server mission snapshot types if needed
- Modify: MissionScene + runtime renderer

Behavior:
- parent agent remains the persistent resident
- spawned subagents appear as temporary visitors with lighter badges / variant coloring
- subagents can occupy temporary stations or a dispatch lane
- completed subagents fade out / depart

Acceptance:
- subagent work is visible
- persistent office identity remains clear

---

## Phase 5: HUD and Linear-style polish

### Task 10: Rebuild HUD to match the Linear shell

Objective: make the office view look like it belongs inside the Linear-inspired app.

Files:
- Modify: src/mission/scene/MissionScene.tsx
- Modify: src/app.css

Design language:
- use IBM Plex / current app typography for HUD
- pixel font only for tiny in-scene flavor accents if needed
- cleaner spacing, softer borders, less retro panel chrome
- use mission shell color tokens, not ad hoc scene palette everywhere

Acceptance:
- office scene looks native to the app, not embedded from another project

### Task 11: Add focused agent cards in-scene

Objective: show useful information without clutter.

Files:
- Modify: src/mission/scene/MissionScene.tsx
- Modify: src/app.css

UI elements:
- selected agent chip
- activity chip (coding/review/qa/support/blocked)
- linked runtime chip
- last event timestamp
- subagent count if any

Acceptance:
- selected agent state is obvious
- no giant text blocks covering the map

---

## Phase 6: Integration with mission orchestration

### Task 12: Map task stages to office states

Objective: office behavior should be driven by workflow state, not arbitrary status flags.

Files:
- Modify: src/mission hooks / mapping layer
- Possibly add: src/mission/scene/missionSceneState.ts

Mappings:
- todo -> dispatch / idle
- in_progress -> desk work
- dev_review -> lead engineer/review area
- qa_review -> QA lab
- uat_review -> QA/UAT staging
- ready_to_deploy -> shipping/release area or standby state
- blocked -> alert posture / marked lane

Acceptance:
- movement becomes meaningful and explainable

### Task 13: Add event-driven scene updates

Objective: movement should react to actual mission events.

Files:
- Modify: websocket integration / mission state mapping
- Modify: MissionScene runtime state input

Events:
- task assigned
- subagent spawned
- PR opened
- review requested
- QA started
- QA passed/failed
- blocked waiting for human

Acceptance:
- scene changes are tied to real events, not just polling snapshots

---

## Suggested file structure after rewrite

- src/mission/scene/MissionScene.tsx
- src/mission/scene/missionSceneState.ts
- src/mission/scene/missionNavigationGraph.ts
- src/mission/scene/missionSteering.ts
- src/mission/scene/missionOcclusionModel.ts
- src/mission/scene/missionOfficeRuntimeModel.ts
- src/mission/scene/missionPhaserRuntime.ts
- src/mission/scene/missionDisplayModes.ts

---

## Execution order recommendation

1. Scene shell rewrite
2. Corridor-first navigation graph
3. Destination anchors and occupancy
4. Occlusion/depth system
5. Zone semantics for five-agent workflow
6. Subagent rendering
7. Final HUD polish

Do not try to perfect art polish before pathing and depth are solved.

---

## Verification checklist

- agents never path through walls
- agents do not clip through desk fronts
- selected agent remains legible when occluded
- idle movement stays believable
- no duplicated HUD text
- production mode is clean and presentation-ready
- debug mode exists for engineering work
- scene clearly communicates Lead Engineer / iOS Dev / Full-stack Dev / QA / Support
- subagents appear and disappear cleanly

---

## Immediate next implementation slice

The first real rewrite slice should be:
1. remove current in-world zone boxes from default mode
2. replace top+bottom duplicated HUD with one top command bar and one bottom selected-agent rail
3. move pathing to authored node/corridor graph first
4. add proper desk approach anchors and occupancy

This will deliver the biggest visible quality improvement fastest.
