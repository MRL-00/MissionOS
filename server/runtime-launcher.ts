import type { AgentBackendProvider, AgentRuntimeState, AgentSpawnRequest } from "../src/types";
import { RequestBodyError } from "./types";

interface RuntimeSpawnPayload {
  officeAgentId: string;
  officeAgentName: string;
  officeAgentRole: string;
  provider: Exclude<AgentBackendProvider, "unlinked">;
  linkedAgentId?: string | undefined;
  tokenId?: string | undefined;
  task: string;
  message?: string | undefined;
  launchProfile?: string | undefined;
}

export interface RuntimeLaunchResult {
  endpoint: string;
  targetLabel: string;
  result: unknown;
}

function ensureBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function getRuntimeTargetLabel(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.host || baseUrl;
  } catch {
    return baseUrl;
  }
}

export async function launchAgentOnRuntimeTarget(
  state: AgentRuntimeState,
  request: AgentSpawnRequest,
): Promise<RuntimeLaunchResult | null> {
  const link = state.backendLink;
  const provider = link?.provider;
  const runtimeTarget = link?.runtimeTarget;

  if (!link || !runtimeTarget?.baseUrl || !provider || provider === "unlinked") {
    return null;
  }

  const endpoint = new URL("/api/office/spawn", ensureBaseUrl(runtimeTarget.baseUrl)).toString();
  const targetLabel = getRuntimeTargetLabel(runtimeTarget.baseUrl);
  const payload: RuntimeSpawnPayload = {
    officeAgentId: state.id,
    officeAgentName: state.name,
    officeAgentRole: state.role,
    provider,
    linkedAgentId: link.agentId,
    tokenId: link.tokenId,
    task: request.task,
    message: request.message,
    launchProfile: runtimeTarget.launchProfile,
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RequestBodyError(`Could not reach runtime target ${targetLabel}: ${message}`, 502);
  }

  const rawBody = await response.text().catch(() => "");
  if (!response.ok) {
    throw new RequestBodyError(
      `Runtime target ${targetLabel} rejected launch for ${state.name} (${response.status})${rawBody ? `: ${rawBody}` : ""}`,
      502,
    );
  }

  let parsed: unknown = null;
  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      parsed = rawBody;
    }
  }

  return {
    endpoint,
    targetLabel,
    result: parsed,
  };
}
