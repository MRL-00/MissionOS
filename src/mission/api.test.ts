import { describe, expect, it } from "vitest";
import {
  fetchAgents,
  fetchIssueComments,
  fetchIssues,
  fetchMissions,
  fetchRelationships,
  fetchRuns,
  fetchSchedules,
  formatRequestError,
  ISSUE_COMMENT_LIMIT,
  isUnauthorizedRequestError,
  parseResponsePayload,
  parseRunStreamChunk,
  RequestError,
  streamRun,
  WORKSPACE_AGENT_LIMIT,
  WORKSPACE_ISSUE_LIMIT,
  WORKSPACE_MISSION_LIMIT,
  WORKSPACE_RELATIONSHIP_LIMIT,
  WORKSPACE_RUN_LIMIT,
  WORKSPACE_SCHEDULE_LIMIT,
} from "./api";

describe("parseResponsePayload", () => {
  it("parses JSON and ignores empty or malformed response text", () => {
    expect(parseResponsePayload('{"ok":true}')).toEqual({ ok: true });
    expect(parseResponsePayload("")).toBeNull();
    expect(parseResponsePayload("<html>bad gateway</html>")).toBeNull();
  });
});

describe("formatRequestError", () => {
  it("prefers API error payloads and falls back to status codes", () => {
    expect(formatRequestError(400, { error: "Invalid payload." })).toBe("Invalid payload.");
    expect(formatRequestError(502, null)).toBe("Request failed with status 502");
  });
});

describe("RequestError", () => {
  it("preserves HTTP status and payload for auth-aware handling", () => {
    const error = new RequestError(401, { error: "Invalid token." });

    expect(error.message).toBe("Invalid token.");
    expect(error.status).toBe(401);
    expect(error.payload).toEqual({ error: "Invalid token." });
    expect(isUnauthorizedRequestError(error)).toBe(true);
    expect(isUnauthorizedRequestError(new RequestError(403, { error: "Forbidden." }))).toBe(false);
    expect(isUnauthorizedRequestError(new Error("Invalid token."))).toBe(false);
  });
});

describe("parseRunStreamChunk", () => {
  it("parses valid SSE data events and ignores malformed chunks", () => {
    expect(parseRunStreamChunk('event: message\ndata: {"type":"output","output":"hello"}')).toEqual({
      type: "output",
      output: "hello",
    });
    expect(parseRunStreamChunk("data: not json")).toBeNull();
    expect(parseRunStreamChunk('data: {"output":"missing type"}')).toBeNull();
    expect(parseRunStreamChunk(": heartbeat")).toBeNull();
  });
});

describe("streamRun", () => {
  it("ignores malformed stream frames and flushes a final unterminated event", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"type":"output","output":"first"}\n\n'));
            controller.enqueue(encoder.encode("data: not json\n\n"));
            controller.enqueue(encoder.encode('data: {"type":"complete","status":"complete"}'));
            controller.close();
          },
        }),
      })),
    );
    const events: unknown[] = [];

    await streamRun("token", "run-1", (event) => events.push(event));

    expect(events).toEqual([
      { type: "output", output: "first" },
      { type: "complete", status: "complete" },
    ]);
  });

  it("throws RequestError for unauthorized stream responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => '{"error":"Invalid token."}',
      })),
    );

    await expect(streamRun("token", "run-1", () => undefined)).rejects.toMatchObject({
      name: "RequestError",
      status: 401,
      message: "Invalid token.",
    });
  });
});

describe("workspace fetch limits", () => {
  it("requests backend max limits for large workspaces", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      text: async () => "{}",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAgents("token");
    await fetchRelationships("token");
    await fetchMissions("token");
    await fetchIssues("token");
    await fetchRuns("token");
    await fetchSchedules("token");
    await fetchIssueComments("token", "issue-1");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      expect.stringContaining(`/api/agents?limit=${WORKSPACE_AGENT_LIMIT}`),
      expect.stringContaining(`/api/relationships?limit=${WORKSPACE_RELATIONSHIP_LIMIT}`),
      expect.stringContaining(`/api/missions?limit=${WORKSPACE_MISSION_LIMIT}`),
      expect.stringContaining(`/api/issues?limit=${WORKSPACE_ISSUE_LIMIT}`),
      expect.stringContaining(`/api/runs?limit=${WORKSPACE_RUN_LIMIT}`),
      expect.stringContaining(`/api/schedules?limit=${WORKSPACE_SCHEDULE_LIMIT}`),
      expect.stringContaining(`/api/issues/issue-1/comments?limit=${ISSUE_COMMENT_LIMIT}`),
    ]);
  });

  it("allows filtered issue and run requests to override list limits", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
      ok: true,
      text: async () => "{}",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchIssues("token", { mission_id: "mission-1", limit: "25" });
    await fetchRuns("token", { issue_id: "issue-1", limit: "50" });
    await fetchSchedules("token", { mission_id: "mission-1", limit: "10" });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain("/api/issues?limit=25&mission_id=mission-1");
    expect(urls[1]).toContain("/api/runs?limit=50&issue_id=issue-1");
    expect(urls[2]).toContain("/api/schedules?limit=10&mission_id=mission-1");
  });
});
