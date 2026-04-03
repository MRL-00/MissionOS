import type { ReactNode } from "react";
import { getMissionTaskBoardStage } from "../mission/taskBoard";
import type {
  HermesDefaults,
  MissionTask,
  ProviderConnector,
} from "../mission/types";
import type { ActivityLogEntry } from "../types";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function formatClockTime(timestamp?: number): string {
  if (!timestamp) {
    return "n/a";
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(timestamp?: number): string {
  if (!timestamp) {
    return "n/a";
  }

  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeUpdate(timestamp?: number): string {
  if (!timestamp) {
    return "No sync yet";
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) {
    return "Updated just now";
  }
  if (diffMinutes === 1) {
    return "Updated 1 minute ago";
  }
  if (diffMinutes < 60) {
    return `Updated ${diffMinutes} minutes ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  return `Updated ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
}

export function parseHermesRuntimePort(runtimeBaseUrl: string | undefined, runtimeHost: string | undefined): string {
  const runtimeUrl = runtimeBaseUrl?.trim() ?? "";
  const sharedHost = runtimeHost?.trim().replace(/\/+$/, "") ?? "";
  if (!runtimeUrl || !sharedHost || !runtimeUrl.startsWith(`${sharedHost}:`)) {
    return "";
  }
  return runtimeUrl.slice(sharedHost.length + 1).trim();
}

export function formatRelativeStamp(timestamp?: number): string {
  if (!timestamp) {
    return "n/a";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  if (diffMs < 60_000) {
    return "now";
  }

  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
}

export function taskCycleLabel(task: MissionTask): string {
  if (!task.cycle) {
    return "No cycle";
  }
  if (task.cycle.name && task.cycle.name !== "Cycle") {
    return task.cycle.name;
  }
  if (typeof task.cycle.number === "number") {
    return `Cycle ${task.cycle.number}`;
  }
  return "Cycle";
}

export function avatarLabel(name: string, emoji?: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return emoji?.trim() || "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 1).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function connectionTone(state: "connecting" | "connected" | "offline"): string {
  if (state === "connected") {
    return "bg-linear-teal/15 text-linear-teal border-linear-teal/25";
  }
  if (state === "connecting") {
    return "bg-linear-warm/15 text-linear-warm border-linear-warm/25";
  }
  return "bg-linear-red/15 text-linear-red border-linear-red/25";
}

export function statusTone(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("block") || normalized.includes("reject")) {
    return "bg-linear-red/15 text-linear-red border-linear-red/25";
  }
  if (normalized.includes("build")) {
    return "bg-sky-500/15 text-sky-200 border-sky-400/25";
  }
  if (normalized.includes("approve")) {
    return "bg-emerald-500/15 text-emerald-200 border-emerald-400/25";
  }
  if (normalized.includes("spec")) {
    return "bg-amber-500/15 text-amber-200 border-amber-400/25";
  }
  if (normalized.includes("pr ")) {
    return "bg-violet-500/15 text-violet-200 border-violet-400/25";
  }
  if (normalized.includes("review") || normalized.includes("qa") || normalized.includes("merge")) {
    return "bg-linear-warm/15 text-linear-warm border-linear-warm/25";
  }
  if (normalized.includes("done") || normalized.includes("complete")) {
    return "bg-linear-teal/15 text-linear-teal border-linear-teal/25";
  }
  return "bg-linear-surfaceAlt text-linear-ink border-linear-lineStrong";
}

export function taskWorkflowTone(task: MissionTask): string {
  switch (getMissionTaskBoardStage(task.state)) {
    case "todo":
      return "bg-sky-500/15 text-sky-200 border-sky-400/25";
    case "in_progress":
      return "bg-amber-500/15 text-amber-200 border-amber-400/25";
    case "qa_review":
      return "bg-orange-500/15 text-orange-200 border-orange-400/25";
    case "uat_review":
      return "bg-rose-500/15 text-rose-200 border-rose-400/25";
    case "ready_to_deploy":
      return "bg-cyan-500/15 text-cyan-200 border-cyan-400/25";
    case "deployed":
      return "bg-emerald-500/15 text-emerald-200 border-emerald-400/25";
    default:
      return statusTone(task.state.name);
  }
}

export function taskAutomationTone(task: MissionTask): string {
  const status = task.execution?.status ?? "idle";
  switch (status) {
    case "queued":
    case "running":
      return "bg-sky-500/15 text-sky-200 border-sky-400/25";
    case "review_ready":
      return "bg-amber-500/15 text-amber-200 border-amber-400/25";
    case "completed":
      return "bg-emerald-500/15 text-emerald-200 border-emerald-400/25";
    case "blocked":
    case "failed":
      return "bg-linear-red/15 text-linear-red border-linear-red/25";
    default:
      return "bg-linear-surfaceAlt text-linear-muted border-linear-lineStrong";
  }
}

export function taskAccentColor(task: MissionTask): string {
  switch (getMissionTaskBoardStage(task.state)) {
    case "todo":
      return "#38bdf8";
    case "in_progress":
      return "#fbbf24";
    case "qa_review":
      return "#fb923c";
    case "uat_review":
      return "#fb7185";
    case "ready_to_deploy":
      return "#22d3ee";
    case "deployed":
      return "#34d399";
    default:
      return "#3b4252";
  }
}

export function connectorTone(status: ProviderConnector["health"]["status"]): string {
  if (status === "ok") {
    return "bg-linear-teal/15 text-linear-teal border-linear-teal/25";
  }
  if (status === "syncing") {
    return "bg-linear-warm/15 text-linear-warm border-linear-warm/25";
  }
  if (status === "error") {
    return "bg-linear-red/15 text-linear-red border-linear-red/25";
  }
  return "bg-linear-surfaceAlt text-linear-muted border-linear-lineStrong";
}

export function SectionCard(props: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("mission-panel mission-card flex flex-col gap-4 p-5", props.className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="mission-wrap text-[15px] font-semibold leading-5 text-white">{props.title}</h2>
          {props.subtitle ? <p className="mission-muted mission-wrap mt-1.5">{props.subtitle}</p> : null}
        </div>
        {props.action ? <div className="shrink-0">{props.action}</div> : null}
      </div>
      {props.children}
    </section>
  );
}

export function MetricCard(props: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  const toneClass = props.tone === "good"
    ? "border-linear-teal/20"
    : props.tone === "warn"
      ? "border-linear-warm/20"
      : props.tone === "danger"
        ? "border-linear-red/25"
        : "border-linear-line";

  return (
    <article className={cx("mission-summary-card", toneClass)}>
      <div className="min-w-0 flex-1">
        <p className="mission-summary-label">{props.label}</p>
        {props.hint ? <p className="mission-summary-hint mission-wrap">{props.hint}</p> : null}
      </div>
      <div className="mission-summary-value shrink-0">{props.value}</div>
    </article>
  );
}

function activityKindIcon(kind: ActivityLogEntry["kind"]): string {
  switch (kind) {
    case "agent-message": return "\u{1F4AC}";
    case "agent-status": return "\u{1F504}";
    case "agent-spawn": return "\u{1F680}";
    case "agent-complete": return "\u2705";
    case "meeting-start": return "\u{1F4E2}";
    case "meeting-turn": return "\u{1F399}";
    case "meeting-end": return "\u{1F3C1}";
    case "meeting-stop": return "\u26D4";
    case "registration": return "\u{1F4CB}";
    case "workflow-item": return "\u{1F4DD}";
    case "workflow-handoff": return "\u{1F91D}";
    case "workflow-comment": return "\u{1F4AC}";
    case "workflow-qa": return "\u{1F50D}";
    default: return "\u2022";
  }
}

export function ActivityFeed(props: { entries: ActivityLogEntry[]; limit?: number; className?: string }) {
  const limit = props.limit ?? 20;
  const visible = props.entries.slice(0, limit);

  return (
    <div className={cx("min-w-0 space-y-2", props.className)}>
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-linear-line px-4 py-6 text-center text-linear-muted">
          No activity yet. Provider run updates, status changes, and runtime events will appear here in real time.
        </div>
      ) : (
        visible.map((entry) => (
          <article key={entry.id} className="mission-list-item">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-xs">{activityKindIcon(entry.kind)}</span>
              <div className="min-w-0 flex-1">
                <p className="mission-wrap text-sm leading-5 text-linear-ink">{entry.message}</p>
                <span className="mission-muted mt-1 block">{formatRelativeStamp(entry.timestamp)}</span>
              </div>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

export function MarkdownContent({ text }: { text: string }) {
  if (!text) {
    return null;
  }

  const lines = text.split("\n");
  const elements: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);

    if (headingMatch) {
      const level = (headingMatch[1] ?? "").length;
      const content = headingMatch[2] ?? "";
      const className = level === 1
        ? "text-base font-semibold text-white mt-3 mb-1"
        : level === 2
          ? "text-sm font-semibold text-white mt-3 mb-1"
          : "text-sm font-medium text-white/80 mt-2 mb-1";
      elements.push(
        <div key={index} className={className}>
          {renderInline(content)}
        </div>,
      );
      continue;
    }

    const standaloneImage = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (standaloneImage) {
      const imgUrl = standaloneImage[2] ?? "";
      const imgAlt = standaloneImage[1] || "image";
      elements.push(
        <a
          key={index}
          href={imgUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="my-2 block"
        >
          <img src={imgUrl} alt={imgAlt} className="mission-md-img" />
        </a>,
      );
      continue;
    }

    elements.push(
      <span key={index}>
        {index > 0 ? "\n" : null}
        {renderInline(line)}
      </span>,
    );
  }

  return <div className="mission-md-content whitespace-pre-wrap text-sm leading-6 text-linear-ink">{elements}</div>;
}

function renderInline(text: string): ReactNode[] {
  const inlineRe = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|`([^`]+)`/g;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined || match[2] !== undefined) {
      const imgUrl = match[2];
      const imgAlt = match[1] || "image";
      parts.push(
        <a
          key={`img-${match.index}`}
          href={imgUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="my-1 inline-block"
        >
          <img src={imgUrl} alt={imgAlt} className="mission-md-img" />
        </a>,
      );
    } else if (match[3] !== undefined) {
      parts.push(
        <a
          key={`link-${match.index}`}
          href={match[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-linear-teal underline decoration-linear-teal/30 underline-offset-2 transition hover:decoration-linear-teal/60"
        >
          {match[3]}
        </a>,
      );
    } else if (match[5] !== undefined) {
      parts.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-white">
          {match[5]}
        </strong>,
      );
    } else if (match[6] !== undefined) {
      parts.push(
        <code
          key={`code-${match.index}`}
          className="rounded bg-linear-surface px-1.5 py-0.5 text-[12px] text-linear-teal"
        >
          {match[6]}
        </code>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export type { HermesDefaults };
