import type { AgentEvent, MeetingState, ServerMessage } from "../types";

interface OfficeWebSocketClientOptions {
  url?: string | undefined;
  onOpen?(): void;
  onClose?(): void;
  onEvent(event: AgentEvent): void;
  onServerMessage?(message: ServerMessage): void;
  onMeetingStatus?(state: MeetingState): void;
  onSnapshot?(message: Extract<ServerMessage, { type: "agents-snapshot" }>): void;
  onAgentRemoved?(agentId: string): void;
}

export class OfficeWebSocketClient {
  url: string;
  socket?: WebSocket | undefined;
  reconnectTimer?: number | undefined;
  shouldReconnect: boolean;
  onOpen?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  onEvent: (event: AgentEvent) => void;
  onServerMessage?: ((message: ServerMessage) => void) | undefined;
  onMeetingStatus?: ((state: MeetingState) => void) | undefined;
  onSnapshot?: ((message: Extract<ServerMessage, { type: "agents-snapshot" }>) => void) | undefined;
  onAgentRemoved?: ((agentId: string) => void) | undefined;

  constructor({
    url = "ws://localhost:3001",
    onOpen,
    onClose,
    onEvent,
    onServerMessage,
    onMeetingStatus,
    onSnapshot,
    onAgentRemoved,
  }: OfficeWebSocketClientOptions) {
    this.url = url;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onEvent = onEvent;
    this.onServerMessage = onServerMessage;
    this.onMeetingStatus = onMeetingStatus;
    this.onSnapshot = onSnapshot;
    this.onAgentRemoved = onAgentRemoved;
    this.shouldReconnect = true;
  }

  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }
    this.shouldReconnect = true;

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.reconnectTimer !== undefined) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
      this.onOpen?.();
    });

    socket.addEventListener("message", (message) => {
      const parsed = this.parseMessage(message.data);
      if (!parsed) {
        return;
      }

      this.onServerMessage?.(parsed);

      if (parsed.type === "agent-event") {
        this.onEvent(parsed.event);
        return;
      }

      if (parsed.type === "agents-snapshot") {
        this.onSnapshot?.(parsed);
        return;
      }

      if (parsed.type === "agent-removed") {
        this.onAgentRemoved?.(parsed.agentId);
        return;
      }

      if (parsed.type === "meeting-status") {
        this.onMeetingStatus?.(parsed.state);
      }
    });

    socket.addEventListener("close", () => {
      this.socket = undefined;
      this.onClose?.();
      if (!this.shouldReconnect) {
        return;
      }
      this.reconnectTimer = window.setTimeout(() => {
        this.connect();
      }, 2000);
    });
  }

  disconnect(): void {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.shouldReconnect = false;
    this.socket?.close();
    this.socket = undefined;
  }

  private parseMessage(raw: unknown): ServerMessage | null {
    if (typeof raw !== "string") {
      return null;
    }

    try {
      return JSON.parse(raw) as ServerMessage;
    } catch {
      return null;
    }
  }
}
