import { STATUS } from "./characters/agentController.js";

const STEPS = [
  {
    duration: 4,
    apply({ agents, waypoints }) {
      agents.pickle.setTarget(waypoints.entrance, { facing: Math.PI, status: STATUS.idle, seated: false });
      agents.zoe.setTarget(waypoints.desks.zoe.sit, {
        facing: waypoints.desks.zoe.facing,
        status: STATUS.working,
        seated: true,
      });
      agents.ink.setTarget(waypoints.kitchen, { facing: Math.PI / 2, status: STATUS.idle, seated: false });
      agents.cio.setTarget(waypoints.desks.cio.sit, {
        facing: waypoints.desks.cio.facing,
        status: STATUS.working,
        seated: true,
      });
    },
  },
  {
    duration: 6,
    apply({ agents, waypoints }) {
      agents.pickle.setTarget(waypoints.desks.pickle.sit, {
        facing: waypoints.desks.pickle.facing,
        status: STATUS.working,
        seated: true,
      });
      agents.zoe.setTarget(waypoints.meeting[1].position, {
        facing: waypoints.meeting[1].facing,
        status: STATUS.meeting,
        seated: false,
      });
      agents.ink.setTarget(waypoints.desks.ink.sit, {
        facing: waypoints.desks.ink.facing,
        status: STATUS.working,
        seated: true,
      });
      agents.cio.setTarget(waypoints.meeting[3].position, {
        facing: waypoints.meeting[3].facing,
        status: STATUS.meeting,
        seated: false,
      });
    },
  },
  {
    duration: 6,
    apply({ agents, waypoints }) {
      agents.pickle.setTarget(waypoints.meeting[0].position, {
        facing: waypoints.meeting[0].facing,
        status: STATUS.meeting,
        seated: false,
      });
      agents.zoe.setTarget(waypoints.meeting[1].position, {
        facing: waypoints.meeting[1].facing,
        status: STATUS.meeting,
        seated: false,
      });
      agents.ink.setTarget(waypoints.meeting[2].position, {
        facing: waypoints.meeting[2].facing,
        status: STATUS.meeting,
        seated: false,
      });
      agents.cio.setTarget(waypoints.meeting[3].position, {
        facing: waypoints.meeting[3].facing,
        status: STATUS.meeting,
        seated: false,
      });
    },
  },
  {
    duration: 5,
    apply({ agents, waypoints }) {
      agents.pickle.setTarget(waypoints.kitchen, { facing: 0, status: STATUS.idle, seated: false });
      agents.zoe.setTarget(waypoints.desks.zoe.sit, {
        facing: waypoints.desks.zoe.facing,
        status: STATUS.working,
        seated: true,
      });
      agents.ink.setTarget(waypoints.entrance, { facing: Math.PI, status: STATUS.idle, seated: false });
      agents.cio.setTarget(waypoints.desks.cio.sit, {
        facing: waypoints.desks.cio.facing,
        status: STATUS.working,
        seated: true,
      });
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
