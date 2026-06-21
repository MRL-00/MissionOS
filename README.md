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
- `server/data/missionos.db` - generated local SQLite database

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
- `pnpm start` - run the built production server after `pnpm build`
- `pnpm preview` - preview the production frontend build
- `pnpm typecheck` - type-check client and server code
- `pnpm test:client` - run client tests
- `pnpm test:server` - run server tests
- `pnpm test` - run client and server tests
- `pnpm clean:test-data` - remove isolated SQLite databases created by test and smoke runs
- `pnpm smoke:production` - start the built production server and verify app shell plus health endpoint
- `pnpm smoke:docker` - run a built Docker image and verify app shell plus health endpoint
- `pnpm smoke:compose` - run Docker Compose and verify SQLite data persists after service restart
- `pnpm smoke:target` - verify a deployed target URL with existing team credentials
- `pnpm release:check` - run typecheck, tests, production build, production smoke, and dependency audit
- `pnpm release:docker` - validate Compose config, build/smoke test the image, and verify Compose volume persistence
- `pnpm db:backup` - create a consistent SQLite backup under `backups/`
- `pnpm db:restore <backup-file> --force` - restore a SQLite backup after MissionOS has been stopped
- `pnpm db:reset` - reset the local SQLite database and SQLite sidecar files

## Configuration

MissionOS works locally without external providers, but mission-control and integration features can use additional server-side environment variables.

Common integration variables:

- `JWT_SECRET` - required when `NODE_ENV=production`; use a random value at least 32 characters long
- `CORS_ALLOWED_ORIGINS` - comma-separated browser origins allowed to call the API; production defaults to same-origin only
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

## Production Run

```bash
pnpm build
JWT_SECRET=replace-with-a-long-random-secret pnpm start
```

The production server serves both the Express API and the built React app from the same port.

Docker deployments run the same built server on port `3001` by default:

```bash
JWT_SECRET=replace-with-a-long-random-secret docker compose up -d --build
```

The compose volume is mounted at `/app/server/data`, where the SQLite database is created.
Set `MISSIONOS_HOST` and `MISSIONOS_PORT` to change the host bind without changing the container port.
For the existing polling deploy script, set `JWT_SECRET` in the shell or compose `.env`, then run `scripts/deploy.sh`. The script validates compose config, rebuilds the service, and waits for `/api/health` before recording the deploy as successful.
Local SQLite files under `server/data/` are excluded from Docker build contexts and should never be baked into images.

Before a release, run:

```bash
pnpm release:check
pnpm release:docker
```

The same release gates run in GitHub Actions on pull requests and pushes to `main` or `master`. The Docker gate uses an isolated Compose project and random localhost port for the persistence smoke.

Then complete the team acceptance checklist in [Go-live checklist](./docs/go-live-checklist.md) against the target environment.
Use the [Team rollout runbook](./docs/team-rollout-runbook.md) to coordinate the first team session, monitoring, and rollback decision.
For the deployed production smoke, run:

```bash
MISSIONOS_TARGET_URL=https://missionos.example \
MISSIONOS_TARGET_USERNAME=your-user \
MISSIONOS_TARGET_PASSWORD=your-password \
pnpm smoke:target
```

## Data Model

MissionOS stores application state in SQLite at `server/data/missionos.db`. Resetting the project from Settings or running `pnpm db:reset` returns the app to first-run state.
Run `pnpm db:backup` before production upgrades or destructive maintenance.
To roll back data, stop MissionOS, run `pnpm db:restore <backup-file> --force`, then start MissionOS again.

## Documentation

- [Getting started](./docs/getting-started.md)
- [Agents](./docs/agents.md)
- [Missions](./docs/missions.md)
- [Mission control](./docs/mission-control.md)
- [Settings](./docs/settings.md)
- [Runtime bridge](./docs/runtime-bridge.md)
- [Workflow architecture](./docs/workflow-architecture.md)
- [Go-live checklist](./docs/go-live-checklist.md)
- [Team rollout runbook](./docs/team-rollout-runbook.md)
