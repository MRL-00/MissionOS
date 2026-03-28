import { useEffect, useRef } from "react";
import type { AgentRuntimeState } from "../../types";
import { MissionSceneController } from "./missionSceneController";

interface MissionSceneProps {
  agents: AgentRuntimeState[];
  selectedAgentId: string | null;
  onSelectAgent(agentId: string): void;
}

export function MissionScene({ agents, selectedAgentId, onSelectAgent }: MissionSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<MissionSceneController | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return undefined;
    }

    const controller = new MissionSceneController(hostRef.current, onSelectAgent);
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [onSelectAgent]);

  useEffect(() => {
    controllerRef.current?.setAgents(agents);
  }, [agents]);

  useEffect(() => {
    controllerRef.current?.setSelectedAgent(selectedAgentId);
  }, [selectedAgentId]);

  useEffect(() => {
    controllerRef.current?.setOnSelectAgent(onSelectAgent);
  }, [onSelectAgent]);

  return <div ref={hostRef} className="h-full min-h-[360px] w-full" />;
}
