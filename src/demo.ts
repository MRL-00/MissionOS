import * as THREE from "three";
import { STATUS } from "./characters/agentController";
import type { AgentTargetOptions, DemoContext, DestinationWaypoint, NavigationNode } from "./types";

type MoveableDestination = DestinationWaypoint & {
  position?: THREE.Vector3;
  approach?: THREE.Vector3;
  sit?: THREE.Vector3;
};

type MoveableAgent = DemoContext["agents"] extends Map<string, infer Agent> ? Agent : never;

function getOrderedAgents(agents: DemoContext["agents"]): MoveableAgent[] {
  return Array.from(agents.values());
}

function getDesk(context: DemoContext, agent: MoveableAgent, index: number) {
  return context.deskAssignments.get(agent.id) ?? context.waypoints.deskSlots[index] ?? null;
}

function getMeetingSeat(context: DemoContext["waypoints"], index: number) {
  if (!context.meetingSeats.length) {
    return null;
  }
  return context.meetingSeats[index % context.meetingSeats.length] ?? null;
}

function getPathDistance(left: NavigationNode, right: NavigationNode): number {
  return left.position.distanceTo(right.position);
}

function getDestinationPosition(destination: MoveableDestination): THREE.Vector3 {
  return destination.position ?? destination.sit ?? destination.approach ?? new THREE.Vector3();
}

function buildNodePath(navigation: DemoContext["waypoints"]["navigation"], startId: string, endId: string): string[] {
  if (startId === endId) {
    return [];
  }

  const queue: Array<{ id: string; cost: number; path: string[] }> = [{ id: startId, cost: 0, path: [startId] }];
  const seen = new Map<string, number>([[startId, 0]]);

  while (queue.length > 0) {
    queue.sort((left, right) => left.cost - right.cost);
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (current.id === endId) {
      return current.path.slice(1);
    }

    const node = navigation[current.id];
    if (!node) {
      continue;
    }

    node.links.forEach((nextId) => {
      const nextNode = navigation[nextId];
      if (!nextNode) {
        return;
      }

      const nextCost = current.cost + getPathDistance(node, nextNode);
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

function moveAgent(
  context: DemoContext,
  agent: MoveableAgent,
  destination: MoveableDestination,
  options: AgentTargetOptions,
): void {
  const destinationNodeId = destination.nodeId;
  const destinationPosition = getDestinationPosition(destination);
  const startNodeId = agent.navNodeId ?? destinationNodeId;
  const nodePath = buildNodePath(context.waypoints.navigation, startNodeId, destinationNodeId);
  const path: THREE.Vector3[] = [];

  if (startNodeId !== destinationNodeId) {
    const startNode = context.waypoints.navigation[startNodeId];
    if (startNode && agent.mesh.position.distanceTo(startNode.position) > 0.12) {
      path.push(startNode.position.clone());
    }
  }

  nodePath.forEach((nodeId) => {
    const node = context.waypoints.navigation[nodeId];
    if (node) {
      path.push(node.position.clone());
    }
  });

  agent.navNodeId = destinationNodeId;
  agent.setTarget(destinationPosition, {
    ...options,
    path,
  });
}

function moveToDesk(context: DemoContext, agent: MoveableAgent, index: number): void {
  const desk = getDesk(context, agent, index);
  if (!desk) {
    return;
  }

  moveAgent(context, agent, desk, {
    facing: desk.facing,
    status: STATUS.working,
    seated: false,
  });
}

function moveToMeeting(context: DemoContext, agent: MoveableAgent, index: number): void {
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

function moveToWaypoint(context: DemoContext, agent: MoveableAgent, waypoint: MoveableDestination, status = STATUS.idle): void {
  moveAgent(context, agent, waypoint, {
    facing: waypoint.facing,
    status,
    seated: false,
  });
}

function applyToAllDesks(context: DemoContext): void {
  getOrderedAgents(context.agents).forEach((agent, index) => {
    moveToDesk(context, agent, index);
  });
}

const STEPS: Array<{ duration: number; apply(context: DemoContext): void }> = [
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
        moveToWaypoint(context, agents[0], context.waypoints.reception);
      }

      const lastAgent = agents.at(-1);
      if (lastAgent && lastAgent !== agents[0]) {
        moveToWaypoint(context, lastAgent, context.waypoints.kitchen);
      }
    },
  },
];

export function moveAgentToDestination(
  context: DemoContext,
  agent: MoveableAgent,
  destination: MoveableDestination,
  options: AgentTargetOptions,
): void {
  moveAgent(context, agent, destination, options);
}

export class DemoDirector {
  context: DemoContext;
  running: boolean;
  stepIndex: number;
  stepElapsed: number;

  constructor(context: DemoContext) {
    this.context = context;
    this.running = false;
    this.stepIndex = 0;
    this.stepElapsed = 0;
  }

  start(): void {
    this.running = true;
    this.stepIndex = 0;
    this.stepElapsed = 0;
    STEPS[0]?.apply(this.context);
  }

  stop(): void {
    this.running = false;
  }

  update(delta: number): void {
    if (!this.running) {
      return;
    }

    this.stepElapsed += delta;
    const current = STEPS[this.stepIndex];

    if (current && this.stepElapsed >= current.duration) {
      this.stepElapsed = 0;
      this.stepIndex = (this.stepIndex + 1) % STEPS.length;
      STEPS[this.stepIndex]?.apply(this.context);
    }
  }
}
