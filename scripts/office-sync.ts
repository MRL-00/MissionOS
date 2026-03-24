/**
 * Office Sync — Watches OpenClaw agent sessions and pushes status updates to the office server.
 * Run: npx tsx scripts/office-sync.ts
 * 
 * Polls the OpenClaw gateway for active sessions every 5 seconds.
 * When an agent spawns → registers in office + sets "working"
 * When an agent completes → sets "idle"
 * When an agent is typing → sets "working" with task info
 */

const OFFICE_URL = process.env.OFFICE_URL ?? "http://localhost:3001";
const OPENCLAW_URL = process.env.OPENCLAW_URL ?? "http://localhost:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN ?? "";
const POLL_INTERVAL_MS = 5000;

// Known OpenClaw agents and their office config
const KNOWN_AGENTS: Record<string, { name: string; role: string; emoji: string; type: "resident" | "visitor" }> = {
  main: { name: "Pickle", role: "Project Manager", emoji: "🥒", type: "resident" },
  zoe: { name: "Zoe", role: "Lead Engineer", emoji: "👩‍💻", type: "resident" },
  ink: { name: "Ink", role: "Researcher", emoji: "🖋️", type: "resident" },
  harry: { name: "Harry", role: "Full-stack Dev", emoji: "💻", type: "resident" },
  kevin: { name: "Kevin", role: "Full-stack Dev", emoji: "💻", type: "resident" },
  danny: { name: "Danny", role: "iOS/Swift Dev", emoji: "📱", type: "resident" },
  johnny: { name: "Johnny", role: "QA Tester", emoji: "🧪", type: "resident" },
  tommy: { name: "Tommy", role: "QA Tester", emoji: "🧪", type: "resident" },
  randall: { name: "Randall", role: "Scrum Master", emoji: "📋", type: "resident" },
};

interface SessionInfo {
  sessionKey: string;
  status: string;
  agentId?: string;
  label?: string;
  task?: string;
  model?: string;
  runtime?: string;
}

const registeredAgents = new Set<string>();
const activeAgents = new Map<string, string>(); // agentId -> status

async function officePost(path: string, body: unknown): Promise<void> {
  try {
    await fetch(`${OFFICE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Office server might be down — don't crash
  }
}

async function registerAgent(agentId: string): Promise<void> {
  if (registeredAgents.has(agentId)) return;

  const config = KNOWN_AGENTS[agentId];
  if (!config) return;

  await officePost("/api/agent/register", {
    id: agentId === "main" ? "pickle" : agentId,
    name: config.name,
    role: config.role,
    emoji: config.emoji,
    type: config.type,
  });
  registeredAgents.add(agentId);
  console.log(`[office-sync] Registered ${config.name}`);
}

async function updateStatus(agentId: string, status: string, task?: string, message?: string): Promise<void> {
  const officeId = agentId === "main" ? "pickle" : agentId;
  await officePost(`/api/agent/${officeId}/status`, {
    agentId: officeId,
    status,
    task,
    message,
    location: "desk",
    timestamp: Date.now(),
  });
}

async function pollSessions(): Promise<void> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (OPENCLAW_TOKEN) {
      headers["Authorization"] = `Bearer ${OPENCLAW_TOKEN}`;
    }

    const response = await fetch(`${OPENCLAW_URL}/api/sessions?activeMinutes=30&messageLimit=1`, {
      headers,
    });

    if (!response.ok) {
      console.error(`[office-sync] OpenClaw API returned ${response.status}`);
      return;
    }

    const data = await response.json() as { sessions?: SessionInfo[] };
    const sessions = data.sessions ?? [];

    // Track which agents are currently active
    const currentlyActive = new Set<string>();

    for (const session of sessions) {
      // Extract agent ID from session key (e.g. "agent:zoe:subagent:..." → "zoe")
      const match = session.sessionKey?.match(/^agent:([^:]+)/);
      const agentId = match?.[1];
      if (!agentId || !KNOWN_AGENTS[agentId]) continue;

      currentlyActive.add(agentId);

      // Register if not already
      await registerAgent(agentId);

      // Determine status
      const isRunning = session.status === "running" || session.status === "active";
      const newStatus = isRunning ? "working" : "idle";
      const prevStatus = activeAgents.get(agentId);

      if (prevStatus !== newStatus) {
        const taskLabel = session.task || session.label || undefined;
        await updateStatus(agentId, newStatus, taskLabel);
        activeAgents.set(agentId, newStatus);
        const name = KNOWN_AGENTS[agentId].name;
        console.log(`[office-sync] ${name}: ${prevStatus ?? "unknown"} → ${newStatus}${taskLabel ? ` (${taskLabel.slice(0, 60)})` : ""}`);
      }
    }

    // Mark agents that are no longer active as idle
    for (const [agentId, status] of activeAgents) {
      if (!currentlyActive.has(agentId) && status !== "idle") {
        await updateStatus(agentId, "idle");
        activeAgents.set(agentId, "idle");
        console.log(`[office-sync] ${KNOWN_AGENTS[agentId]?.name ?? agentId}: working → idle (session ended)`);
      }
    }
  } catch (error) {
    console.error("[office-sync] Poll error:", error);
  }
}

async function main(): Promise<void> {
  console.log(`[office-sync] Starting — polling OpenClaw at ${OPENCLAW_URL} every ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`[office-sync] Pushing updates to office at ${OFFICE_URL}`);

  // Register Pickle immediately (always online when sync is running)
  await registerAgent("main");
  await updateStatus("main", "working", "Online and ready");

  // Start polling
  setInterval(pollSessions, POLL_INTERVAL_MS);
  await pollSessions();
}

main().catch(console.error);
