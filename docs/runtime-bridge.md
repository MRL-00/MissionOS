# Desktop Runtime Bridge

This setup lets a hosted office UI still drive local tooling on a specific PC per character.

## What changed

- The browser can now override the office API target at runtime instead of always assuming `current-host:3001`.
- Each character backend link can now store:
  - a `runtimeTarget.baseUrl`
  - an optional `runtimeTarget.launchProfile`
- `/api/agent/spawn` now forwards to that runtime target when one is configured.
- A new local bridge script can run on a PC and launch provider-specific commands:
  - `pnpm dev:bridge`

## Office API target

If the UI is hosted on Vercel / Cloudflare, use the new `Server` button in the top bar and point it at the desktop office server, for example:

- `http://192.168.1.20:3001`
- `https://office-box.example.com`

This value is stored in browser local storage. You can also override it with the query param:

- `?officeApi=http://192.168.1.20:3001`

## Character runtime target

In Character Creator -> `Backend Link`, linked providers now support:

- `PC Bridge URL`
- `Launch Profile`

Example:

- Provider: `Codex`
- PC Bridge URL: `http://192.168.1.42:3012`
- Launch Profile: `zoe-codex`

When that character is spawned through `/api/agent/spawn`, the office server will call:

- `POST <PC Bridge URL>/api/office/spawn`

## Running the bridge on a PC

Start the bridge on the machine that should launch local tools:

```bash
pnpm dev:bridge
```

Environment variables:

- `AGENT_BRIDGE_HOST`
- `AGENT_BRIDGE_PORT`
- `AGENT_BRIDGE_CWD`
- `AGENT_BRIDGE_OPENCLAW_COMMAND`
- `AGENT_BRIDGE_HERMES_COMMAND`
- `AGENT_BRIDGE_CLAUDE_COMMAND`
- `AGENT_BRIDGE_CODEX_COMMAND`

The bridge launches the configured command for the chosen provider with these environment variables available:

- `OFFICE_AGENT_ID`
- `OFFICE_AGENT_NAME`
- `OFFICE_AGENT_ROLE`
- `OFFICE_PROVIDER`
- `OFFICE_PROVIDER_AGENT_ID`
- `OFFICE_TOKEN_ID`
- `OFFICE_TASK`
- `OFFICE_MESSAGE`
- `OFFICE_LAUNCH_PROFILE`

Example:

```bash
export AGENT_BRIDGE_CODEX_COMMAND='codex --profile "$OFFICE_LAUNCH_PROFILE" "$OFFICE_TASK"'
export AGENT_BRIDGE_CLAUDE_COMMAND='claude --print "$OFFICE_TASK"'
export AGENT_BRIDGE_HERMES_COMMAND='hermes-agent run --profile "$OFFICE_LAUNCH_PROFILE" "$OFFICE_TASK"'
pnpm dev:bridge
```

## Important deployment note

If the UI is served over `https://`, browsers may block plain `http://` calls to a LAN IP as mixed content. In that case, expose the office API / bridge over HTTPS or use a secure tunnel such as Tailscale, Caddy, or another reverse proxy that gives the desktop machine a trusted HTTPS endpoint.
