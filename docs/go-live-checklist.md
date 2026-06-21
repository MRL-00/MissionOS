# Go-live checklist

Use this checklist before making MissionOS available to the whole team. The automated release gate proves the codebase builds, tests, and has no known dependency vulnerabilities; the acceptance checks prove the target environment and team workflows are ready.

## Automated gate

Run from the repository root:

```bash
pnpm release:check
pnpm release:docker
```

These must pass without skipped local dependency setup:

- client and server type checking
- client and server tests
- production client and server build
- production app shell and health endpoint smoke test
- dependency vulnerability audit
- Docker Compose validation, Docker image build, Docker image smoke, and Compose volume persistence smoke

## Production configuration

- `NODE_ENV=production` is set for the deployed server.
- `JWT_SECRET` is set to a random value at least 32 characters long.
- `PORT` is set to the intended production port.
- `CORS_ALLOWED_ORIGINS` is either omitted for same-origin production use or explicitly limited to trusted team origins.
- The production SQLite directory is backed up and not committed to git.
- `pnpm db:backup` has been run, or an equivalent host-level SQLite backup exists.
- A rollback restore has been rehearsed with `pnpm db:restore <backup-file> --force` or an equivalent host-level restore.
- The production host can write to `server/data/`.
- Docker deployments expose the single production server port and persist `/app/server/data`.
- Docker images do not include local SQLite files from `server/data/`.

## Smoke test

After deployment:

- The root URL serves the MissionOS app shell.
- `GET /api/health` returns `{"ok":true}`.
- `pnpm smoke:target` passes with representative team credentials:
  `MISSIONOS_TARGET_URL=https://missionos.example MISSIONOS_TARGET_USERNAME=<user> MISSIONOS_TARGET_PASSWORD=<password> pnpm smoke:target`
- First-run setup creates the local account and project.
- A seeded or newly created user can sign in, sign out, and sign in again.
- Browser console and server logs stay free of unexpected errors during the smoke path.

## Team workflow acceptance

Validate these with representative team credentials and repositories:

- Create, edit, deactivate, and reactivate an agent.
- Save engine configuration and verify masked secrets are not exposed after reload.
- Test each engine connection the team intends to use.
- Create a mission with a lead agent and assigned team members.
- Start a mission and verify run output streams to the UI.
- Create, update, filter, and delete issues.
- Import issues from Linear if Linear is used by the team.
- Configure GitHub settings and verify repository access if GitHub automation is used.
- Create a schedule, trigger it manually, and verify run history is linked correctly.
- Use search to find agents, missions, issues, and runs.
- Open documentation and submit feedback from Help.
- Reset or wipe a non-production test project and confirm first-run setup returns with SQLite sidecar files removed.

## Release decision

Do not approve go-live until:

- `pnpm release:check` passes on the release branch.
- `pnpm release:docker` passes for the release image.
- The deployed production smoke test passes.
- Every team workflow acceptance item relevant to the team is checked off.
- Any known exceptions are documented with owner, impact, and rollback plan.

## Acceptance record

Capture one record for the release candidate before announcing availability to the team:

```md
Release:
Commit:
Environment:
Reviewer:
Date:

Automated gate:
- pnpm release:check:
- pnpm release:docker:

Target environment:
- URL:
- Host:
- NODE_ENV:
- Data directory:
- Backup file:
- Restore rehearsal:

Team workflows:
- Account/project setup:
- Agent CRUD and engine config:
- Intended engine connection tests:
- Mission creation and run streaming:
- Issue CRUD and filtering:
- Linear import/sync:
- GitHub repository access:
- Schedules and run history:
- Search:
- Docs and feedback:
- Project reset on non-production data:

Exceptions:
- None, or owner/impact/rollback plan:
```
