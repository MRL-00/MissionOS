# Mission Control

This build turns the office into a local-first mission-control surface with:

- a React + Tailwind control-room shell
- a tile-authored mission map with named zones and slot-based agent placement
- provider connectors for OpenClaw and Hermes Agent
- a Linear-backed task board
- imported provider schedules

## Runtime configuration

Set these on the office server or Docker/Dokploy deployment:

- `OPENCLAW_URL`
- `OPENCLAW_TOKEN`
- `HERMES_URL`
- `HERMES_WS_URL`
- `HERMES_RUNTIME_URL`
- `HERMES_TOKEN`
- `LINEAR_API_URL`
- `LINEAR_API_KEY`
- `LINEAR_SYNC_INTERVAL_MS`

Provider URLs and sync cadence can also be edited in the UI under `Settings`, but secrets stay server-side.

## Data persistence

Mission-control state is stored in `/app/data` and now includes:

- `agents.json`
- `workflow.json`
- `mission-control.json`

`mission-control.json` persists connector settings and task handoffs. Agent appearance, desk placement, and linked provider metadata continue to live in `agents.json`.

## Connector model

OpenClaw and Hermes are treated as provider adapters with a shared shape:

- health
- discovered agents
- active work
- schedules
- runtime bridge target

The UI never stores provider secrets. Connector health, imported schedules, and staged provider agents are exposed through `/api/mission`.

## Linear sync

Mission-control task data now syncs against Linear’s GraphQL API from the server.

- task list comes from Linear
- task updates write through to Linear
- new comments write through to Linear
- handoffs remain office-local and are persisted in `mission-control.json`

Polling is the required sync path so local Docker, Dokploy, and Tailscale-hosted setups work without public webhooks.

## Local network and Tailscale

For LAN or Tailscale deployments:

- use `http://<ip>:3001` or a Tailscale HTTPS URL for the office API
- set connector base URLs to the OpenClaw/Hermes machine addresses
- set runtime bridge URLs to the machine that should launch the provider locally

If the frontend is served over `https://`, plain `http://` connector calls may be blocked by the browser as mixed content. In that case:

- expose the office API and connector endpoints through HTTPS, or
- access them through Tailscale HTTPS / a reverse proxy

## Runtime bridge

The local launcher bridge now supports:

- `AGENT_BRIDGE_OPENCLAW_COMMAND`
- `AGENT_BRIDGE_HERMES_COMMAND`
- `AGENT_BRIDGE_CLAUDE_COMMAND`
- `AGENT_BRIDGE_CODEX_COMMAND`

Run it with:

```bash
pnpm dev:bridge
```

The office server can forward provider-linked launches to the bridge using the configured runtime bridge URL.
