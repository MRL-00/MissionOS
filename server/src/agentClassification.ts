import { parseJson } from "./db.js";

function agentHasTool(agentRow: Record<string, unknown>, tool: string): boolean {
  return parseJson<string[]>(String(agentRow.tools ?? "[]"), []).includes(tool);
}

export function isImplementationAgent(agentRow: Record<string, unknown>): boolean {
  return agentHasTool(agentRow, "code-exec") || agentHasTool(agentRow, "file-system");
}

export function isDelegationOnlyAgent(agentRow: Record<string, unknown>): boolean {
  if (isImplementationAgent(agentRow)) {
    return false;
  }

  const identity = [agentRow.name, agentRow.role, agentRow.soul_md]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");

  return /\b(?:boss|orchestrat(?:or|ion)|delegat(?:e|or|ion)|coordinator|lead)\b/i.test(identity);
}

export function isIosSpecificTask(task: string): boolean {
  return /\b(?:ios|ipad(?:os)?|swift|xcode|uikit|swiftui|app store|testflight|cocoa(?:pods)?|apple)\b/i.test(task);
}
