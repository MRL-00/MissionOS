import type { EngineDefinition } from "./engines/types.js";

export const MASKED_SECRET_VALUE = "__missionos_configured_secret__";

type EngineLookup = { get(engineId: string): EngineDefinition | undefined };

function parseObjectConfig(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function passwordFieldKeys(engineId: string, engines: EngineLookup): string[] {
  return engines.get(engineId)?.fields.filter((field) => field.type === "password").map((field) => field.key) ?? [];
}

export function maskEngineConfig(engineId: string, config: Record<string, unknown>, engines: EngineLookup): Record<string, unknown> {
  const passwordKeys = new Set(passwordFieldKeys(engineId, engines));
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key,
      passwordKeys.has(key) && typeof value === "string" && value ? MASKED_SECRET_VALUE : value,
    ]),
  );
}

export function mergeMaskedEngineConfig(
  engineId: string,
  nextConfig: Record<string, unknown>,
  existingConfig: Record<string, unknown>,
  engines: EngineLookup,
): Record<string, unknown> {
  const passwordKeys = new Set(passwordFieldKeys(engineId, engines));
  return Object.fromEntries(
    Object.entries(nextConfig).map(([key, value]) => [
      key,
      passwordKeys.has(key) && value === MASKED_SECRET_VALUE ? existingConfig[key] ?? "" : value,
    ]),
  );
}

export function sanitizeSettingsMap(settings: Record<string, string>, engines: EngineLookup): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => {
      const engineMatch = /^engine\.(.+)$/u.exec(key);
      if (!engineMatch?.[1] || !value) {
        return [key, value];
      }

      const parsed = parseObjectConfig(value);
      if (!parsed) {
        return [key, value];
      }

      return [key, JSON.stringify(maskEngineConfig(engineMatch[1], parsed, engines))];
    }),
  );
}

export function normalizeSettingsSecretsForSave(
  settings: Array<{ key: string; value: string }>,
  existingSettings: Record<string, string>,
  engines: EngineLookup,
): Array<{ key: string; value: string }> {
  return settings.map((setting) => {
    const engineMatch = /^engine\.(.+)$/u.exec(setting.key);
    if (!engineMatch?.[1]) {
      return setting;
    }

    const nextConfig = parseObjectConfig(setting.value);
    const existingConfig = parseObjectConfig(existingSettings[setting.key] ?? "");
    if (!nextConfig || !existingConfig) {
      return setting;
    }

    return {
      ...setting,
      value: JSON.stringify(mergeMaskedEngineConfig(engineMatch[1], nextConfig, existingConfig, engines)),
    };
  });
}
