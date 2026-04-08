# Office coordination split

_Last updated: 2026-03-26_

## Ownership

### Architecture / backend / workflow track — Zoe
Own and continue the non-visual implementation work:
- event model and message flow between server and client
- workflow/state transitions for agent lifecycle and meetings
- websocket/realtime transport and snapshot/update contracts
- server APIs for agent state, activity, meeting orchestration, and sync
- integration boundaries that the UI can consume without redesign coupling

Current code areas on this track include:
- `server/`
- `src/network/`
- shared runtime/event types in `src/types.ts`
- any workflow glue needed to support UI integration without doing the redesign itself

### UI redesign track — Harry
Harry is the owner of the UI workstream for this effort.

Harry owns the visual redesign and interaction layer, including:
- HUD/sidebar/admin/activity/transcript redesign
- layout, styling, responsiveness, interaction polish
- visual treatment of roster/activity/meeting surfaces
- UX refinements inside `src/ui/` and related presentation/styling layers

Primary UI-facing areas:
- `src/ui/`
- `src/styles.css`
- presentation concerns in scene/UI composition

## Coordination rules
- Zoe does **not** spend cycle time on the UI redesign except where needed to define or preserve integration boundaries.
- Harry does **not** need to wait on visual polish review from Zoe to proceed with the redesign track.
- Shared changes should prefer stable contracts first: types, payload shapes, event names, and server/client responsibilities.
- If a UI requirement reveals a missing contract, Zoe adds/adjusts the contract and documents the boundary rather than taking over the UI implementation.

## Immediate split

### Zoe next
- continue architecture/workflow/event-layer implementation
- keep server ↔ client contracts stable and explicit
- support UI integration with minimal adapter/boundary work only

### Harry next
- drive the visible UI redesign workstream
- update interface structure/presentation against the existing runtime contracts where possible
- raise contract gaps for Zoe instead of pushing backend workflow changes ad hoc

## Integration boundary
When UI needs realtime data, it should consume:
- websocket messages and snapshots from `src/network/websocket.ts`
- API endpoints exposed from `server/src/index.ts`
- shared types from `src/types.ts`

If those contracts need to move, Zoe owns the contract update; Harry owns consuming it in the redesigned UI.
