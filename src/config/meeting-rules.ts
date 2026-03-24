export const MEETING_RULES = {
  standup: { maxTurnSeconds: 60, allowRebuttals: false, description: "Quick status update." },
  strategy: {
    maxTurnSeconds: 180,
    allowRebuttals: true,
    maxRebuttalsPerAgent: 1,
    description: "Open discussion.",
  },
  review: {
    maxTurnSeconds: 180,
    allowRebuttals: true,
    maxRebuttalsPerAgent: 2,
    description: "One agent presents.",
  },
} as const;

export const FACILITATOR_ROTATION = [
  "randall",
  "pickle",
  "zoe",
  "ink",
  "harry",
  "kevin",
  "danny",
  "johnny",
  "tommy",
  "cio",
] as const;
