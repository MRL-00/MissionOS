import { isDelegationOnlyAgent } from "./agentClassification.js";
import { asFlag, getDb, parseJson } from "./db.js";

function normalizeSection(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSkills(value: unknown): string[] {
  return parseJson<string[]>(typeof value === "string" ? value : null, [])
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildPlanFormatSection(agentRow: Record<string, unknown>): string | null {
  if (!isDelegationOnlyAgent(agentRow)) {
    return null;
  }

  const db = getDb();
  const agents = db
    .prepare("SELECT name, role FROM agents WHERE active = 1 AND id != ?")
    .all(String(agentRow.id)) as Array<{ name: string; role: string | null }>;

  const agentList = agents
    .map((a) => `- ${a.name}${a.role ? ` (${a.role})` : ""}`)
    .join("\n");

  return [
    "You are an orchestrator. Your job is to analyze the task and produce a structured execution plan.",
    "Do NOT implement code yourself. Instead, output a JSON plan that assigns work to the right agents.",
    "",
    "Available agents:",
    agentList,
    "",
    "Output your plan at the end of your response in a fenced block tagged ```json:plan like this:",
    "",
    "```json:plan",
    '{',
    '  "plan": [',
    '    { "id": "step-1", "agent": "AgentName", "task": "Clear description of what to do" },',
    '    { "id": "step-2", "agent": "AgentName", "task": "Another task", "dependsOn": ["step-1"] }',
    '  ],',
    '  "summary": "Brief description of the plan"',
    '}',
    "```",
    "",
    "Rules:",
    "- Each step must have a unique `id`, an `agent` name from the list above, and a clear `task`.",
    "- Use `dependsOn` (array of step ids) when a step must wait for another to complete.",
    "- Steps without `dependsOn` run in parallel.",
    "- Keep tasks focused — one step per distinct piece of work.",
    "- Include enough context in each task for the agent to work independently (issue details, repo context, acceptance criteria).",
    "- Do not assign steps to yourself.",
  ].join("\n");
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

  const planFormat = buildPlanFormatSection(agentRow);
  if (planFormat) {
    sections.push(`[OUTPUT FORMAT]\n${planFormat}`);
  }

  sections.push(`[TASK]\n${prompt}`);
  return sections.join("\n\n");
}
