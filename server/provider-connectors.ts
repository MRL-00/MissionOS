import { getAdapter } from "./adapters/registry";
import { isProviderAgentActivelyExecuting } from "../src/mission/providerAgents";
import type {
  ProviderAgentRecord,
  ProviderConnector,
  ProviderHealth,
  ProviderScheduleEntry,
} from "../src/mission/types";

export interface ProviderConnectorSyncConfig extends ProviderConnector {
  token?: string | undefined;
}

export interface ProviderSyncResult {
  health: ProviderHealth;
  agents: ProviderAgentRecord[];
  schedules: ProviderScheduleEntry[];
}

async function syncHermes(connector: ProviderConnectorSyncConfig): Promise<ProviderSyncResult> {
  if (!connector.enabled || !connector.baseUrl) {
    return {
      health: {
        provider: "hermes",
        status: "disabled",
        checkedAt: Date.now(),
        activeAgents: 0,
        schedules: 0,
        message: "Connector disabled.",
      },
      agents: [],
      schedules: [],
    };
  }

  const adapter = getAdapter("hermes");
  if (!adapter) {
    return {
      health: {
        provider: "hermes",
        status: "error",
        checkedAt: Date.now(),
        activeAgents: 0,
        schedules: 0,
        message: "Hermes adapter not registered.",
      },
      agents: [],
      schedules: [],
    };
  }

  const config: Record<string, unknown> = {
    baseUrl: connector.baseUrl,
    websocketUrl: connector.websocketUrl,
    runtimeBaseUrl: connector.runtimeBaseUrl,
    token: connector.token,
  };

  const startedAt = Date.now();
  const testResult = await adapter.testConnection(config);
  if (!testResult.ok) {
    return {
      health: {
        provider: "hermes",
        status: "error",
        checkedAt: Date.now(),
        latencyMs: Date.now() - startedAt,
        activeAgents: 0,
        schedules: 0,
        message: testResult.message,
      },
      agents: [],
      schedules: [],
    };
  }

  const [agents, schedules] = await Promise.all([
    (adapter.syncOrg?.(config) ?? adapter.syncAgents(config)),
    adapter.syncSchedules?.(config) ?? [],
  ]);

  const health: ProviderHealth = {
    provider: "hermes",
    status: "ok",
    checkedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
    message: `Hermes synced ${agents.length} agent${agents.length === 1 ? "" : "s"} and ${schedules.length} schedule${schedules.length === 1 ? "" : "s"}.`,
    activeAgents: agents.filter((agent) => isProviderAgentActivelyExecuting(agent)).length,
    schedules: schedules.length,
  };

  return {
    health,
    agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
    schedules,
  };
}

export async function syncProviderConnector(connector: ProviderConnectorSyncConfig): Promise<ProviderSyncResult> {
  return syncHermes(connector);
}
