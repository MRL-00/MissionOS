import type { AdapterModule, AdapterType } from "./types";
import { hermesAdapter } from "./hermes";
import { claudeLocalAdapter } from "./claude-local";
import { codexLocalAdapter } from "./codex-local";

const adapters = new Map<AdapterType, AdapterModule>();

export function registerAdapter(adapter: AdapterModule): void {
  adapters.set(adapter.type, adapter);
}

export function getAdapter(type: AdapterType): AdapterModule | undefined {
  return adapters.get(type);
}

export function listAdapters(): AdapterModule[] {
  return Array.from(adapters.values());
}

export function initializeAdapters(): void {
  registerAdapter(hermesAdapter);
  registerAdapter(claudeLocalAdapter);
  registerAdapter(codexLocalAdapter);
}
