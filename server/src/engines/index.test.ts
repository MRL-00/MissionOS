import assert from "node:assert/strict";
import test from "node:test";
import { engineAdapters, engineMap } from "./index.js";

test("engineMap registers every engine adapter by id", () => {
  const adapterIds = engineAdapters.map((adapter) => adapter.id);

  assert.deepEqual([...engineMap.keys()], adapterIds);
  assert.equal(new Set(adapterIds).size, adapterIds.length);
  assert.deepEqual(adapterIds, ["codex", "cursor", "claude-code", "openclaw", "pi", "hermes"]);
});
