# Workflow Foundation Follow-ups

- Replace stored Linear/GitHub mirrors with real sync adapters and reconcile drift explicitly.
- Add authentication around workflow mutation endpoints; role checks currently trust the request body actor.
- Add workflow-focused integration tests for current-sprint rejection, Linear comment permissions, QA auto-triggering, and handoff acceptance.
- Decide whether the frontend should render workflow snapshots directly instead of relying mainly on activity log visibility.
- Add retention/pruning rules for `data/workflow.json` event history.
- Add idempotency keys for external webhook-driven updates.
- Model richer GitHub merge truth if `merged_ready` should require merged commit state rather than just PR reference presence.
