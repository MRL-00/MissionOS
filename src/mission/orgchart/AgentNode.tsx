import { forwardRef, memo } from "react";
import type { AgentRuntimeState } from "../../types";
import { formatStatus, providerLabel, statusColor } from "./agentUtils";

interface AgentNodeProps {
  agent: AgentRuntimeState;
  selected: boolean;
  thinking?: boolean;
  onSelect(agentId: string): void;
}

export const AgentNode = memo(forwardRef<HTMLDivElement, AgentNodeProps>(
  function AgentNode({ agent, selected, thinking, onSelect }, ref) {
    const provider = (agent as AgentRuntimeState & { backendLink?: { provider?: string } }).backendLink?.provider;
    const color = statusColor(agent);
    const status = formatStatus(agent.status, agent.connected);
    const initials = agent.name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

    return (
      <div
        ref={ref}
        className={`org-chart__node${selected ? " org-chart__node--selected" : ""}${thinking ? " org-chart__node--thinking" : ""}`}
        onClick={() => onSelect(agent.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(agent.id); }}
        aria-pressed={selected}
        aria-label={`${agent.name}, ${status}`}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-linear-line bg-linear-surface text-[11px] font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-white">{agent.name}</span>
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
                title={status}
              />
            </div>
            <div className="mt-0.5 truncate text-xs text-linear-muted">{agent.role}</div>
            {provider && provider !== "unlinked" && (
              <div className="mt-1.5">
                <span className="mission-badge text-[10px]">{providerLabel(provider)}</span>
              </div>
            )}
          </div>
        </div>
        {agent.task && (
          <div className="mt-2.5 border-t border-linear-line pt-2 text-[11px] leading-[1.35] text-linear-muted">
            {agent.task}
          </div>
        )}
      </div>
    );
  },
));
