import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentChatPanel, TaskDetailPanel, TeamBootstrapPanel } from "./panels";

describe("TaskDetailPanel", () => {
  it("posts threaded replies with the selected parent comment id", async () => {
    const onComment = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskDetailPanel
        detail={{
          task: {
            id: "task-1",
            identifier: "EPIC-653",
            title: "Change login button to be RED",
            priority: 0,
            state: { name: "Todo" },
            team: { name: "EpicShot" },
            labels: [],
            createdAt: 0,
            updatedAt: 0,
            handoffCount: 0,
            commentCount: 2,
          },
          comments: [
            {
              id: "comment-1",
              taskId: "task-1",
              body: "Need the exact color token. ^Hermes",
              authorName: "matt",
              createdAt: 1,
              source: "linear",
            },
            {
              id: "comment-2",
              taskId: "task-1",
              body: "Use bg-red-500.",
              authorName: "matt",
              parentCommentId: "comment-1",
              createdAt: 2,
              source: "linear",
            },
          ],
          events: [],
          artifacts: [],
        }}
        activityLog={[]}
        busyKey={null}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onComment={onComment}
        onRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("Reply to matt..."), {
      target: { value: "Following up in-thread." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reply in thread" }));

    await waitFor(() => {
      expect(onComment).toHaveBeenCalledWith("task-1", {
        body: "Following up in-thread.",
        parentCommentId: "comment-1",
      });
    });
  });
});

describe("AgentChatPanel", () => {
  it("shows agent-scoped live updates that are missing from the fetched transcript", () => {
    render(
      <AgentChatPanel
        agent={{
          id: "pickle",
          name: "Pickle",
          role: "Orchestrator",
          connected: true,
          status: "working",
          location: "desk",
          timestamp: 10,
          backendLink: {
            provider: "hermes",
            connected: true,
          },
        }}
        messages={[
          {
            id: "assistant-1",
            role: "assistant",
            content: "I checked the queue.",
            timestamp: 5,
          },
        ]}
        activityLog={[
          {
            id: "activity-1",
            kind: "agent-message",
            agentId: "pickle",
            message: "Pickle: Run the backlog sync now.",
            timestamp: 15,
          },
          {
            id: "activity-2",
            kind: "agent-message",
            agentId: "pickle",
            message: "Pickle: I checked the queue.",
            timestamp: 16,
          },
        ]}
        loading={false}
        busyKey={null}
        onSend={vi.fn().mockResolvedValue(undefined)}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText("Live updates")).toBeInTheDocument();
    expect(screen.getByText("Pickle: Run the backlog sync now.")).toBeInTheDocument();
    expect(screen.queryByText("Pickle: I checked the queue.")).not.toBeInTheDocument();
    expect(screen.getByText("I checked the queue.")).toBeInTheDocument();
  });
});

describe("TeamBootstrapPanel", () => {
  it("submits discovered agents with the selected command lead and parent links", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);

    render(
      <TeamBootstrapPanel
        connectors={[
          {
            id: "hermes-core",
            provider: "hermes",
            label: "Hermes",
            enabled: true,
            baseUrl: "hermes",
            authMode: "none",
            tokenConfigured: false,
            capabilities: {
              agents: true,
              schedules: true,
              activeWork: true,
              launch: true,
              subscribe: true,
            },
            health: {
              provider: "hermes",
              status: "ok",
              checkedAt: 1,
              activeAgents: 2,
              schedules: 0,
            },
          },
        ]}
        providerAgents={[
          {
            connectorId: "hermes-core",
            provider: "hermes",
            externalId: "hermes",
            name: "Hermes",
            role: "Orchestrator",
            status: "idle",
            imported: false,
          },
          {
            connectorId: "hermes-core",
            provider: "hermes",
            externalId: "atlas",
            name: "Atlas",
            role: "Senior Engineer",
            reportsToExternalId: "hermes",
            status: "idle",
            imported: false,
          },
        ]}
        officeAgents={[]}
        teamSettings={{}}
        busyKey={null}
        onApply={onApply}
      />,
    );

    fireEvent.change(screen.getByLabelText("Command lead"), { target: { value: "hermes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save team setup" }));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith({
        commandAgentId: "hermes",
        defaultRunConnectorId: "hermes-core",
        agents: [
          {
            officeAgentId: "hermes",
            connectorId: "hermes-core",
            externalId: "hermes",
            name: "Hermes",
            role: "Orchestrator",
            emoji: undefined,
            type: "resident",
            parentOfficeAgentId: null,
          },
          {
            officeAgentId: "atlas",
            connectorId: "hermes-core",
            externalId: "atlas",
            name: "Atlas",
            role: "Senior Engineer",
            emoji: undefined,
            type: "resident",
            parentOfficeAgentId: "hermes",
          },
        ],
      });
    });
  });
});
