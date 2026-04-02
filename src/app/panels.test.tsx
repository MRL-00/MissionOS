import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentChatPanel, TaskDetailPanel } from "./panels";

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
          handoffs: [],
        }}
        agentNames={[]}
        activityLog={[]}
        busyKey={null}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onComment={onComment}
        onHandoff={vi.fn().mockResolvedValue(undefined)}
        onRun={vi.fn().mockResolvedValue(undefined)}
        onRespond={vi.fn().mockResolvedValue(undefined)}
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
