# Team rollout runbook

Use this runbook after the automated go-live gates pass and before announcing MissionOS to the whole team.

## Owner

Assign one release owner for the rollout window. That person records the acceptance evidence, watches logs, and decides whether to proceed or roll back.

## Before announcement

1. Confirm `pnpm release:check` and `pnpm release:docker` passed for the release commit.
2. Confirm `pnpm smoke:target` passed against the deployed URL with representative team credentials.
3. Capture the release commit, target URL, backup file, and restore rehearsal result in the acceptance record from [Go-live checklist](./go-live-checklist.md).
4. Confirm production `JWT_SECRET`, CORS, Docker volume, and SQLite backup settings match the go-live checklist.
5. Verify the team knows the target URL, login path, support contact, and rollback window.

## First team session

Validate these workflows with real users and real repositories or provider projects:

1. Sign in, sign out, and sign in again.
2. Save profile and engine settings, then reload and confirm secrets remain masked.
3. Test each engine connection the team intends to use.
4. Create or edit an agent, deactivate it, and reactivate it.
5. Create a mission, staff it with a lead and team members, and start it.
6. Confirm run output streams in the UI and appears in run history.
7. Create, update, filter, and delete an issue.
8. Import from Linear if Linear will be used.
9. Verify GitHub repository access if GitHub automation will be used.
10. Create a schedule, trigger it manually, and verify linked run history.
11. Search for an agent, mission, issue, and run.
12. Open documentation and submit Help feedback.

## Monitoring

During the rollout window:

1. Watch server logs for unexpected errors.
2. Watch browser console output on at least one team machine.
3. Confirm SQLite file size and WAL growth are reasonable for the test data volume.
4. Keep the latest successful backup path available.

## Rollback

Rollback if sign-in, mission start, run streaming, issue management, or data persistence fails for representative users.

1. Stop MissionOS.
2. Restore the last known-good backup with `pnpm db:restore <backup-file> --force` or the host-level equivalent.
3. Redeploy the previous known-good commit or Docker image.
4. Run `pnpm smoke:target` again before reopening access.
5. Record the incident, owner, impact, and next action in the acceptance record.
