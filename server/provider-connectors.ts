import { getAdapter } from "./adapters/registry";
import type { AdapterModule, AdapterType } from "./adapters/types";
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

type AdapterLookup = (type: AdapterType) => AdapterModule | undefined;

async function syncHermes(connector: ProviderConnectorSyncConfig, lookupAdapter: AdapterLookup): Promise<ProviderSyncResult> {
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

  const adapter = lookupAdapter("hermes");
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

async function syncGenericConnector(connector: ProviderConnectorSyncConfig, lookupAdapter: AdapterLookup): Promise<ProviderSyncResult> {
  if (!connector.enabled) {
    return {
      health: {
        provider: connector.provider,
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

  const adapter = lookupAdapter(connector.provider);
  if (!adapter) {
    return {
      health: {
        provider: connector.provider,
        status: "error",
        checkedAt: Date.now(),
        activeAgents: 0,
        schedules: 0,
        message: `${connector.label} adapter not registered.`,
      },
      agents: [],
      schedules: [],
    };
  }

  const config: Record<string, unknown> = {
    ...connector.adapterConfig,
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
        provider: connector.provider,
        status: "error",
        checkedAt: Date.now(),
        latencyMs: testResult.latencyMs ?? (Date.now() - startedAt),
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

  return {
    health: {
      provider: connector.provider,
      status: "ok",
      checkedAt: Date.now(),
      latencyMs: testResult.latencyMs ?? (Date.now() - startedAt),
      message: testResult.message,
      activeAgents: agents.filter((agent) => isProviderAgentActivelyExecuting(agent)).length,
      schedules: schedules.length,
    },
    agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
    schedules,
  };
}

export async function syncProviderConnectorWithLookup(
  connector: ProviderConnectorSyncConfig,
  lookupAdapter: AdapterLookup,
): Promise<ProviderSyncResult> {
  if (connector.provider === "hermes") {
    return syncHermes(connector, lookupAdapter);
  }
  return syncGenericConnector(connector, lookupAdapter);
}

export async function syncProviderConnector(connector: ProviderConnectorSyncConfig): Promise<ProviderSyncResult> {
  return syncProviderConnectorWithLookup(connector, getAdapter);
}
