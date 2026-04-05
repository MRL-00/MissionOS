type PricingProfile = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

type AgentConfigLike = {
  engine: string;
  connection_config?: Record<string, unknown>;
};

type RunLike = {
  engine: string;
  prompt: string;
  output: string;
};

type SettingsLike = Record<string, string>;

const DEFAULT_USD_EXCHANGE_RATE: Record<string, number> = {
  USD: 1,
  NZD: 1.65,
};

// Display estimates only. These are intentionally rough defaults and not billing records.
const DEFAULT_PRICING: Record<string, PricingProfile> = {
  codex: {
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
  },
  "claude-opus": {
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 25,
  },
  "claude-sonnet": {
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
  },
  "claude-haiku": {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 5,
  },
};

const DEFAULT_CLAUDE_OPUS_PRICING = DEFAULT_PRICING["claude-opus"] as PricingProfile;
const DEFAULT_CLAUDE_SONNET_PRICING = DEFAULT_PRICING["claude-sonnet"] as PricingProfile;
const DEFAULT_CLAUDE_HAIKU_PRICING = DEFAULT_PRICING["claude-haiku"] as PricingProfile;
const DEFAULT_CODEX_PRICING = DEFAULT_PRICING.codex as PricingProfile;

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

export function getUsageCurrency(settings: SettingsLike): string {
  return settings.usage_currency?.trim().toUpperCase() || "USD";
}

export function getUsdExchangeRate(settings: SettingsLike): number {
  const currency = getUsageCurrency(settings);
  const parsed = Number(settings.usage_usd_exchange_rate ?? "");
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_USD_EXCHANGE_RATE[currency] ?? 1;
}

export function formatMoneyFromUsd(usdAmount: number, settings: SettingsLike): string {
  const currency = getUsageCurrency(settings);
  const converted = usdAmount * getUsdExchangeRate(settings);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: converted < 1 ? 3 : 2,
    }).format(converted);
  } catch {
    return `${currency} ${converted.toFixed(converted < 1 ? 3 : 2)}`;
  }
}

function getClaudeProfile(model: string | undefined): PricingProfile {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (normalized.includes("haiku")) {
    return DEFAULT_CLAUDE_HAIKU_PRICING;
  }
  if (normalized.includes("sonnet")) {
    return DEFAULT_CLAUDE_SONNET_PRICING;
  }
  return DEFAULT_CLAUDE_OPUS_PRICING;
}

export function getPricingProfileForAgent(agent: AgentConfigLike | undefined): PricingProfile | null {
  if (!agent) {
    return null;
  }

  if (agent.engine === "codex") {
    return DEFAULT_CODEX_PRICING;
  }

  if (agent.engine === "claude-code") {
    const model = typeof agent.connection_config?.model === "string" ? agent.connection_config.model : undefined;
    return getClaudeProfile(model);
  }

  return null;
}

export function estimateRunUsage(
  run: RunLike,
  agent: AgentConfigLike | undefined,
): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usdCost: number;
  priced: boolean;
} {
  const inputTokens = estimateTokens(run.prompt);
  const outputTokens = estimateTokens(run.output);
  const profile = getPricingProfileForAgent(agent);
  const usdCost = profile
    ? (inputTokens / 1_000_000) * profile.inputUsdPerMillion + (outputTokens / 1_000_000) * profile.outputUsdPerMillion
    : 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    usdCost,
    priced: Boolean(profile),
  };
}
