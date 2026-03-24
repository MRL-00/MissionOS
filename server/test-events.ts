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

async function main(): Promise<void> {
  await post("/api/agent/spawn", {
    agentId: "pickle",
    task: "Opening the office for daily standup",
    message: "Booting up the room.",
  });
  await wait(900);

  await post("/api/agent/spawn", {
    agentId: "zoe",
    task: "Preparing engineering status",
    message: "Pulling the current sprint state.",
  });
  await wait(900);

  await post("/api/meeting/run", {
    speed: 2,
    script: {
      config: {
        type: "standup",
        participants: ["pickle", "zoe", "ink", "cio"],
        facilitatorId: "pickle",
      },
      turns: [
        {
          agentId: "pickle",
          message: "Standup starting. Keep it tight and flag blockers clearly.",
          timestamp: Date.now(),
        },
        {
          agentId: "zoe",
          message: "Phase 2.5 wiring is moving cleanly. I’m validating meeting controls next.",
          timestamp: Date.now() + 1,
        },
        {
          agentId: "ink",
          message: "Research notes are trimmed into review points. No blocker from my side.",
          timestamp: Date.now() + 2,
        },
        {
          agentId: "cio",
          message: "Budget is stable. I need a concise delivery summary before midday.",
          timestamp: Date.now() + 3,
        },
      ],
      summary: "Standup complete. Owners are aligned and the team is back at desks.",
    },
  });

  await wait(1200);

  await post("/api/agent/complete", {
    agentId: "zoe",
    result: "Meeting controls reviewed",
    message: "Closing out the morning pass.",
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
