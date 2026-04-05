import { asFlag, parseJson } from "./db.js";

function normalizeSection(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSkills(value: unknown): string[] {
  return parseJson<string[]>(typeof value === "string" ? value : null, [])
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildRunPrompt(agentRow: Record<string, unknown>, prompt: string): string {
  if (asFlag(typeof agentRow.external_config === "number" ? agentRow.external_config : 0)) {
    return prompt;
  }

  const soul = normalizeSection(agentRow.soul_md as string | null | undefined);
  const agents = normalizeSection(agentRow.agents_md as string | null | undefined);
  const skills = normalizeSkills(agentRow.skills);
  const sections: string[] = [];

  if (soul) {
    sections.push(`[SOUL]\n${soul}`);
  }

  if (skills.length > 0) {
    sections.push(`[SKILLS]\n${skills.map((skill) => `- ${skill}`).join("\n")}`);
  }

  if (agents) {
    sections.push(`[AGENTS]\n${agents}`);
  }

  sections.push(`[TASK]\n${prompt}`);
  return sections.join("\n\n");
}
