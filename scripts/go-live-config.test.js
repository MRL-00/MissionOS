import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function readRepoFile(filePath) {
  return readFileSync(path.join(repoRoot, filePath), "utf8");
}

test("release scripts keep all go-live gates wired together", () => {
  const packageJson = JSON.parse(readRepoFile("package.json"));

  assert.equal(
    packageJson.scripts["release:check"],
    "pnpm check:scripts && pnpm typecheck && pnpm test && pnpm build && pnpm smoke:production && pnpm audit",
  );
  assert.match(packageJson.scripts["release:docker"], /docker compose config --quiet/u);
  assert.match(packageJson.scripts["release:docker"], /docker build/u);
  assert.match(packageJson.scripts["release:docker"], /pnpm smoke:docker/u);
  assert.match(packageJson.scripts["release:docker"], /pnpm smoke:compose/u);
  assert.equal(packageJson.scripts["smoke:target"], "node scripts/target-smoke.js");
});

test("GitHub release workflow runs the same local release gates", () => {
  const workflow = readRepoFile(".github/workflows/release-check.yml");

  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
  assert.match(workflow, /pnpm release:check/u);
  assert.match(workflow, /pnpm release:docker/u);
});

test("Docker release configuration keeps SQLite data out of images and in a persisted volume", () => {
  const dockerignore = readRepoFile(".dockerignore");
  const gitignore = readRepoFile(".gitignore");
  const compose = readRepoFile("docker-compose.yml");
  const dockerfile = readRepoFile("Dockerfile");
  const dbSource = readRepoFile("server/src/db.ts");

  assert.match(dockerignore, /^server\/data$/mu);
  assert.match(gitignore, /^server\/data\/\*$/mu);
  assert.match(gitignore, /^backups\/$/mu);
  assert.match(compose, /office-data:\/app\/server\/data/u);
  assert.match(compose, /JWT_SECRET=\$\{JWT_SECRET:\?JWT_SECRET must be set for production\}/u);
  assert.match(dockerfile, /COPY --from=build \/app\/server\/dist \.\/server\/dist/u);
  assert.doesNotMatch(dockerfile, /COPY --from=build \/app\/server \.\/server/u);
  assert.match(dbSource, /mkdirSync\(dataDir, \{ recursive: true \}\)/u);
});

test("repository does not track local SQLite data files", () => {
  const result = spawnSync("git", ["ls-files", "server/data"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "");
});

test("go-live checklist requires automated gates, production smoke, team acceptance, and evidence capture", () => {
  const checklist = readRepoFile("docs/go-live-checklist.md");
  const readme = readRepoFile("README.md");

  assert.match(checklist, /pnpm release:check/u);
  assert.match(checklist, /pnpm release:docker/u);
  assert.match(checklist, /pnpm smoke:target/u);
  assert.match(checklist, /deployed production smoke test passes/u);
  assert.match(checklist, /Every team workflow acceptance item/u);
  assert.match(checklist, /Acceptance record/u);
  assert.match(checklist, /Backup file:/u);
  assert.match(checklist, /Restore rehearsal:/u);
  assert.match(checklist, /Exceptions:/u);
  assert.match(readme, /Team rollout runbook/u);
});

test("team rollout runbook covers first-session workflows, monitoring, and rollback", () => {
  const runbook = readRepoFile("docs/team-rollout-runbook.md");

  assert.match(runbook, /pnpm smoke:target/u);
  assert.match(runbook, /First team session/u);
  assert.match(runbook, /Test each engine connection/u);
  assert.match(runbook, /Import from Linear/u);
  assert.match(runbook, /GitHub repository access/u);
  assert.match(runbook, /Watch server logs/u);
  assert.match(runbook, /Rollback/u);
  assert.match(runbook, /pnpm db:restore <backup-file> --force/u);
});

test("release smoke scripts cover mission and issue lifecycle workflows", () => {
  for (const scriptPath of ["scripts/production-smoke.js", "scripts/docker-smoke.js"]) {
    const smokeScript = readRepoFile(scriptPath);

    assert.match(smokeScript, /\/api\/engines\/codex\/test/u, scriptPath);
    assert.match(smokeScript, /\/api\/agents\/\$\{encodeURIComponent\(agent\.agent\.id\)\}\/test/u, scriptPath);
    assert.match(smokeScript, /\/api\/missions\/\$\{encodeURIComponent\(mission\.mission\.id\)\}\/start/u, scriptPath);
    assert.match(smokeScript, /Begin planning/u, scriptPath);
    assert.match(smokeScript, /\/api\/issues\/\$\{encodeURIComponent\(issue\.issue\.id\)\}/u, scriptPath);
    assert.match(smokeScript, /status=in_progress&priority=high/u, scriptPath);
    assert.match(smokeScript, /method: "DELETE"/u, scriptPath);
    assert.match(smokeScript, /status: "complete"/u, scriptPath);
  }
});

test("target smoke refuses missing credentials and covers deployed read paths", () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "target-smoke.js")], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {},
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MISSIONOS_TARGET_URL/u);

  const smokeScript = readRepoFile("scripts/target-smoke.js");
  assert.match(smokeScript, /\/api\/health/u);
  assert.match(smokeScript, /\/api\/auth\/login/u);
  assert.match(smokeScript, /\/api\/auth\/me/u);
  assert.match(smokeScript, /\/api\/project/u);
  assert.match(smokeScript, /\/api\/engines/u);
  assert.match(smokeScript, /\/api\/agents\?limit=1/u);
  assert.match(smokeScript, /\/api\/missions\?limit=1/u);
  assert.match(smokeScript, /\/api\/issues\?limit=1/u);
  assert.match(smokeScript, /\/api\/schedules\?limit=1/u);
  assert.match(smokeScript, /\/api\/docs\/tree/u);
});

test("environment template includes target smoke credentials", () => {
  const envExample = readRepoFile(".env.example");

  assert.match(envExample, /^MISSIONOS_TARGET_URL=/mu);
  assert.match(envExample, /^MISSIONOS_TARGET_USERNAME=/mu);
  assert.match(envExample, /^MISSIONOS_TARGET_PASSWORD=/mu);
});

test("deploy script validates compose config and MissionOS health payload before recording success", () => {
  const deployScript = readRepoFile("scripts/deploy.sh");

  assert.match(deployScript, /docker compose config --quiet/u);
  assert.match(deployScript, /docker compose up -d --build/u);
  assert.match(deployScript, /grep -q '"ok":true'/u);
  assert.match(deployScript, /printf "%s\\n%s\\n" "\$DEPLOY_DATE" "\$DEPLOY_SEQUENCE" > "\$STATE_FILE"/u);
});
