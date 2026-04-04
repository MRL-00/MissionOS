import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { afterEach, test } from "node:test";
import {
  createAgentStateWatcher,
  readHermesAgentStateSnapshot,
  type HermesAgentStateSnapshot,
} from "./adapters/agent-state-watcher";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "office-agent-state-"));
  tempDirs.push(dir);
  return dir;
}

async function writeAtomically(filePath: string, payload: unknown): Promise<void> {
  const tempPath = `${filePath}.${Date.now().toString(36)}.tmp`;
  await writeFile(tempPath, typeof payload === "string" ? payload : JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, filePath);
}

async function waitForSnapshot(
  snapshots: HermesAgentStateSnapshot[],
  predicate: (snapshot: HermesAgentStateSnapshot) => boolean,
  timeoutMs = 5_000,
): Promise<HermesAgentStateSnapshot> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const match = snapshots.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for watcher snapshot.");
}

test("readHermesAgentStateSnapshot returns idle defaults when file is missing", async () => {
  const dir = await createTempDir();
  const filePath = path.join(dir, "agent-state.json");

  const snapshot = await readHermesAgentStateSnapshot(filePath);

  assert.equal(snapshot.exists, false);
  assert.equal(snapshot.empty, true);
  assert.deepEqual(
    snapshot.agents.map((agent) => [agent.externalId, agent.status]),
    [
      ["atlas", "idle"],
      ["hermes", "idle"],
      ["orbit", "idle"],
      ["scout", "idle"],
    ],
  );
});

test("readHermesAgentStateSnapshot accepts generic working status payloads", async () => {
  const dir = await createTempDir();
  const filePath = path.join(dir, "agent-state.json");

  await writeAtomically(filePath, {
    hermes: {
      status: "working",
      ticket: null,
      stage: "chatting on Telegram",
      since: "2026-03-31T04:46:10.646116+00:00",
    },
  });

  const snapshot = await readHermesAgentStateSnapshot(filePath);
  const hermes = snapshot.agents.find((agent) => agent.externalId === "hermes");

  assert.ok(hermes);
  assert.equal(hermes.status, "working");
  assert.equal(hermes.activityStatus, undefined);
  assert.equal(hermes.taskStage, "chatting on Telegram");
});

test("createAgentStateWatcher emits initial state and survives atomic replace recreation", async () => {
  const dir = await createTempDir();
  const profilesDir = path.join(dir, "profiles");
  await mkdir(profilesDir, { recursive: true });
  const filePath = path.join(profilesDir, "agent-state.json");

  await writeAtomically(filePath, {
    hermes: {
      status: "building",
      ticket: "EPIC-555",
      stage: "implementing backend",
      since: "2026-03-31T14:30:00Z",
    },
  });

  const snapshots: HermesAgentStateSnapshot[] = [];
  const watcher = createAgentStateWatcher({
    debounceMs: 50,
    filePath,
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot);
    },
  });

  try {
    await watcher.start();

    const initial = await waitForSnapshot(
      snapshots,
      (snapshot) => snapshot.agents.some((agent) => agent.externalId === "hermes" && agent.currentTicket === "EPIC-555"),
    );
    const initialHermes = initial.agents.find((agent) => agent.externalId === "hermes");
    assert.ok(initialHermes);
    assert.equal(initialHermes.activityStatus, "building");
    assert.equal(initialHermes.taskStage, "implementing backend");

    await writeAtomically(filePath, {
      hermes: {
        status: "reviewing",
        ticket: "EPIC-555",
        stage: "reviewing API changes",
        since: "2026-03-31T15:00:00Z",
      },
      scout: {
        status: "idle",
        ticket: null,
        stage: null,
        since: null,
      },
    });

    const updated = await waitForSnapshot(
      snapshots,
      (snapshot) => snapshot.agents.some((agent) => agent.externalId === "hermes" && agent.activityStatus === "reviewing"),
    );
    const updatedHermes = updated.agents.find((agent) => agent.externalId === "hermes");
    assert.ok(updatedHermes);
    assert.equal(updatedHermes.taskStage, "reviewing API changes");

    await rm(filePath, { force: true });
    await new Promise((resolve) => setTimeout(resolve, 100));

    await writeAtomically(filePath, {
      hermes: {
        status: "approved",
        ticket: "EPIC-555",
        stage: "ready to merge",
        since: "2026-03-31T15:15:00Z",
      },
    });

    const recreated = await waitForSnapshot(
      snapshots,
      (snapshot) => snapshot.agents.some((agent) => agent.externalId === "hermes" && agent.activityStatus === "approved"),
    );
    const recreatedHermes = recreated.agents.find((agent) => agent.externalId === "hermes");
    assert.ok(recreatedHermes);
    assert.equal(recreatedHermes.currentTicket, "EPIC-555");
    assert.equal(recreatedHermes.status, "idle");
  } finally {
    watcher.stop();
  }
});
