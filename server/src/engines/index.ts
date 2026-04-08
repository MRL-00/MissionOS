import { claudeCodeAdapter } from "./claude.js";
import { codexAdapter, cursorAdapter } from "./codex.js";
import { hermesAdapter, openclawAdapter, piAdapter } from "./remote.js";
import type { EngineAdapter } from "./types.js";

export const engineAdapters: EngineAdapter[] = [
  codexAdapter,
  cursorAdapter,
  claudeCodeAdapter,
  openclawAdapter,
  piAdapter,
  hermesAdapter,
];

export const engineMap = new Map(engineAdapters.map((adapter) => [adapter.id, adapter]));
