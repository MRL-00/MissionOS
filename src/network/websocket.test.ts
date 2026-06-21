import { OfficeWebSocketClient } from "./websocket";

type Listener = (event: { data?: unknown }) => void;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", {});
  }

  message(data: unknown): void {
    this.emit("message", { data });
  }

  close(): void {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", {});
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function getSocket(index: number): MockWebSocket {
  const socket = MockWebSocket.instances[index];
  if (!socket) {
    throw new Error(`Expected mock socket at index ${index}`);
  }
  return socket;
}

describe("OfficeWebSocketClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("routes known server messages to specific callbacks", () => {
    const onOpen = vi.fn();
    const onServerMessage = vi.fn();
    const onEvent = vi.fn();
    const onSnapshot = vi.fn();
    const onAgentRemoved = vi.fn();
    const onMeetingStatus = vi.fn();

    const client = new OfficeWebSocketClient({
      url: "ws://missionos.local",
      onOpen,
      onServerMessage,
      onEvent,
      onSnapshot,
      onAgentRemoved,
      onMeetingStatus,
    });

    client.connect();
    const socket = getSocket(0);
    socket.open();

    socket.message(JSON.stringify({ type: "agent-event", event: { id: "event-1" } }));
    socket.message(JSON.stringify({ type: "agents-snapshot", agents: [] }));
    socket.message(JSON.stringify({ type: "agent-removed", agentId: "agent-1" }));
    socket.message(JSON.stringify({ type: "meeting-status", state: { active: true } }));
    socket.message("not-json");
    socket.message({ type: "agent-event" });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onServerMessage).toHaveBeenCalledTimes(4);
    expect(onEvent).toHaveBeenCalledWith({ id: "event-1" });
    expect(onSnapshot).toHaveBeenCalledWith({ type: "agents-snapshot", agents: [] });
    expect(onAgentRemoved).toHaveBeenCalledWith("agent-1");
    expect(onMeetingStatus).toHaveBeenCalledWith({ active: true });
  });

  it("reconnects after unexpected closes but not after disconnect", () => {
    const onClose = vi.fn();
    const client = new OfficeWebSocketClient({
      url: "ws://missionos.local",
      onClose,
      onEvent: vi.fn(),
    });

    client.connect();
    const firstSocket = getSocket(0);
    firstSocket.close();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(2000);

    expect(MockWebSocket.instances).toHaveLength(2);

    client.disconnect();
    const secondSocket = getSocket(1);

    expect(secondSocket.closed).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("does not create a duplicate socket while an existing socket is open or connecting", () => {
    const client = new OfficeWebSocketClient({
      url: "ws://missionos.local",
      onEvent: vi.fn(),
    });

    client.connect();
    client.connect();
    getSocket(0).open();
    client.connect();

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
