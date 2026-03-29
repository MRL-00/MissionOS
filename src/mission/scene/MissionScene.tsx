import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AgentRuntimeState } from "../../types";
import {
  buildPlacements,
  formatStatus,
} from "./missionMapModel";
import {
  loadMissionMap,
  MISSION_MAP_URL,
  parseMissionMap,
  type MissionMapZone,
  type MissionTileMap,
} from "./missionTileMap";
import { missionOfficeFallbackData } from "./missionOfficeFallback";
import { createMissionPhaserRuntime, type MissionPhaserRuntime } from "./missionPhaserRuntime";

interface MissionSceneProps {
  agents: AgentRuntimeState[];
  selectedAgentId: string | null;
  onSelectAgent(agentId: string): void;
}

function toPercent(value: number, max: number): string {
  return `${(value / max) * 100}%`;
}

function viewportStyle(map: MissionTileMap): CSSProperties {
  return {
    ["--mission-map-aspect" as string]: `${map.pixelWidth} / ${map.pixelHeight}`,
  };
}

function zoneStyle(map: MissionTileMap, zone: MissionMapZone): CSSProperties {
  return {
    left: toPercent(zone.x, map.pixelWidth),
    top: toPercent(zone.y, map.pixelHeight),
    width: toPercent(zone.width, map.pixelWidth),
    height: toPercent(zone.height, map.pixelHeight),
    ["--zone-accent" as string]: zone.accent ?? "#8ce6a2",
  };
}

export function MissionScene({ agents, selectedAgentId, onSelectAgent }: MissionSceneProps) {
  const [map, setMap] = useState<MissionTileMap | null>(() => parseMissionMap(missionOfficeFallbackData, MISSION_MAP_URL));
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapResolved, setMapResolved] = useState(false);
  const sceneHostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<MissionPhaserRuntime | null>(null);
  const onSelectAgentRef = useRef(onSelectAgent);
  const latestRuntimeStateRef = useRef<{
    agents: ReturnType<typeof buildPlacements>;
    selectedAgentId: string | null;
  }>({
    agents: [],
    selectedAgentId: null,
  });

  useEffect(() => {
    onSelectAgentRef.current = onSelectAgent;
  }, [onSelectAgent]);

  useEffect(() => {
    let cancelled = false;

    void loadMissionMap(MISSION_MAP_URL)
      .then((loadedMap) => {
        if (cancelled) {
          return;
        }

        setMap(loadedMap);
        setMapError(null);
        setMapResolved(true);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Unable to load the authored mission map.";
        setMapError(message);
        setMapResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === "test" || !map || !mapResolved || !sceneHostRef.current) {
      return undefined;
    }

    let cancelled = false;

    void createMissionPhaserRuntime({
      parent: sceneHostRef.current,
      map,
      onSelectAgent: (agentId) => onSelectAgentRef.current(agentId),
    }).then((runtime) => {
      if (cancelled) {
        runtime.destroy();
        return;
      }

      runtimeRef.current = runtime;
      runtime.setState(latestRuntimeStateRef.current);
    }).catch((error: unknown) => {
      if (cancelled) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unable to start the office scene runtime.";
      setMapError(message);
    });

    return () => {
      cancelled = true;
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
  }, [map, mapResolved]);

  const placements = useMemo(() => (
    map ? buildPlacements(agents, map) : []
  ), [agents, map]);

  latestRuntimeStateRef.current = {
    agents: placements,
    selectedAgentId,
  };

  useEffect(() => {
    runtimeRef.current?.setState(latestRuntimeStateRef.current);
  }, [placements, selectedAgentId]);

  const selectedPlacement = placements.find((entry) => entry.agent.id === selectedAgentId) ?? null;
  const selectedZone = selectedPlacement && map
    ? map.zones.find((zone) => zone.label === selectedPlacement.point.zone) ?? null
    : null;
  const workingCount = agents.filter((agent) => agent.status === "working" && agent.connected).length;
  const meetingCount = agents.filter((agent) => agent.status === "meeting" && agent.connected).length;
  const selectedSummary = selectedPlacement
    ? selectedPlacement.agent.message ?? selectedPlacement.agent.task ?? selectedZone?.summary ?? "No active update from this agent."
    : map?.description ?? "Click an agent to inspect the live mission feed.";

  if (!map) {
    return (
      <div className="mission-map" data-testid="mission-scene">
        <div className="mission-map__viewport">
          <div className="mission-map__empty">
            <div className="mission-map__empty-title">{mapError ? "Map load failed" : "Loading office layout"}</div>
            <div className="mission-map__empty-copy">
              {mapError ?? "Reading the authored Tiled map and assembling walkable zones."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mission-map" data-testid="mission-scene">
      <div className="mission-map__viewport" style={viewportStyle(map)}>
        <div ref={sceneHostRef} className="mission-map__canvas-host" />

        {map.zones.map((zone) => (
          <div key={zone.id} aria-hidden="true" className="mission-map__zone" style={zoneStyle(map, zone)}>
            <div className="mission-map__zone-label">{zone.label}</div>
          </div>
        ))}

        <div className="mission-map__a11y-list" aria-label="Office agents">
          {placements.map((placement) => (
            <button
              key={placement.agent.id}
              type="button"
              onClick={() => onSelectAgent(placement.agent.id)}
              aria-label={`${placement.agent.name}, ${formatStatus(placement.agent.status, placement.agent.connected)}, ${placement.point.zone}`}
              aria-pressed={placement.agent.id === selectedAgentId}
            >
              {placement.agent.name}
            </button>
          ))}
        </div>

        <div className="mission-map__hud">
          <div className="mission-map__panel">
            <div className="mission-map__eyebrow">{map.theme}</div>
            <div className="mission-map__title">
              {selectedPlacement ? `${selectedPlacement.agent.name} @ ${selectedPlacement.point.zone}` : map.title}
            </div>
            <div className="mission-map__copy">
              {selectedZone?.summary ?? map.description}
            </div>
          </div>

          <div className="mission-map__legend">
            <span className="mission-map__chip">
              <span className="mission-map__chip-dot mission-map__chip-dot--working" />
              Working {workingCount}
            </span>
            <span className="mission-map__chip">
              <span className="mission-map__chip-dot mission-map__chip-dot--meeting" />
              Meeting {meetingCount}
            </span>
            <span className="mission-map__chip">
              <span className="mission-map__chip-dot mission-map__chip-dot--linked" />
              Linked {agents.length}
            </span>
          </div>
        </div>

        <div className="mission-map__statusbar">
          <div className="mission-map__ticker">
            {selectedPlacement ? (
              <>
                <strong>{selectedPlacement.agent.name}</strong>
                <span>{formatStatus(selectedPlacement.agent.status, selectedPlacement.agent.connected)} · {selectedPlacement.point.zone}</span>
              </>
            ) : (
              <>
                <strong>{map.title}</strong>
                <span>Authored office map online. Pick an agent to inspect their current feed.</span>
              </>
            )}
          </div>
          <div className="mission-map__ticker mission-map__ticker--secondary">
            <span>{selectedSummary}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
