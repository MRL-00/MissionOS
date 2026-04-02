import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderAgentRecord, ProviderScheduleEntry } from "../../src/mission/types";
import type { AdapterConfigField, AdapterMessage, AdapterModule, AdapterTestResult } from "./types";
import {
  readHermesAgentStateSnapshot,
  readHermesAgentStateSnapshotOverSsh,
} from "./agent-state-watcher";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 15_000;

const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g;
const TABLE_BORDER_RE = /^[\s│|┌┬┐├┼┤└┴┘─╭╮╰╯═+\-]+$/;
const BOX_BORDER_RE = /^[╭╮╰╯│─┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬\s\-─]+$/;
const SESSION_ID_RE = /^session_id:\s*\S+$/i;
// Matches lines like: ╭─ ⚕ Hermes ──────────────╮
const HERMES_HEADER_RE = /^[╭╰│╮].*(?:hermes|⚕).*[╭╮╯╰│─]+$/i;
const SESSION_EXPORT_RETRY_ATTEMPTS = 8;
const SESSION_EXPORT_RETRY_DELAY_MS = 1_000;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * Strip Hermes CLI box-drawing borders, headers, and session metadata
 * from chat output, leaving just the message content.
 */
function stripHermesChromeFromOutput(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      // Pure box-drawing border lines
      if (BOX_BORDER_RE.test(trimmed)) return false;
      // session_id: 20260331_... metadata
      if (SESSION_ID_RE.test(trimmed)) return false;
      // ╭─ ⚕ Hermes ──────╮ header
      if (HERMES_HEADER_RE.test(trimmed)) return false;
      // Lines that are mostly box-drawing chars (>60% decorative)
      const boxChars = trimmed.replace(/[^╭╮╰╯│─┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬\-─]/g, "").length;
      if (boxChars > trimmed.length * 0.6) return false;
      return true;
    })
    .map((line) => line.replace(/^[│║]\s?/, "").replace(/\s?[│║]$/, ""))
    .join("\n")
    .trim();
}

function extractSessionId(text: string): string | null {
  const match = stripAnsi(text).match(/\b(\d{8}_\d{6}_[a-f0-9]+)\b/i);
  return match?.[1] ?? null;
}

function configCommand(config: Record<string, unknown>): string {
  const value = typeof config.baseUrl === "string" ? config.baseUrl.trim() : "";
  return value || "hermes";
}


function configSshHost(config: Record<string, unknown>): string {
  return typeof config.websocketUrl === "string" ? config.websocketUrl.trim() : "";
}

/**
 * Run a Hermes CLI command either locally or over SSH.
 * When sshHost is set (e.g. "matt@192.168.1.113"), the command is executed
 * remotely via `ssh <host> <command> <args...>`.
 */
export async function runHermesCli(
  command: string,
  args: string[],
  sshHost = "",
  timeoutMs = CLI_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const bin = sshHost ? "ssh" : command;
  const fullArgs = sshHost
    ? [
        "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", sshHost,
        // Build a single shell command string with proper quoting so that
        // arguments containing spaces survive SSH's remote shell parsing.
        [command, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" "),
      ]
    : args;

  try {
    const { stdout, stderr } = await execFileAsync(bin, fullArgs, {
      timeout: timeoutMs,
      env: process.env,
    });
    return { stdout: stripAnsi(stdout).trim(), stderr: stripAnsi(stderr).trim(), ok: true };
  } catch (error: unknown) {
    const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string; code?: string | number };
    if (err.code === "ENOENT") {
      const target = sshHost ? `ssh (to reach ${sshHost})` : command;
      return { stdout: "", stderr: `Command not found: ${target}`, ok: false };
    }
    // Non-zero exit but might still have useful stdout
    const stdout = stripAnsi(String(err.stdout ?? "")).trim();
    const stderr = stripAnsi(String(err.stderr ?? err.message ?? "Unknown error")).trim();

    // SSH-specific error messages
    if (sshHost && stderr.includes("Permission denied")) {
      return { stdout: "", stderr: `SSH auth failed for ${sshHost}. Run: ssh-copy-id ${sshHost}`, ok: false };
    }
    if (sshHost && (stderr.includes("command not found") || stderr.includes("No such file"))) {
      return { stdout: "", stderr: `Hermes CLI not found on ${sshHost} at "${command}". Try the full path (e.g. ~/.local/bin/hermes).`, ok: false };
    }

    return { stdout, stderr, ok: stdout.length > 0 };
  }
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        return jsonMatch[1] ? JSON.parse(jsonMatch[1]) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseCliTable(text: string): Array<Record<string, string>> {
  const lines = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed && !TABLE_BORDER_RE.test(trimmed);
  });

  if (lines.length < 2) return [];

  const headerLine = lines[0] ?? "";
  const isPipeDelimited = headerLine.includes("\u2502") || headerLine.includes("|");
  const delimiter = headerLine.includes("\u2502") ? "\u2502" : "|";

  if (isPipeDelimited) {
    const headers = headerLine
      .split(delimiter)
      .map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"))
      .filter(Boolean);

    return lines
      .slice(1)
      .map((line) => {
        const cells = line.split(delimiter).map((c) => c.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, i) => {
          row[h] = cells[i + 1] ?? "";
        });
        return row;
      })
      .filter((row) => Object.values(row).some((v) => v));
  }

  // Fixed-width column parsing: detect column start positions from the header
  const headerRaw = lines[0]!;
  const columnStarts: number[] = [];
  const headerNames: string[] = [];

  // Find where each column header starts (non-space after space, or position 0)
  let inWord = false;
  for (let i = 0; i < headerRaw.length; i++) {
    const isSpace = headerRaw[i] === " ";
    if (!isSpace && !inWord) {
      columnStarts.push(i);
      inWord = true;
    } else if (isSpace && inWord) {
      // Check if this is just an intra-word space (e.g. "Last Active")
      // by looking ahead — if next non-space is within 1 char, still same column
      const nextNonSpace = headerRaw.slice(i).search(/\S/);
      if (nextNonSpace > 1) {
        inWord = false;
      }
    }
  }

  // Extract header names using column positions
  for (let i = 0; i < columnStarts.length; i++) {
    const start = columnStarts[i]!;
    const end = i + 1 < columnStarts.length ? columnStarts[i + 1]! : headerRaw.length;
    headerNames.push(headerRaw.slice(start, end).trim().toLowerCase().replace(/\s+/g, "_"));
  }

  return lines
    .slice(1)
    .map((line) => {
      const row: Record<string, string> = {};
      for (let i = 0; i < columnStarts.length; i++) {
        const start = columnStarts[i]!;
        const end = i + 1 < columnStarts.length ? columnStarts[i + 1]! : line.length;
        row[headerNames[i]!] = line.slice(start, end).trim();
      }
      return row;
    })
    .filter((row) => Object.values(row).some((v) => v));
}

function normalizeSessionStatus(value: string): ProviderAgentRecord["status"] {
  const lower = value.toLowerCase();
  if (lower.includes("active") || lower.includes("running") || lower.includes("work") || lower.includes("busy")) {
    return "working";
  }
  if (lower.includes("idle") || lower.includes("completed") || lower.includes("done") || lower.includes("ready")) {
    return "idle";
  }
  if (lower.includes("error") || lower.includes("failed") || lower.includes("off") || lower.includes("down")) {
    return "offline";
  }
  return "idle";
}

function normalizeSessionAgent(value: unknown, index: number): ProviderAgentRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = String(
    record.id ?? record.sessionId ?? record.session_id ?? record.key ?? `session-${index}`,
  );
  const name = String(
    record.title ?? record.name ?? record.subject ?? record.label ?? id,
  );
  return {
    connectorId: "",
    provider: "hermes",
    externalId: id,
    name,
    status: normalizeSessionStatus(String(record.status ?? "idle")),
    task:
      typeof record.task === "string" ? record.task
      : typeof record.model === "string" ? record.model
      : typeof record.last_message === "string" ? record.last_message
      : undefined,
    lastSeenAt:
      typeof record.updated_at === "number" ? record.updated_at
      : typeof record.created_at === "number" ? record.created_at
      : undefined,
    imported: false,
  };
}

function normalizeCronSchedule(value: unknown, index: number): ProviderScheduleEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id ?? record.name ?? record.key ?? `cron-${index}`);
  const name = String(record.name ?? record.title ?? record.label ?? id);
  const statusRaw = String(record.status ?? "unknown").toLowerCase();
  return {
    connectorId: "",
    id: `hermes:${id}:${index}`,
    provider: "hermes",
    name,
    recurrence: String(
      record.schedule ?? record.cron ?? record.expression ?? record.recurrence ?? "Unknown cadence",
    ),
    nextRunAt:
      typeof record.next_run === "number" ? record.next_run
      : typeof record.nextRunAt === "number" ? record.nextRunAt
      : undefined,
    lastRunAt:
      typeof record.last_run === "number" ? record.last_run
      : typeof record.lastRunAt === "number" ? record.lastRunAt
      : undefined,
    status: (["scheduled", "running", "paused", "error", "unknown"].includes(statusRaw)
      ? statusRaw
      : "unknown") as ProviderScheduleEntry["status"],
  };
}

function parseAgentsFromOutput(output: string): ProviderAgentRecord[] {
  const json = tryParseJson(output);
  if (json) {
    const arr = Array.isArray(json)
      ? json
      : typeof json === "object" && json !== null
        ? (Array.isArray((json as Record<string, unknown>).sessions)
            ? (json as Record<string, unknown>).sessions as unknown[]
            : [])
        : [];
    if (arr.length > 0) {
      return arr
        .map((item, i) => normalizeSessionAgent(item, i))
        .filter((a): a is ProviderAgentRecord => a !== null);
    }
  }

  const rows = parseCliTable(output);
  return rows.map((row, index) => {
    const id = row.id || row.session || row.session_id || `session-${index}`;
    const name = row.title || row.name || row.subject || id;
    return {
      connectorId: "",
      provider: "hermes" as const,
      externalId: String(id),
      name: String(name),
      status: normalizeSessionStatus(row.status || "idle"),
      task: row.task || row.model || undefined,
      imported: false,
    };
  });
}

function parseSchedulesFromOutput(output: string): ProviderScheduleEntry[] {
  const json = tryParseJson(output);
  if (json) {
    const arr = Array.isArray(json)
      ? json
      : typeof json === "object" && json !== null
        ? (Array.isArray((json as Record<string, unknown>).jobs)
            ? (json as Record<string, unknown>).jobs as unknown[]
            : Array.isArray((json as Record<string, unknown>).schedules)
              ? (json as Record<string, unknown>).schedules as unknown[]
              : [])
        : [];
    if (arr.length > 0) {
      return arr
        .map((item, i) => normalizeCronSchedule(item, i))
        .filter((s): s is ProviderScheduleEntry => s !== null);
    }
  }

  const rows = parseCliTable(output);
  return rows.map((row, index) => {
    const id = row.id || row.name || `cron-${index}`;
    const name = row.name || row.title || row.label || id;
    const statusRaw = (row.status || "unknown").toLowerCase();
    return {
      connectorId: "",
      id: `hermes:${id}:${index}`,
      provider: "hermes" as const,
      name: String(name),
      recurrence: row.schedule || row.cron || row.expression || "Unknown cadence",
      status: (["scheduled", "running", "paused", "error", "unknown"].includes(statusRaw)
        ? statusRaw
        : "unknown") as ProviderScheduleEntry["status"],
    };
  });
}

function normalizeMessageRole(value: string): AdapterMessage["role"] {
  const lower = value.toLowerCase().trim();
  if (lower === "user" || lower === "human") return "user";
  if (lower === "assistant" || lower === "ai" || lower === "bot" || lower === "model") return "assistant";
  return "system";
}

function parseMessagesFromJson(data: unknown): AdapterMessage[] {
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;

  // Try common shapes: { messages: [...] }, { turns: [...] }, or plain array
  const candidates = [
    record.messages,
    record.turns,
    record.conversation,
    record.history,
    data,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const messages: AdapterMessage[] = [];
    for (let i = 0; i < candidate.length; i++) {
      const item = candidate[i];
      if (typeof item !== "object" || item === null) continue;
      const msg = item as Record<string, unknown>;
      const content = extractMessageText(
        msg.content ?? msg.text ?? msg.message ?? msg.body ?? msg.parts ?? msg.blocks ?? msg.segments ?? msg.content_blocks,
      );
      if (!content) continue;
      const timestamp = typeof msg.timestamp === "number" ? msg.timestamp
        : typeof msg.created_at === "number" ? msg.created_at
        : typeof msg.createdAt === "number" ? msg.createdAt
        : undefined;
      const finishReason = typeof msg.finish_reason === "string" ? msg.finish_reason
        : typeof msg.finishReason === "string" ? msg.finishReason
        : undefined;
      const agentName = typeof msg.agentName === "string" ? msg.agentName
        : typeof msg.name === "string" ? msg.name
        : undefined;
      messages.push({
        id: String(msg.id ?? `msg-${i}`),
        role: normalizeMessageRole(String(msg.role ?? msg.type ?? msg.sender ?? msg.author ?? msg.kind ?? "system")),
        content,
        ...(timestamp !== undefined ? { timestamp } : {}),
        ...(agentName ? { agentName } : {}),
        ...(finishReason ? { finishReason } : {}),
      });
    }
    if (messages.length > 0) return messages;
  }

  return [];
}

function extractMessageText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractMessageText(entry))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof value !== "object" || value === null) {
    return "";
  }

  const record = value as Record<string, unknown>;
  const direct = [
    record.text,
    record.content,
    record.message,
    record.body,
    record.value,
    record.output,
    record.result,
  ];
  for (const candidate of direct) {
    const text = extractMessageText(candidate);
    if (text) {
      return text;
    }
  }

  const nested = [
    record.parts,
    record.blocks,
    record.segments,
    record.content_blocks,
    record.items,
    record.messages,
  ];
  for (const candidate of nested) {
    const text = extractMessageText(candidate);
    if (text) {
      return text;
    }
  }

  return "";
}

function parseMessagesFromText(text: string): AdapterMessage[] {
  // Parse text-based session output like:
  // [user] Hello
  // [assistant] Hi there
  // or:
  // > Hello
  // Hello! How can I help?
  const messages: AdapterMessage[] = [];
  const lines = text.split("\n");
  let currentRole: AdapterMessage["role"] = "system";
  let currentContent: string[] = [];

  function flush(): void {
    const content = currentContent.join("\n").trim();
    if (content) {
      messages.push({
        id: `msg-${messages.length}`,
        role: currentRole,
        content,
      });
    }
    currentContent = [];
  }

  for (const line of lines) {
    // [role] message or **role**: message
    const bracketMatch = line.match(/^\[(\w+)\]\s*(.*)/);
    if (bracketMatch) {
      flush();
      currentRole = normalizeMessageRole(bracketMatch[1]!);
      if (bracketMatch[2]?.trim()) currentContent.push(bracketMatch[2].trim());
      continue;
    }

    const boldMatch = line.match(/^\*\*(\w+)\*\*:\s*(.*)/);
    if (boldMatch) {
      flush();
      currentRole = normalizeMessageRole(boldMatch[1]!);
      if (boldMatch[2]?.trim()) currentContent.push(boldMatch[2].trim());
      continue;
    }

    // > prefixed lines are user messages
    if (line.startsWith("> ")) {
      if (currentRole !== "user") {
        flush();
        currentRole = "user";
      }
      currentContent.push(line.slice(2));
      continue;
    }

    currentContent.push(line);
  }

  flush();
  return messages;
}

function parseSessionExportOutput(output: string): AdapterMessage[] {
  const trimmed = output.trim();
  if (!trimmed || trimmed.length < 5) {
    return [];
  }

  const jsonLines = trimmed.split("\n");
  const messages: AdapterMessage[] = [];
  for (let i = 0; i < jsonLines.length; i++) {
    const json = tryParseJson(jsonLines[i]!);
    if (!json || typeof json !== "object") continue;
    const record = json as Record<string, unknown>;

    const recordMessages = parseMessagesFromJson(record);
    if (recordMessages.length > 0) {
      messages.push(...recordMessages);
      continue;
    }

      const content = extractMessageText(
        record.content ?? record.text ?? record.message ?? record.body ?? record.parts ?? record.blocks ?? record.segments ?? record.content_blocks,
      );
      const role = String(record.role ?? record.type ?? record.sender ?? "");
      const finishReason = typeof record.finish_reason === "string" ? record.finish_reason
        : typeof record.finishReason === "string" ? record.finishReason
        : undefined;
      if (content) {
        const timestamp = typeof record.timestamp === "number" ? record.timestamp : undefined;
        messages.push({
          id: String(record.id ?? `msg-${i}`),
          role: normalizeMessageRole(role),
          content: stripHermesChromeFromOutput(content),
          ...(timestamp !== undefined ? { timestamp } : {}),
          ...(finishReason ? { finishReason } : {}),
        });
      }
  }
  if (messages.length > 0) {
    return messages;
  }

  const fullJson = tryParseJson(trimmed);
  if (fullJson) {
    const parsed = parseMessagesFromJson(fullJson);
    if (parsed.length > 0) {
      return parsed.map((message) => ({
        ...message,
        content: stripHermesChromeFromOutput(message.content),
      }));
    }
  }

  const cleaned = stripHermesChromeFromOutput(trimmed);
  const textMsgs = parseMessagesFromText(cleaned);
  if (textMsgs.length > 0) {
    return textMsgs;
  }

  if (cleaned.length > 10) {
    return [{ id: "raw-0", role: "system", content: cleaned, timestamp: Date.now() }];
  }

  return [];
}

async function exportSessionMessages(command: string, sshHost: string, sessionId: string): Promise<AdapterMessage[]> {
  const exportCandidates: string[][] = [
    ["sessions", "export", "--session-id", sessionId, "-"],
  ];

  for (const args of exportCandidates) {
    console.log(`[hermes] trying: ${args.join(" ")}`);
    const result = await runHermesCli(command, args, sshHost, 15_000);
    const output = result.stdout.trim();

    if (!output || output.length < 5) continue;
    if (result.stderr.includes("error") && !result.ok) continue;

    console.log(`[hermes] export returned ${output.length} chars, first 200: ${output.slice(0, 200)}`);

    const messages = parseSessionExportOutput(output);
    if (messages.length > 0) {
      console.log(`[hermes] parsed ${messages.length} messages`);
      return messages;
    }
  }

  return [];
}

function latestAssistantMessage(messages: AdapterMessage[]): AdapterMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    const content = stripHermesChromeFromOutput(message.content ?? "");
    if (!content) {
      continue;
    }
    return { ...message, content };
  }
  return null;
}

function latestTerminalAssistantMessage(messages: AdapterMessage[]): AdapterMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant" || message.finishReason !== "stop") {
      continue;
    }
    const content = stripHermesChromeFromOutput(message.content ?? "");
    if (!content) {
      continue;
    }
    return { ...message, content };
  }
  return null;
}

async function resolveAssistantMessageFromSession(
  command: string,
  sshHost: string,
  preferredSessionId?: string | null,
): Promise<AdapterMessage | null> {
  const attemptedSessionIds = new Set<string>();

  for (let attempt = 0; attempt < SESSION_EXPORT_RETRY_ATTEMPTS; attempt += 1) {
    const sessionIds = [preferredSessionId ?? "", await findLatestSessionId(command, sshHost)]
      .map((value) => value?.trim() ?? "")
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);

    for (const sessionId of sessionIds) {
      if (attemptedSessionIds.has(sessionId)) {
        continue;
      }
      attemptedSessionIds.add(sessionId);

      const messages = await exportSessionMessages(command, sshHost, sessionId);
      const assistantMessage = latestTerminalAssistantMessage(messages) ?? latestAssistantMessage(messages);
      if (assistantMessage) {
        if (assistantMessage.finishReason && assistantMessage.finishReason !== "stop") {
          continue;
        }
        return assistantMessage;
      }
    }

    if (attempt < SESSION_EXPORT_RETRY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, SESSION_EXPORT_RETRY_DELAY_MS));
    }
  }

  return null;
}

/**
 * Find the most recent session ID from `hermes sessions list`.
 */
async function findLatestSessionId(command: string, sshHost: string): Promise<string | null> {
  const result = await runHermesCli(command, ["sessions", "list"], sshHost);
  console.log(`[hermes] sessions list ok=${result.ok} stdout=${result.stdout.length}chars stderr=${result.stderr.slice(0, 200)}`);
  if (!result.stdout) {
    console.log("[hermes] sessions list returned no stdout");
    return null;
  }

  // Log first few lines to see the format
  const lines = result.stdout.split("\n").filter((l) => l.trim());
  console.log(`[hermes] sessions list output (${lines.length} lines):\n${lines.slice(0, 8).join("\n")}`);

  const json = tryParseJson(result.stdout);
  if (json) {
    const arr = Array.isArray(json)
      ? json
      : typeof json === "object" && json !== null
        ? (Array.isArray((json as Record<string, unknown>).sessions)
            ? (json as Record<string, unknown>).sessions as unknown[]
            : [])
        : [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const item = arr[i] as Record<string, unknown> | undefined;
      if (item) {
        const id = String(item.id ?? item.sessionId ?? item.session_id ?? item.key ?? "");
        if (id) return id;
      }
    }
  }

  // Session IDs look like: 20260331_111537_27822c
  // Extract all from raw output and take the first one (most recent, since list is sorted)
  const idMatch = result.stdout.match(/\b(\d{8}_\d{6}_[a-f0-9]+)\b/g);
  if (idMatch && idMatch.length > 0) {
    console.log(`[hermes] found ${idMatch.length} session IDs, using first: ${idMatch[0]}`);
    return idMatch[0]!;
  }

  // Fallback: try table parsing
  const rows = parseCliTable(result.stdout);
  if (rows.length > 0) {
    const first = rows[0]!;
    const id = first.id || first.session || first.session_id || first.session_name || "";
    if (id) {
      console.log(`[hermes] found session ID via table: ${id}`);
      return id;
    }
  }

  console.log("[hermes] could not extract session ID from output");
  return null;
}

export const hermesAdapter: AdapterModule = {
  type: "hermes",
  label: "Hermes",

  configFields(): AdapterConfigField[] {
    return [
      {
        key: "baseUrl",
        label: "CLI command",
        type: "text",
        placeholder: "hermes",
        required: true,
        hint: "CLI binary name or full path (e.g. hermes, /home/matt/.local/bin/hermes). Create multiple connectors for multiple CLIs.",
      },
      {
        key: "websocketUrl",
        label: "SSH host",
        type: "text",
        placeholder: "matt@192.168.1.113",
        hint: "Leave blank for local. Requires SSH key auth (ssh-copy-id).",
      },
      { key: "runtimeBaseUrl", label: "Runtime bridge URL", type: "url", placeholder: "http://127.0.0.1:8642" },
      {
        key: "token",
        label: "API token",
        type: "password",
        placeholder: "Bearer token for /events and API server auth",
        hint: "Optional. Required only when the Hermes API server is protected by API_SERVER_KEY.",
      },
    ];
  },

  defaultConfig(): Record<string, unknown> {
    return {
      baseUrl: process.env.HERMES_COMMAND?.trim() || "hermes",
      websocketUrl: process.env.HERMES_SSH_HOST?.trim() || "",
      runtimeBaseUrl: process.env.HERMES_RUNTIME_URL?.trim() || "",
      token: process.env.HERMES_TOKEN?.trim() || "",
    };
  },

  async testConnection(config): Promise<AdapterTestResult> {
    const command = configCommand(config);
    const sshHost = configSshHost(config);
    const startedAt = Date.now();

    const result = await runHermesCli(command, ["--version"], sshHost);
    const latencyMs = Date.now() - startedAt;

    if (!result.ok && !result.stdout) {
      const msg = result.stderr || `Hermes CLI not found at "${command}".`;
      return { ok: false, message: msg, latencyMs };
    }

    const version = (result.stdout || result.stderr).split("\n")[0];
    const label = command.split("/").pop() || command;
    const where = sshHost ? ` on ${sshHost}` : " (local)";
    return { ok: true, message: `Connected${where} — ${label}: ${version}`, latencyMs };
  },

  async syncAgents(config): Promise<ProviderAgentRecord[]> {
    const sshHost = configSshHost(config);

    const fileSnapshot = sshHost
      ? await readHermesAgentStateSnapshotOverSsh(sshHost)
      : await readHermesAgentStateSnapshot();

    return fileSnapshot.agents;
  },

  async syncSchedules(config): Promise<ProviderScheduleEntry[]> {
    const command = configCommand(config);
    const sshHost = configSshHost(config);
    const result = await runHermesCli(command, ["cron", "list"], sshHost);
    if (!result.ok && !result.stdout) return [];
    // "No scheduled jobs." means empty — don't try to parse it
    if (/no scheduled/i.test(result.stdout)) return [];
    return parseSchedulesFromOutput(result.stdout);
  },

  async fetchMessages(config, _externalAgentId): Promise<AdapterMessage[]> {
    const command = configCommand(config);
    const sshHost = configSshHost(config);

    // Find the latest session
    const sessionId = await findLatestSessionId(command, sshHost);
    if (!sessionId) {
      console.log("[hermes] no session found for fetchMessages");
      return [];
    }
    console.log(`[hermes] fetching messages for session: ${sessionId}`);

    // Discover what `hermes sessions export` expects
    const exportHelp = await runHermesCli(command, ["sessions", "export", "--help"], sshHost, 5_000);
    console.log(`[hermes] sessions export --help:\n${(exportHelp.stdout || exportHelp.stderr).slice(0, 500)}`);

    const messages = await exportSessionMessages(command, sshHost, sessionId);
    if (messages.length > 0) {
      return messages;
    }

    console.log("[hermes] could not fetch message history from any export variant");
    return [];
  },

  async sendMessage(config, _externalAgentId, message): Promise<AdapterMessage | null> {
    const command = configCommand(config);
    const sshHost = configSshHost(config);

    // hermes chat -q "message" -Q --yolo --source office
    //   -q QUERY     = single query, non-interactive
    //   -Q           = quiet/programmatic output (no banner, spinner, tool previews)
    //   --yolo       = bypass approval prompts
    //   --source     = tag so it doesn't pollute user session lists
    //
    // NOTE: --continue is a TOP-LEVEL hermes flag, not a chat flag.
    // To continue a session, use: hermes --continue <name> chat -q "msg"
    // For now we create fresh sessions per message. To resume, we'd need
    // the session name/id from a previous send.
    const args = ["chat", "-q", message, "-Q", "--yolo", "--source", "office"];
    console.log(`[hermes] sending: ${command} chat -q "${message.slice(0, 60)}${message.length > 60 ? "..." : ""}" -Q --yolo --source office`);

    const result = await runHermesCli(command, args, sshHost, 120_000);
    const sessionId = extractSessionId(result.stdout) ?? extractSessionId(result.stderr);
    const exportedAssistantMessage = await resolveAssistantMessageFromSession(command, sshHost, sessionId);

    if (exportedAssistantMessage) {
      return exportedAssistantMessage;
    }

    const content = stripHermesChromeFromOutput(result.stdout);

    if (content) {
      return {
        id: `sent-${Date.now()}`,
        role: "assistant",
        content,
        timestamp: Date.now(),
      };
    }

    if (result.stderr) {
      return {
        id: `error-${Date.now()}`,
        role: "system",
        content: `Hermes error: ${result.stderr.slice(0, 500)}`,
        timestamp: Date.now(),
      };
    }

    return {
      id: `error-${Date.now()}`,
      role: "system",
      content: "Hermes returned no output.",
      timestamp: Date.now(),
    };
  },
};

export const hermesAdapterTestExports = {
  exportSessionMessages,
  extractSessionId,
  latestAssistantMessage,
  latestTerminalAssistantMessage,
  parseSessionExportOutput,
  resolveAssistantMessageFromSession,
};
