import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

try {
  process.loadEnvFile?.();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

type RuntimeProvider = "hermes" | "claude" | "codex";

interface RuntimeSpawnRequest {
  officeAgentId: string;
  officeAgentName: string;
  officeAgentRole: string;
  provider: RuntimeProvider;
  linkedAgentId?: string | undefined;
  tokenId?: string | undefined;
  task: string;
  message?: string | undefined;
  launchProfile?: string | undefined;
}

const HOST = process.env.AGENT_BRIDGE_HOST?.trim() || "0.0.0.0";
const PORT = Math.max(1, Number(process.env.AGENT_BRIDGE_PORT ?? "3012") || 3012);
const CWD = process.env.AGENT_BRIDGE_CWD?.trim() || process.cwd();
const PROVIDER_COMMANDS: Record<RuntimeProvider, string> = {
  hermes: process.env.AGENT_BRIDGE_HERMES_COMMAND?.trim() || "",
  claude: process.env.AGENT_BRIDGE_CLAUDE_COMMAND?.trim() || "",
  codex: process.env.AGENT_BRIDGE_CODEX_COMMAND?.trim() || "",
};

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json",
} as const;

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, DEFAULT_HEADERS);
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("Invalid JSON payload");
  }
}

function isRuntimeSpawnRequest(value: unknown): value is RuntimeSpawnRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Partial<RuntimeSpawnRequest>;
  return (
    typeof payload.officeAgentId === "string" &&
    typeof payload.officeAgentName === "string" &&
    typeof payload.officeAgentRole === "string" &&
    (payload.provider === "hermes" || payload.provider === "claude" || payload.provider === "codex") &&
    (payload.linkedAgentId === undefined || typeof payload.linkedAgentId === "string") &&
    (payload.tokenId === undefined || typeof payload.tokenId === "string") &&
    typeof payload.task === "string" &&
    (payload.message === undefined || typeof payload.message === "string") &&
    (payload.launchProfile === undefined || typeof payload.launchProfile === "string")
  );
}

function buildLaunchEnv(payload: RuntimeSpawnRequest): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OFFICE_AGENT_ID: payload.officeAgentId,
    OFFICE_AGENT_NAME: payload.officeAgentName,
    OFFICE_AGENT_ROLE: payload.officeAgentRole,
    OFFICE_PROVIDER: payload.provider,
    OFFICE_PROVIDER_AGENT_ID: payload.linkedAgentId ?? "",
    OFFICE_TOKEN_ID: payload.tokenId ?? "",
    OFFICE_TASK: payload.task,
    OFFICE_MESSAGE: payload.message ?? "",
    OFFICE_LAUNCH_PROFILE: payload.launchProfile ?? "",
  };
}

function launch(payload: RuntimeSpawnRequest): { pid: number | undefined } {
  const command = PROVIDER_COMMANDS[payload.provider];
  if (!command) {
    throw new Error(
      `No launch command configured for ${payload.provider}. Set ${providerCommandVarName(payload.provider)} on the PC bridge.`,
    );
  }

  const child = spawn(command, {
    cwd: CWD,
    detached: true,
    env: buildLaunchEnv(payload),
    shell: true,
    stdio: "ignore",
  });
  child.unref();

  console.log(
    `[agent-runtime-bridge] Started ${payload.provider} for ${payload.officeAgentName} (${payload.officeAgentId}) with pid ${child.pid ?? "unknown"}`,
  );

  return { pid: child.pid };
}

function providerCommandVarName(provider: RuntimeProvider): string {
  if (provider === "hermes") {
    return "AGENT_BRIDGE_HERMES_COMMAND";
  }
  if (provider === "claude") {
    return "AGENT_BRIDGE_CLAUDE_COMMAND";
  }
  return "AGENT_BRIDGE_CODEX_COMMAND";
}

const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "OPTIONS") {
    response.writeHead(204, DEFAULT_HEADERS);
    response.end();
    return;
  }

  try {
    if (method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        host: HOST,
        port: PORT,
        configuredProviders: Object.entries(PROVIDER_COMMANDS)
          .filter(([, command]) => Boolean(command))
          .map(([provider]) => provider),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/office/spawn") {
      const body = await readJson(request);
      if (!isRuntimeSpawnRequest(body)) {
        sendJson(response, 400, { error: "Invalid spawn payload" });
        return;
      }

      const started = launch(body);
      sendJson(response, 200, {
        ok: true,
        provider: body.provider,
        officeAgentId: body.officeAgentId,
        launchProfile: body.launchProfile,
        pid: started.pid,
      });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendJson(response, 500, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[agent-runtime-bridge] Listening on http://${HOST}:${PORT}`);
  console.log(`[agent-runtime-bridge] Working directory: ${CWD}`);
});
