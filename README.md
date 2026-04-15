# MissionOS

MissionOS is a local-first multi-agent orchestration platform with a React + Vite frontend, an Express API, and SQLite persistence. It is built for running missions, coordinating agents, tracking issues, and reviewing execution history from a single control surface.

## Stack

- React 19 + Vite + TypeScript
- Tailwind CSS v4
- Express 5
- SQLite via `better-sqlite3`
- `pnpm`

## Core Areas

- Missions coordinate goal-level work across agents.
- Agents define execution engines, prompt scaffolding, skills, and runtime config.
- Issues track work in list or board mode.
- Runs capture live execution output and mission history.
- Settings manage the local profile, engine config, and integrations.

## Project Structure

- `src/` - React frontend
- `server/src/` - Express backend
- `docs/` - product and architecture docs
- `public/assets/` - static assets
- `server/data/missionos.db` - local SQLite database

## Local Development

### Requirements

- Node.js
- `pnpm`

### Start the app

```bash
pnpm install
pnpm dev
```

This starts:

- the Vite client on `http://localhost:5173`
- the Express API on `http://localhost:3001`

MissionOS boots into a first-run flow:

1. Create the first local account.
2. Create the singleton project.
3. Onboard the first agent.
4. Land on the dashboard and org chart.

## Scripts

- `pnpm dev` - run frontend and backend together
- `pnpm dev:client` - run the Vite frontend
- `pnpm dev:server` - run the Express backend in watch mode
- `pnpm build` - build the frontend and backend
- `pnpm preview` - preview the production frontend build
- `pnpm typecheck` - type-check client and server code
- `pnpm test:client` - run client tests
- `pnpm test` - alias for `pnpm test:client`
- `pnpm db:reset` - reset the local SQLite database

## Configuration

MissionOS works locally without external providers, but mission-control and integration features can use additional server-side environment variables.

Common integration variables:

- `OPENCLAW_URL`
- `OPENCLAW_TOKEN`
- `HERMES_URL`
- `HERMES_WS_URL`
- `HERMES_RUNTIME_URL`
- `HERMES_TOKEN`
- `LINEAR_API_URL`
- `LINEAR_API_KEY`
- `LINEAR_SYNC_INTERVAL_MS`

The server listens on `PORT`, which defaults to `3001`.

## Data Model

MissionOS stores application state in SQLite at `server/data/missionos.db`. Resetting the project from Settings or running `pnpm db:reset` returns the app to first-run state.

## Documentation

- [Getting started](./docs/getting-started.md)
- [Agents](./docs/agents.md)
- [Missions](./docs/missions.md)
- [Mission control](./docs/mission-control.md)
- [Settings](./docs/settings.md)
- [Runtime bridge](./docs/runtime-bridge.md)
- [Workflow architecture](./docs/workflow-architecture.md)
