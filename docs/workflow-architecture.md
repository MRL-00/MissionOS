# Office Workflow Pipeline Architecture

## Purpose

This repo already has a lightweight realtime office backend in `server/server.ts` with:

- custom HTTP endpoints
- a single `ws` websocket broadcast channel
- append-only activity logging in `server/activity.ts`
- JSON-file persistence in `server/persistence.ts`

The workflow foundation added here follows those same patterns instead of introducing a second backend stack.

## System Roles

- Linear is the canonical workflow state.
  The office backend stores the current workflow status as a typed mirror of the Linear state and rejects work outside the configured current sprint.
- GitHub is the code and PR truth.
  Workflow items carry GitHub branch / PR / SHA references, and `merged_ready` requires a GitHub PR reference.
- The office backend is the live coordination and event layer.
  Handoffs, workflow events, comments, QA triggers, and websocket visibility are owned here.

## Current Repo Implementation

### Shared contracts

`src/types.ts` now defines:

- `WorkflowItem`
- `WorkflowEventRecord`
- `WorkflowHandoff`
- `WorkflowComment`
- `WorkflowQaTrigger`
- workflow enums for status, actor role, handoff state, QA state, and websocket messages

This keeps the client/server contract in one place, matching the repo’s existing agent and meeting types.

### Backend state and persistence

`server/workflow.ts` adds an in-process workflow store with JSON persistence in `data/workflow.json`.

It mirrors the existing agent persistence approach:

- in-memory maps/arrays for fast mutation and broadcast
- atomic temp-file writes
- queue-based persistence to avoid overlapping writes

### API surface

Minimal endpoints now exist for:

- workflow snapshot and filtered reads
- workflow item create/update
- workflow events
- handoff creation and resolution
- comments, including direct-to-Linear comment intents
- manual QA trigger creation

These endpoints live in the existing HTTP server and use the same validation/error flow as the rest of the backend.

### Realtime visibility

Workflow mutations emit:

- activity log entries for visible office ops state
- websocket `workflow-snapshot` on connect
- websocket `workflow-item-updated`
- websocket `workflow-event`

No UI redesign is required for this foundation; the existing activity log can surface the new state changes immediately.

## Hard Rules Enforced

### Current sprint only

`server/types.ts` defines `CURRENT_SPRINT_ID` from `process.env.CURRENT_SPRINT_ID` with a fallback of `"current"`.

The workflow model/API layer rejects:

- creating items outside the current sprint
- updating items to a different sprint
- mutating comments, handoffs, or QA state for non-current-sprint items

### Linear comment permissions

Only these actor roles can create direct Linear comments:

- `pickle`
- `engineer`
- `reviewer`
- `qa`

`observer` is rejected at the API layer.

### QA auto-trigger

When a workflow item enters either:

- `qa`
- `merged_ready`

the backend automatically creates a queued QA trigger and activity/event trail.

## Ownership Model

- Pickle remains the orchestrator for ambiguity, escalation, and coordination-heavy decisions.
- Pickle is not required for normal workflow state transitions.
- Ownership is carried directly on the workflow item and can also move through explicit handoff acceptance.

## File Map

- `src/types.ts`
- `server/types.ts`
- `server/workflow.ts`
- `server/server.ts`
- `src/ui/overlay.ts`
