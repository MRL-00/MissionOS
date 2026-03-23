import type { AgentEvent } from "../src/types";

const BASE_URL = "http://localhost:3001";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
  }
}

async function sendEvent(event: AgentEvent): Promise<void> {
  await post("/api/agent/status", event);
}

async function main(): Promise<void> {
  const now = Date.now();
  await sendEvent({
    agentId: "pickle",
    status: "entering",
    location: "door",
    task: "Opening the office",
    message: "Morning run-through.",
    timestamp: now,
  });
  await wait(1200);

  await sendEvent({
    agentId: "zoe",
    status: "working",
    location: "desk",
    task: "Reviewing Phase 2 wiring",
    message: "WebSocket client is live.",
    timestamp: now + 1200,
  });
  await wait(1200);

  await post("/api/meeting/start", {
    agentIds: ["pickle", "zoe", "ink"],
  });
  await wait(1800);

  await sendEvent({
    agentId: "ink",
    status: "meeting",
    location: "meeting-room",
    task: "Research readout",
    message: "Sharing the latest findings.",
    timestamp: now + 4200,
  });
  await wait(1800);

  await post("/api/meeting/end", {});
  await wait(1200);

  await sendEvent({
    agentId: "cio",
    status: "working",
    location: "cio-office",
    task: "Budget review",
    message: "Need a clean summary by lunch.",
    timestamp: now + 7200,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
