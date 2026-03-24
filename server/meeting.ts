import type { AgentEvent, MeetingRunRequest, MeetingScript, MeetingState, MeetingTurn, ServerMessage } from "../src/types";

interface MeetingEngineOptions {
  onBroadcast(message: ServerMessage): void;
  onApplyEvent(event: AgentEvent): void;
  onMeetingState(state: MeetingState): void;
}

const ENTER_DELAY_MS = 350;
const TURN_DELAY_MS = 4200;
const TYPING_LEAD_MS = 900;
const RETURN_DELAY_MS = 320;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("Aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function cloneTranscript(turns: MeetingTurn[]): MeetingTurn[] {
  return turns.map((turn) => ({ ...turn }));
}

export class MeetingEngine {
  private readonly options: MeetingEngineOptions;
  private state: MeetingState;
  private lastTranscript: MeetingScript | null;
  private runToken: symbol | null;
  private runController: AbortController | null;

  constructor(options: MeetingEngineOptions) {
    this.options = options;
    this.state = {
      active: false,
      transcript: [],
      progress: {
        currentTurn: 0,
        totalTurns: 0,
      },
      speed: 1,
      stopped: false,
    };
    this.lastTranscript = null;
    this.runToken = null;
    this.runController = null;
  }

  getState(): MeetingState {
    return {
      ...this.state,
      transcript: cloneTranscript(this.state.transcript),
      progress: { ...this.state.progress },
    };
  }

  getLastTranscript(): MeetingScript | null {
    return this.lastTranscript
      ? {
          config: { ...this.lastTranscript.config },
          turns: cloneTranscript(this.lastTranscript.turns),
          summary: this.lastTranscript.summary,
        }
      : null;
  }

  async run(request: MeetingRunRequest): Promise<MeetingState> {
    const { script } = request;
    const speed = request.speed ?? 1;
    const startedAt = Date.now();
    const token = Symbol("meeting-run");
    const controller = new AbortController();

    this.resetActiveMeeting(true);
    this.runToken = token;
    this.runController = controller;

    this.state = {
      active: true,
      config: { ...script.config },
      transcript: [],
      progress: {
        currentTurn: 0,
        totalTurns: script.turns.length,
      },
      currentSpeakerId: undefined,
      startedAt,
      speed,
      stopped: false,
    };
    this.pushState();

    this.options.onBroadcast({
      type: "meeting-start",
      config: script.config,
      participants: [...script.config.participants],
      startedAt,
      totalTurns: script.turns.length,
      speed,
    });

    try {
      for (const [index, agentId] of script.config.participants.entries()) {
        if (!this.isRunActive(token)) {
          return this.getState();
        }

        this.options.onApplyEvent({
          agentId,
          status: "entering",
          task: `${script.config.type} meeting`,
          message: index === 0 ? "Heading to the meeting room." : undefined,
          location: "meeting-room",
          timestamp: Date.now(),
        });
        await wait(Math.max(140, ENTER_DELAY_MS / speed), controller.signal);

        if (!this.isRunActive(token)) {
          return this.getState();
        }

        this.options.onApplyEvent({
          agentId,
          status: "meeting",
          task: `${script.config.type} meeting`,
          location: "meeting-room",
          timestamp: Date.now(),
        });
      }

      for (const [index, sourceTurn] of script.turns.entries()) {
        if (!this.isRunActive(token)) {
          return this.getState();
        }

        this.state.currentSpeakerId = sourceTurn.agentId;
        this.pushState();
        this.options.onBroadcast({
          type: "meeting-turn",
          agentId: sourceTurn.agentId,
          message: sourceTurn.message,
          turnIndex: index,
          totalTurns: script.turns.length,
          timestamp: Date.now(),
          isTyping: true,
        });

        await wait(Math.max(120, TYPING_LEAD_MS / speed), controller.signal);
        if (!this.isRunActive(token)) {
          return this.getState();
        }

        const completedTurn: MeetingTurn = {
          ...sourceTurn,
          timestamp: Date.now(),
        };
        this.state.transcript = [...this.state.transcript, completedTurn];
        this.state.progress = {
          currentTurn: index + 1,
          totalTurns: script.turns.length,
        };
        this.pushState();

        this.options.onApplyEvent({
          agentId: sourceTurn.agentId,
          status: "meeting",
          task: `${script.config.type} meeting`,
          message: sourceTurn.message,
          location: "meeting-room",
          timestamp: completedTurn.timestamp,
        });
        this.options.onBroadcast({
          type: "meeting-turn",
          agentId: sourceTurn.agentId,
          message: sourceTurn.message,
          turnIndex: index,
          totalTurns: script.turns.length,
          timestamp: completedTurn.timestamp,
        });

        await wait(Math.max(500, TURN_DELAY_MS / speed), controller.signal);
      }

      if (!this.isRunActive(token)) {
        return this.getState();
      }

      this.state.currentSpeakerId = script.config.facilitatorId;
      this.state.summary = script.summary;
      this.pushState();

      this.options.onBroadcast({
        type: "meeting-turn",
        agentId: script.config.facilitatorId,
        message: script.summary,
        turnIndex: script.turns.length,
        totalTurns: script.turns.length + 1,
        timestamp: Date.now(),
        isTyping: true,
      });
      await wait(Math.max(150, TYPING_LEAD_MS / speed), controller.signal);

      if (!this.isRunActive(token)) {
        return this.getState();
      }

      this.options.onApplyEvent({
        agentId: script.config.facilitatorId,
        status: "meeting",
        task: `${script.config.type} meeting`,
        message: script.summary,
        location: "meeting-room",
        timestamp: Date.now(),
      });

      const finalTranscript = cloneTranscript(this.state.transcript);
      this.lastTranscript = {
        config: { ...script.config },
        turns: finalTranscript,
        summary: script.summary,
      };

      const endedAt = Date.now();
      this.options.onBroadcast({
        type: "meeting-end",
        summary: script.summary,
        transcript: finalTranscript,
        endedAt,
      });

      for (const agentId of script.config.participants) {
        if (!this.isRunActive(token)) {
          return this.getState();
        }

        this.options.onApplyEvent({
          agentId,
          status: "idle",
          task: "",
          message: "",
          location: "desk",
          timestamp: Date.now(),
        });
        await wait(Math.max(120, RETURN_DELAY_MS / speed), controller.signal);
      }

      if (this.isRunActive(token)) {
        this.runToken = null;
        this.runController = null;
        this.state = {
          active: false,
          config: { ...script.config },
          transcript: finalTranscript,
          summary: script.summary,
          progress: {
            currentTurn: script.turns.length,
            totalTurns: script.turns.length,
          },
          currentSpeakerId: undefined,
          startedAt,
          speed,
          stopped: false,
        };
        this.pushState();
      }

      return this.getState();
    } catch (error) {
      if (controller.signal.aborted) {
        return this.getState();
      }
      throw error;
    }
  }

  async stop(): Promise<MeetingState> {
    this.resetActiveMeeting(true);
    return this.getState();
  }

  private isRunActive(token: symbol): boolean {
    return this.runToken === token;
  }

  private resetActiveMeeting(stopped: boolean): void {
    const stateBeforeStop = this.state;
    this.runToken = null;
    this.runController?.abort();
    this.runController = null;

    if (!stateBeforeStop.active || !stateBeforeStop.config) {
      return;
    }

    for (const agentId of stateBeforeStop.config.participants) {
      this.options.onApplyEvent({
        agentId,
        status: "idle",
        task: "",
        message: "",
        location: "desk",
        timestamp: Date.now(),
      });
    }

    this.state = {
      ...stateBeforeStop,
      active: false,
      currentSpeakerId: undefined,
      stopped,
    };
    this.pushState();
  }

  private pushState(): void {
    const snapshot = this.getState();
    this.options.onMeetingState(snapshot);
    this.options.onBroadcast({
      type: "meeting-status",
      state: snapshot,
    });
  }
}
