import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlarmClockCheckIcon,
  CalendarClockIcon,
  Clock3Icon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import type { ScheduleRecord } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/dateFormat";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface SchedulesPageProps {
  mission: MissionControlState;
}

const CRON_PRESETS = [
  { label: "Weekdays 9am", cron: "0 9 * * 1-5" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 15 min", cron: "*/15 * * * *" },
  { label: "Daily 6:30pm", cron: "30 18 * * *" },
];

function formatTimestamp(value: string | null, timeZone?: string) {
  if (!value) {
    return "Never";
  }
  return formatDateTime(value, timeZone);
}

function formatRelative(value: string | null) {
  if (!value) {
    return "Not scheduled";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const deltaMs = date.getTime() - Date.now();
  const absMinutes = Math.max(1, Math.round(Math.abs(deltaMs) / 60000));
  if (absMinutes < 60) {
    return deltaMs >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return deltaMs >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  }
  const absDays = Math.round(absHours / 24);
  return deltaMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

function runLimitLabel(schedule: ScheduleRecord) {
  return schedule.max_runs ? `${schedule.run_count}/${schedule.max_runs}` : `${schedule.run_count}/∞`;
}

function isActiveRunStatus(status: string) {
  return status === "running" || status === "planning";
}

function agentLabel(agentId: string, mission: MissionControlState) {
  return mission.agents.find((agent) => agent.id === agentId)?.name ?? "Select agent";
}

function scheduleRunnableAgents(mission: MissionControlState, missionId?: string | null) {
  const supportedEngineIds = new Set((mission.engines ?? []).map((engine) => engine.id));
  const readyAgents = mission.agents.filter((agent) => agent.active && supportedEngineIds.has(agent.engine));
  if (!missionId) {
    return readyAgents;
  }
  const missionRecord = mission.missions.find((entry) => entry.id === missionId);
  if (!missionRecord) {
    return [];
  }
  const assignedAgentIds = new Set(missionRecord.assigned_agents.map((agent) => agent.id));
  return readyAgents.filter((agent) => assignedAgentIds.has(agent.id));
}

function missionLabel(missionId: string, mission: MissionControlState) {
  if (!missionId) {
    return "No mission";
  }
  return mission.missions.find((entry) => entry.id === missionId)?.title ?? "No mission";
}

function scheduleMissionFilterLabel(filter: string, mission: MissionControlState) {
  if (filter === "all") {
    return "All missions";
  }
  return mission.missions.find((entry) => entry.id === filter)?.title ?? "All missions";
}

function emptyDraft() {
  return {
    name: "",
    mission_id: "",
    agent_id: "",
    cron_expression: "0 9 * * 1-5",
    prompt: "",
    max_runs: "",
    enabled: true,
  };
}

export function SchedulesPage({ mission }: SchedulesPageProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("");
  const [deleteScheduleId, setDeleteScheduleId] = useState<string | null>(null);
  const [scheduleMissionFilter, setScheduleMissionFilter] = useState(() => mission.selectedMissionId ?? "all");

  const visibleSchedules = useMemo(
    () =>
      scheduleMissionFilter === "all"
        ? mission.schedules
        : mission.schedules.filter((schedule) => schedule.mission_id === scheduleMissionFilter),
    [mission.schedules, scheduleMissionFilter],
  );

  const scheduleToDelete = deleteScheduleId
    ? mission.schedules.find((s) => s.id === deleteScheduleId)
    : null;

  const activeSchedules = visibleSchedules.filter((schedule) => schedule.enabled).length;
  const pausedSchedules = visibleSchedules.length - activeSchedules;
  const totalExecutions = visibleSchedules.reduce((sum, schedule) => sum + schedule.run_count, 0);
  const scheduledRuns = useMemo(
    () => {
      const visibleScheduleIds = new Set(visibleSchedules.map((schedule) => schedule.id));
      return mission.runs.filter((run) => run.schedule_id && visibleScheduleIds.has(run.schedule_id));
    },
    [mission.runs, visibleSchedules],
  );
  const activeRunScheduleIds = useMemo(
    () => new Set(mission.runs.filter((run) => run.schedule_id && isActiveRunStatus(run.status)).map((run) => run.schedule_id as string)),
    [mission.runs],
  );
  const editingScheduleHasActiveRuns = editingId ? activeRunScheduleIds.has(editingId) : false;
  const runnableAgents = scheduleRunnableAgents(mission, draft.mission_id || null);

  useEffect(() => {
    if (scheduleMissionFilter !== "all" && !mission.missions.some((entry) => entry.id === scheduleMissionFilter)) {
      setScheduleMissionFilter("all");
    }
  }, [mission.missions, scheduleMissionFilter]);

  useEffect(() => {
    if (!editingId) {
      return;
    }
    const schedule = visibleSchedules.find((entry) => entry.id === editingId);
    if (!schedule) {
      setEditingId(null);
      setDraft(emptyDraft());
      return;
    }
    setDraft({
      name: schedule.name,
      mission_id: schedule.mission_id ?? "",
      agent_id: schedule.agent_id,
      cron_expression: schedule.cron_expression,
      prompt: schedule.prompt,
      max_runs: schedule.max_runs ? String(schedule.max_runs) : "",
      enabled: schedule.enabled,
    });
  }, [editingId, visibleSchedules]);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";

  function resetForm() {
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError("");
    setStatus("");
  }

  function loadSchedule(schedule: ScheduleRecord) {
    setEditingId(schedule.id);
    setDraft({
      name: schedule.name,
      mission_id: schedule.mission_id ?? "",
      agent_id: schedule.agent_id,
      cron_expression: schedule.cron_expression,
      prompt: schedule.prompt,
      max_runs: schedule.max_runs ? String(schedule.max_runs) : "",
      enabled: schedule.enabled,
    });
    setFormError("");
    setStatus("");
  }

  async function submitSchedule() {
    if (!draft.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!draft.agent_id) {
      setFormError("Select an agent.");
      return;
    }
    if (!runnableAgents.some((agent) => agent.id === draft.agent_id)) {
      setFormError(draft.mission_id ? "Select an agent assigned to this mission." : "Select an active supported agent.");
      return;
    }
    if (!draft.cron_expression.trim()) {
      setFormError("Cron expression is required.");
      return;
    }
    if (!draft.prompt.trim()) {
      setFormError("Task prompt is required.");
      return;
    }

    setFormError("");
    setStatus("");
    const payload = {
      name: draft.name.trim(),
      mission_id: draft.mission_id || null,
      agent_id: draft.agent_id,
      cron_expression: draft.cron_expression.trim(),
      prompt: draft.prompt.trim(),
      enabled: draft.enabled,
      max_runs: draft.max_runs.trim() ? Number(draft.max_runs.trim()) : null,
    };

    const result = editingId
      ? await mission.updateSchedule(editingId, payload)
      : await mission.createSchedule(payload);

    if (!result) {
      setFormError(mission.error ?? "Unable to save schedule.");
      return;
    }

    setStatus(editingId ? "Schedule updated." : "Schedule created.");
    if (!editingId) {
      setDraft(emptyDraft());
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6 grid grid-cols-4 gap-4">
          <ScheduleStatCard icon={<CalendarClockIcon className="size-4" />} label="Total Schedules" value={String(visibleSchedules.length)} />
          <ScheduleStatCard icon={<PlayCircleIcon className="size-4" />} label="Active Jobs" value={String(activeSchedules)} subtitle={`${pausedSchedules} paused`} accent />
          <ScheduleStatCard icon={<AlarmClockCheckIcon className="size-4" />} label="Executions" value={String(totalExecutions)} subtitle="all time" />
          <ScheduleStatCard icon={<Clock3Icon className="size-4" />} label="Server Timezone" value={timezone} compact />
        </div>

        <div className="grid grid-cols-[380px_1fr] gap-4">
          <div className="rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[15px] font-semibold text-white">{editingId ? "Edit Schedule" : "New Schedule"}</div>
                <div className="text-[12px] text-[#918f90]">Cron jobs run on the server’s local clock.</div>
              </div>
              {editingId ? (
                <button
                  onClick={resetForm}
                  className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                >
                  Reset
                </button>
              ) : null}
            </div>

            <div className="space-y-4">
              <Field label="Name">
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Morning backlog sweep"
                  className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-[#918f90]"
                />
              </Field>

              <Field label="Agent">
                <Select value={draft.agent_id} onValueChange={(value) => setDraft((current) => ({ ...current, agent_id: value ?? "" }))}>
                  <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                    <SelectValue placeholder="Select agent">{agentLabel(draft.agent_id, mission)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Select agent</SelectItem>
                    {runnableAgents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Mission">
                <Select
                  value={draft.mission_id}
                  onValueChange={(value) => {
                    const missionId = value ?? "";
                    setDraft((current) => {
                      const nextAgents = scheduleRunnableAgents(mission, missionId || null);
                      return {
                        ...current,
                        mission_id: missionId,
                        agent_id: nextAgents.some((agent) => agent.id === current.agent_id) ? current.agent_id : "",
                      };
                    });
                    if (formError) {
                      setFormError("");
                    }
                  }}
                  disabled={editingScheduleHasActiveRuns}
                >
                  <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                    <SelectValue placeholder="No mission">{missionLabel(draft.mission_id, mission)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No mission</SelectItem>
                    {mission.missions.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editingScheduleHasActiveRuns ? (
                  <div className="mt-2 text-[11px] text-[#918f90]">Mission changes are locked while this schedule has active runs.</div>
                ) : null}
              </Field>

              <Field label="Cron Expression">
                <input
                  value={draft.cron_expression}
                  onChange={(event) => setDraft((current) => ({ ...current, cron_expression: event.target.value }))}
                  placeholder="0 9 * * 1-5"
                  className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2.5 font-mono text-[13px] text-white outline-none placeholder:text-[#918f90]"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {CRON_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => setDraft((current) => ({ ...current, cron_expression: preset.cron }))}
                      className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[11px] text-[#c8c4d7] transition-colors hover:border-[#5e4ae3]/35 hover:text-white"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Prompt">
                <textarea
                  value={draft.prompt}
                  onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
                  placeholder="Review new issues in Linear, cluster them by urgency, and post a short summary."
                  rows={6}
                  className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-[#918f90]"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Max Runs">
                  <input
                    value={draft.max_runs}
                    onChange={(event) => setDraft((current) => ({ ...current, max_runs: event.target.value }))}
                    placeholder="Leave blank for unlimited"
                    inputMode="numeric"
                    className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-[#918f90]"
                  />
                </Field>
                <Field label="Status">
                  <Select value={draft.enabled ? "enabled" : "paused"} onValueChange={(value) => setDraft((current) => ({ ...current, enabled: (value ?? "enabled") === "enabled" }))}>
                    <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="enabled">Enabled</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {(formError || mission.error || status) ? (
                <div className={cn("rounded-lg border px-3 py-2 text-[12px]", status ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-red-500/20 bg-red-500/10 text-red-300")}>
                  {formError || mission.error || status}
                </div>
              ) : null}

              <button
                onClick={() => void submitSchedule()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2.5 text-[13px] font-medium text-white"
              >
                {editingId ? <RotateCwIcon className="size-4" /> : <PlusIcon className="size-4" />}
                {editingId ? "Update Schedule" : "Create Schedule"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-[#1c1b1c]">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <div>
                <div className="text-[15px] font-semibold text-white">Scheduled Jobs</div>
                <div className="text-[12px] text-[#918f90]">Click any job to load it into the editor.</div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={scheduleMissionFilter} onValueChange={(value) => setScheduleMissionFilter(value ?? "all")}>
                  <SelectTrigger className="w-[180px] border-white/[0.08] bg-[#0f0f10] text-[12px] text-white">
                    <SelectValue>{scheduleMissionFilterLabel(scheduleMissionFilter, mission)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All missions</SelectItem>
                    {mission.missions.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={() => void mission.refreshSchedules()}
                  className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="divide-y divide-white/[0.05]">
              {visibleSchedules.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <div className="text-[14px] font-medium text-white">No schedules yet</div>
                  <div className="mt-1 text-[12px] text-[#918f90]">Create a cron job to have an agent run recurring operational work.</div>
                </div>
              ) : null}

              {visibleSchedules.map((schedule) => (
                (() => {
                  const hasActiveRuns = activeRunScheduleIds.has(schedule.id);
                  return (
                    <div
                      key={schedule.id}
                      onClick={() => loadSchedule(schedule)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          loadSchedule(schedule);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "grid w-full grid-cols-[1.4fr_130px_150px_110px_auto] items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]",
                        editingId === schedule.id ? "bg-[#39147e]/[0.06]" : "",
                      )}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-white">{schedule.name}</span>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                              schedule.enabled
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                                : "border-white/[0.08] bg-white/[0.04] text-[#918f90]",
                            )}
                          >
                            {schedule.enabled ? "enabled" : "paused"}
                          </span>
                          {hasActiveRuns ? (
                            <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
                              running
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[12px] text-[#918f90]">
                          {schedule.agent_emoji ?? "🤖"} {schedule.agent_name ?? "Unknown agent"}
                        </div>
                        {schedule.mission_title ? (
                          <div className="mt-1 text-[12px] text-[#918f90]">{schedule.mission_title}</div>
                        ) : null}
                        <div className="mt-2 line-clamp-2 text-[12px] text-[#c8c4d7]">{schedule.prompt}</div>
                        {hasActiveRuns ? (
                          <div className="mt-2 text-[11px] text-[#918f90]">Active schedule runs must finish before deletion.</div>
                        ) : null}
                        {schedule.last_error ? (
                          <div className="mt-2 text-[11px] text-red-300">{schedule.last_error}</div>
                        ) : null}
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Cron</div>
                        <div className="mt-1 font-mono text-[12px] text-white">{schedule.cron_expression}</div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Next Run</div>
                        <div className="mt-1 text-[12px] text-white">{formatRelative(schedule.next_run_at)}</div>
                        <div className="mt-1 text-[11px] text-[#918f90]">{formatTimestamp(schedule.next_run_at, mission.settingsMap.user_timezone)}</div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Run Count</div>
                        <div className="mt-1 text-[12px] text-white">{runLimitLabel(schedule)}</div>
                        <div className="mt-1 text-[11px] text-[#918f90]">Last: {formatRelative(schedule.last_run_at)}</div>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void mission.runSchedule(schedule.id);
                          }}
                          className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                        >
                          Run now
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void mission.updateSchedule(schedule.id, {
                              name: schedule.name,
                              mission_id: schedule.mission_id,
                              agent_id: schedule.agent_id,
                              prompt: schedule.prompt,
                              cron_expression: schedule.cron_expression,
                              enabled: !schedule.enabled,
                              max_runs: schedule.max_runs,
                            });
                          }}
                          className="rounded-lg border border-white/[0.08] p-2 text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white"
                          aria-label={schedule.enabled ? "Pause schedule" : "Resume schedule"}
                        >
                          {schedule.enabled ? <PauseCircleIcon className="size-4" /> : <PlayCircleIcon className="size-4" />}
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!hasActiveRuns) {
                              setDeleteScheduleId(schedule.id);
                            }
                          }}
                          disabled={hasActiveRuns}
                          className={cn(
                            "rounded-lg border border-red-500/20 p-2 text-red-300 transition-colors hover:bg-red-500/10",
                            hasActiveRuns && "cursor-not-allowed opacity-45",
                          )}
                          aria-label="Delete schedule"
                        >
                          <Trash2Icon className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })()
              ))}
            </div>
          </div>
        </div>
      </div>

      <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#131314] p-5">
        <h3 className="text-[14px] font-semibold text-white">Cron Notes</h3>
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Format</div>
          <div className="font-mono text-[12px] text-white">minute hour day month weekday</div>
          <div className="mt-2 text-[12px] leading-relaxed text-[#918f90]">
            Use `*` for any value, `*/15` for intervals, and ranges like `1-5` for weekdays.
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Examples</div>
          <div className="space-y-2">
            {CRON_PRESETS.map((preset) => (
              <div key={preset.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <div className="text-[12px] font-medium text-white">{preset.label}</div>
                <div className="mt-1 font-mono text-[11px] text-[#918f90]">{preset.cron}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Recent Schedule Runs</div>
          <div className="space-y-2">
            {scheduledRuns.slice(0, 8).map((run) => (
              <div key={run.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12px] font-medium text-white">{run.agent_name ?? "Agent run"}</div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      run.status === "complete"
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                        : run.status === "failed"
                          ? "border-red-500/20 bg-red-500/10 text-red-300"
                          : "border-blue-500/20 bg-blue-500/10 text-blue-300",
                    )}
                  >
                    {run.status}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-[12px] text-[#c8c4d7]">{run.prompt}</div>
                <div className="mt-2 text-[11px] text-[#918f90]">{formatTimestamp(run.started_at, mission.settingsMap.user_timezone)}</div>
              </div>
            ))}
            {scheduledRuns.length === 0 ? (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-[12px] text-[#918f90]">
                Scheduled runs will appear here after the first execution.
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={deleteScheduleId !== null}
        onOpenChange={(open) => { if (!open) setDeleteScheduleId(null); }}
        title="Delete schedule"
        description={scheduleToDelete ? `"${scheduleToDelete.name}" will be permanently removed.` : "This schedule will be permanently removed."}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!deleteScheduleId) return;
          const ok = await mission.removeSchedule(deleteScheduleId);
          if (ok && editingId === deleteScheduleId) {
            resetForm();
          }
        }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">{label}</div>
      {children}
    </label>
  );
}

function ScheduleStatCard({
  icon,
  label,
  value,
  subtitle,
  accent,
  compact,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  accent?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] text-[#918f90]">
        <span className={cn("inline-flex size-7 items-center justify-center rounded-lg", accent ? "bg-[#39147e]/20 text-[#c6bfff]" : "bg-white/[0.04] text-[#c8c4d7]")}>
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <div className={cn("font-semibold text-white", compact ? "text-[18px]" : "text-2xl")}>{value}</div>
      {subtitle ? <div className="mt-1 text-[12px] text-[#918f90]">{subtitle}</div> : null}
    </div>
  );
}
