export interface HermesRuntimeAgentStateEvent {
  type: "agent_state";
  agentId: string;
  status: "working" | "idle";
  platform?: string;
  sessionKey?: string;
  sessionId?: string;
  messageTruncated?: string;
  responseTruncated?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface HermesRuntimeEventSubscription {
  close(): void;
  closed: Promise<void>;
}

export interface HermesRuntimeEventSubscriptionOptions {
  baseUrl: string;
  token?: string;
  onEvent(event: HermesRuntimeAgentStateEvent): void | Promise<void>;
  onOpen?(): void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHermesRuntimeAgentStateEvent(value: unknown): value is HermesRuntimeAgentStateEvent {
  if (!isRecord(value)) {
    return false;
  }

  return value.type === "agent_state"
    && typeof value.agentId === "string"
    && (value.status === "working" || value.status === "idle")
    && (value.platform === undefined || typeof value.platform === "string")
    && (value.sessionKey === undefined || typeof value.sessionKey === "string")
    && (value.sessionId === undefined || typeof value.sessionId === "string")
    && (value.messageTruncated === undefined || typeof value.messageTruncated === "string")
    && (value.responseTruncated === undefined || typeof value.responseTruncated === "string")
    && (value.startedAt === undefined || typeof value.startedAt === "string")
    && (value.completedAt === undefined || typeof value.completedAt === "string");
}

async function processSseEvent(
  rawEvent: string,
  options: HermesRuntimeEventSubscriptionOptions,
): Promise<void> {
  let eventType = "message";
  const dataLines: string[] = [];

  for (const rawLine of rawEvent.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0 || (eventType !== "message" && eventType !== "agent_state")) {
    return;
  }

  const payload = JSON.parse(dataLines.join("\n")) as unknown;
  if (!isHermesRuntimeAgentStateEvent(payload)) {
    return;
  }

  await options.onEvent(payload);
}

export function subscribeToHermesRuntimeEvents(
  options: HermesRuntimeEventSubscriptionOptions,
): HermesRuntimeEventSubscription {
  const controller = new AbortController();
  const token = options.token?.trim() ?? "";
  const url = new URL("/events", options.baseUrl).toString();

  const closed = (async () => {
    const headers = new Headers({
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    });
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Hermes runtime events request failed (${response.status} ${response.statusText}).`);
    }
    if (!response.body) {
      throw new Error("Hermes runtime events response had no body.");
    }

    options.onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        await processSseEvent(rawEvent, options);
        boundary = buffer.indexOf("\n\n");
      }

      if (done) {
        break;
      }
    }

    throw new Error("Hermes runtime event stream closed.");
  })().catch((error) => {
    if (isAbortError(error)) {
      return;
    }
    throw error;
  });

  return {
    close(): void {
      controller.abort();
    },
    closed,
  };
}
