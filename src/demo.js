import { STATUS } from "./characters/agentController.js";

function getOrderedAgents(agents) {
  return Array.from(agents.values());
}

function getDesk(context, agent, index) {
  return context.deskAssignments.get(agent.id) ?? context.waypoints.deskSlots[index] ?? null;
}

function getMeetingSeat(waypoints, index) {
  if (!waypoints.meetingSeats.length) {
    return null;
  }
  return waypoints.meetingSeats[index % waypoints.meetingSeats.length];
}

function seatAtDesk(context, agent, index) {
  const desk = getDesk(context, agent, index);
  if (!desk) {
    return;
  }

  agent.setTarget(desk.sit, {
    facing: desk.facing,
    status: STATUS.working,
    seated: true,
  });
}

function moveToMeeting(context, agent, index) {
  const seat = getMeetingSeat(context.waypoints, index);
  if (!seat) {
    return;
  }

  agent.setTarget(seat.position, {
    facing: seat.facing,
    status: STATUS.meeting,
    seated: false,
  });
}

function applyToAllDesks(context) {
  getOrderedAgents(context.agents).forEach((agent, index) => {
    seatAtDesk(context, agent, index);
  });
}

const STEPS = [
  {
    duration: 4,
    apply(context) {
      const agents = getOrderedAgents(context.agents);
      applyToAllDesks(context);

      if (agents[0]) {
        agents[0].setTarget(context.waypoints.entrance, { facing: Math.PI, status: STATUS.idle, seated: false });
      }

      if (agents[2]) {
        agents[2].setTarget(context.waypoints.kitchen, { facing: Math.PI / 2, status: STATUS.idle, seated: false });
      }
    },
  },
  {
    duration: 6,
    apply(context) {
      const agents = getOrderedAgents(context.agents);
      applyToAllDesks(context);

      agents.slice(1, 3).forEach((agent, index) => {
        moveToMeeting(context, agent, index + 1);
      });
    },
  },
  {
    duration: 6,
    apply(context) {
      getOrderedAgents(context.agents).forEach((agent, index) => {
        moveToMeeting(context, agent, index);
      });
    },
  },
  {
    duration: 5,
    apply(context) {
      const agents = getOrderedAgents(context.agents);
      applyToAllDesks(context);

      if (agents[0]) {
        agents[0].setTarget(context.waypoints.kitchen, { facing: 0, status: STATUS.idle, seated: false });
      }

      const lastAgent = agents.at(-1);
      if (lastAgent && lastAgent !== agents[0]) {
        lastAgent.setTarget(context.waypoints.entrance, { facing: Math.PI, status: STATUS.idle, seated: false });
      }
    },
  },
];

export class DemoDirector {
  constructor(context) {
    this.context = context;
    this.running = false;
    this.stepIndex = 0;
    this.stepElapsed = 0;
  }

  start() {
    this.running = true;
    this.stepIndex = 0;
    this.stepElapsed = 0;
    STEPS[0].apply(this.context);
  }

  stop() {
    this.running = false;
  }

  update(delta) {
    if (!this.running) {
      return;
    }

    this.stepElapsed += delta;
    const current = STEPS[this.stepIndex];

    if (this.stepElapsed >= current.duration) {
      this.stepElapsed = 0;
      this.stepIndex = (this.stepIndex + 1) % STEPS.length;
      STEPS[this.stepIndex].apply(this.context);
    }
  }
}
