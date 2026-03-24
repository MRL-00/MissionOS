import type { AgentAppearance, AgentConfig } from "./types";
import defaultAppearancesJson from "./config/default-appearances.json";

const DEFAULT_APPEARANCES = defaultAppearancesJson as AgentConfig[];

const KNOWN_DESK_INDICES = {
  pickle: 0,
  zoe: 1,
  ink: 2,
  harry: 3,
  kevin: 4,
  danny: 5,
  johnny: 6,
  tommy: 7,
  randall: 8,
  cio: 9,
} as const satisfies Record<string, number>;

const HEAD_SHAPES = ["round", "oval", "square"] as const;
const HAIR_STYLES = ["short", "long", "mohawk", "messy", "slicked", "buzz", "curly", "none"] as const;
const ACCESSORY_SETS: AgentAppearance["accessories"][] = [
  [],
  ["glasses"],
  ["tie"],
  ["beard"],
  ["glasses", "tie"],
  ["hat"],
];

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const scaledHue = hue / 60;
  const x = chroma * (1 - Math.abs((scaledHue % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (scaledHue >= 0 && scaledHue < 1) {
    red = chroma;
    green = x;
  } else if (scaledHue < 2) {
    red = x;
    green = chroma;
  } else if (scaledHue < 3) {
    green = chroma;
    blue = x;
  } else if (scaledHue < 4) {
    green = x;
    blue = chroma;
  } else if (scaledHue < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const match = l - chroma / 2;
  const toHex = (channel: number) =>
    Math.round((channel + match) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

export function getDefaultAgentConfig(agentId: string): AgentConfig | undefined {
  return DEFAULT_APPEARANCES.find((agent) => agent.id === agentId);
}

export function getKnownDeskIndex(agentId: string): number | undefined {
  return KNOWN_DESK_INDICES[agentId as keyof typeof KNOWN_DESK_INDICES];
}

export function createDeterministicAppearance(agentId: string): AgentAppearance {
  const hash = hashString(agentId);
  const hue = hash % 360;
  const hairHue = (hue + 28) % 360;
  const pantsHue = (hue + 220) % 360;
  const headShape = HEAD_SHAPES[hash % HEAD_SHAPES.length] ?? "oval";
  const hairStyle = HAIR_STYLES[(hash >>> 3) % HAIR_STYLES.length] ?? "short";
  const accessories = ACCESSORY_SETS[(hash >>> 6) % ACCESSORY_SETS.length] ?? [];
  const height = 0.92 + ((hash >>> 9) % 28) / 100;

  return {
    height: Number(height.toFixed(2)),
    headShape,
    skinColor: hslToHex((hue + 35) % 360, 45, 72),
    hairStyle,
    hairColor: hslToHex(hairHue, 38, 24),
    bodyColor: hslToHex(hue, 52, 48),
    pantsColor: hslToHex(pantsHue, 28, 30),
    accessories,
  };
}

export function buildAgentConfig(input: {
  id: string;
  name: string;
  role: string;
  emoji?: string | undefined;
  appearance?: AgentAppearance | undefined;
}): AgentConfig {
  const fallback = getDefaultAgentConfig(input.id);

  return {
    id: input.id,
    name: input.name,
    role: input.role,
    emoji: input.emoji ?? fallback?.emoji ?? "🙂",
    appearance: input.appearance ?? fallback?.appearance ?? createDeterministicAppearance(input.id),
  };
}
