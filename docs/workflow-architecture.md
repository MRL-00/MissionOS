# Office Workflow Pipeline Architecture

The previous realtime office backend that lived under root-level `server/*.ts` has been removed.

The active backend now lives entirely in `server/src/`:

- entrypoint: `server/src/index.ts`
- database bootstrap: `server/src/db.ts`
- route registration: `server/src/routes/*.ts`
- run orchestration: `server/src/execution.ts`
- scheduling loop: `server/src/scheduling.ts`

If this document needs a deeper workflow architecture write-up, regenerate it against the current `server/src` implementation rather than the removed legacy stack.
