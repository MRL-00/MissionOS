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

function getPathDistance(left, right) {
  const leftPosition = left.position ?? left.approach ?? left.sit;
  const rightPosition = right.position ?? right.approach ?? right.sit;
  return leftPosition.distanceTo(rightPosition);
}

function getDestinationPosition(destination) {
  return destination.position ?? destination.sit ?? destination.approach;
}

function buildNodePath(navigation, startId, endId) {
  if (!startId || !endId || startId === endId) {
    return [];
  }

  const queue = [{ id: startId, cost: 0, path: [startId] }];
  const seen = new Map([[startId, 0]]);

  while (queue.length) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift();

    if (current.id === endId) {
      return current.path.slice(1);
    }

    navigation[current.id].links.forEach((nextId) => {
      const nextCost = current.cost + getPathDistance(navigation[current.id], navigation[nextId]);
      const best = seen.get(nextId);

      if (best === undefined || nextCost < best) {
        seen.set(nextId, nextCost);
        queue.push({
          id: nextId,
          cost: nextCost,
          path: [...current.path, nextId],
        });
      }
    });
  }

  return [];
}

function moveAgent(context, agent, destination, options) {
  const destinationNodeId = destination.nodeId;
  const destinationPosition = getDestinationPosition(destination);
  const startNodeId = agent.navNodeId ?? destinationNodeId;
  const nodePath = buildNodePath(context.waypoints.navigation, startNodeId, destinationNodeId);
  const path = [];

  if (startNodeId && startNodeId !== destinationNodeId) {
    const startNode = context.waypoints.navigation[startNodeId];
    if (startNode && agent.mesh.position.distanceTo(startNode.position) > 0.12) {
      path.push(startNode.position);
    }
  }

  nodePath.forEach((nodeId) => {
    path.push(context.waypoints.navigation[nodeId].position);
  });

  agent.navNodeId = destinationNodeId;
  agent.setTarget(destinationPosition, {
    ...options,
    path,
  });
}

function seatAtDesk(context, agent, index) {
  const desk = getDesk(context, agent, index);
  if (!desk) {
    return;
  }

  moveAgent(context, agent, desk, {
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

  moveAgent(context, agent, seat, {
    facing: seat.facing,
    status: STATUS.meeting,
    seated: false,
  });
}

function moveToWaypoint(context, agent, waypoint, status = STATUS.idle) {
  moveAgent(context, agent, waypoint, {
    facing: waypoint.facing,
    status,
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
        moveToWaypoint(context, agents[0], context.waypoints.entrance);
      }

      if (agents[2]) {
        moveToWaypoint(context, agents[2], context.waypoints.kitchen);
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
        moveToWaypoint(context, agents[0], context.waypoints.kitchen);
      }

      const lastAgent = agents.at(-1);
      if (lastAgent && lastAgent !== agents[0]) {
        moveToWaypoint(context, lastAgent, context.waypoints.entrance);
      }
    },
  },
];

export function moveAgentToDestination(context, agent, destination, options) {
  moveAgent(context, agent, destination, options);
}

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
