import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  CableIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  Clock3Icon,
  CogIcon,
  GitBranchIcon,
  PlayIcon,
  SparklesIcon,
} from "lucide-react";
import type { MissionControlState } from "../mission/hooks/useMissionControl";
import { OrgChart } from "../mission/orgchart/OrgChart";
import { formatProviderAgentStatus } from "../mission/providerAgents";
import { compareMissionTasksForBoard, getMissionTaskBoardStage } from "../mission/taskBoard";
import type {
  AdapterConfigField,
  HermesDefaults,
  MissionTask,
  MissionTaskDetail,
  MissionTeamBootstrapRequest,
  ProviderAgentRecord,
  ProviderConnector,
  ProviderConnectorUpdateRequest,
} from "../mission/types";
import type { AgentRuntimeState } from "../types";
import {
  ActivityFeed,
  MarkdownContent,
  formatDateTime,
  formatRelativeStamp,
  formatRelativeUpdate,
  parseHermesRuntimePort,
} from "./shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TeamDraftRow = {
  key: string;
  connectorId: string;
  provider: ProviderConnector["provider"];
  externalId: string;
  selected: boolean;
  name: string;
  role: string;
  officeAgentId: string;
  emoji: string;
  parentOfficeAgentId: string;
  sourceKind: "provider" | "connector";
  sourceLabel: string;
  statusLabel: string;
};

function normalizeOfficeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
}

function avatarInitials(name: string, emoji?: string): string {
  if (emoji?.trim()) return emoji.trim();
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function suggestRole(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("hermes")) return "Command lead";
  if (normalized.includes("scout")) return "Lead engineer";
  if (normalized.includes("atlas")) return "Senior engineer";
  if (normalized.includes("orbit")) return "Specialist engineer";
  if (normalized.includes("claude")) return "Writing specialist";
  if (normalized.includes("codex")) return "Implementation engineer";
  return "Team member";
}

function suggestEmoji(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("hermes")) return "🧠";
  if (normalized.includes("scout")) return "🧭";
  if (normalized.includes("atlas")) return "🛠";
  if (normalized.includes("orbit")) return "📱";
  if (normalized.includes("claude")) return "✍️";
  if (normalized.includes("codex")) return "⚙️";
  return "•";
}

function taskExecutionClass(status: string | undefined): string {
  if (!status) return "border-border/70 bg-muted/40 text-muted-foreground";
  if (status === "completed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "running" || status === "queued") return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  if (status === "review_ready") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "blocked" || status === "failed") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  return "border-border/70 bg-muted/40 text-muted-foreground";
}

function healthClass(status: ProviderConnector["health"]["status"]): string {
  if (status === "ok") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "syncing") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "error") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  return "border-border/70 bg-muted/40 text-muted-foreground";
}

function stateClass(task: MissionTask): string {
  const stage = getMissionTaskBoardStage(task.state);
  if (stage === "todo") return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  if (stage === "in_progress") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (stage === "qa_review" || stage === "uat_review" || stage === "ready_to_deploy") {
    return "border-violet-500/30 bg-violet-500/10 text-violet-200";
  }
  if (stage === "deployed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  return "border-border/70 bg-muted/40 text-muted-foreground";
}

function buildTeamDraft(connectors: ProviderConnector[], providerAgents: ProviderAgentRecord[], officeAgents: AgentRuntimeState[]): TeamDraftRow[] {
  const rows: TeamDraftRow[] = [];
  const usedConnectors = new Set<string>();
  const officeByLink = new Map<string, AgentRuntimeState>();

  officeAgents.forEach((agent) => {
    const connectorId = agent.backendLink?.connectorId?.trim();
    const externalId = agent.backendLink?.agentId?.trim();
    if (connectorId && externalId) {
      officeByLink.set(`${connectorId}:${externalId}`, agent);
    }
  });

  providerAgents.forEach((providerAgent) => {
    usedConnectors.add(providerAgent.connectorId);
    const linkedAgent = providerAgent.officeAgentId
      ? officeAgents.find((agent) => agent.id === providerAgent.officeAgentId)
      : officeByLink.get(`${providerAgent.connectorId}:${providerAgent.externalId}`);

    rows.push({
      key: `provider:${providerAgent.connectorId}:${providerAgent.externalId}`,
      connectorId: providerAgent.connectorId,
      provider: providerAgent.provider,
      externalId: providerAgent.externalId,
      selected: providerAgent.imported || Boolean(linkedAgent),
      name: linkedAgent?.name ?? providerAgent.name,
      role: linkedAgent?.role ?? providerAgent.title ?? providerAgent.role ?? suggestRole(providerAgent.name),
      officeAgentId: linkedAgent?.id ?? normalizeOfficeId(providerAgent.name),
      emoji: linkedAgent?.emoji ?? suggestEmoji(providerAgent.name),
      parentOfficeAgentId: linkedAgent?.parentAgentId ?? "",
      sourceKind: "provider",
      sourceLabel: providerAgent.name,
      statusLabel: formatProviderAgentStatus(providerAgent),
    });
  });

  connectors.filter((connector) => connector.enabled).forEach((connector) => {
    if (usedConnectors.has(connector.id)) return;
    const linkedAgent = officeAgents.find((agent) => agent.backendLink?.connectorId === connector.id);
    rows.push({
      key: `connector:${connector.id}`,
      connectorId: connector.id,
      provider: connector.provider,
      externalId: linkedAgent?.backendLink?.agentId ?? normalizeOfficeId(connector.label),
      selected: Boolean(linkedAgent),
      name: linkedAgent?.name ?? connector.label,
      role: linkedAgent?.role ?? suggestRole(connector.label),
      officeAgentId: linkedAgent?.id ?? normalizeOfficeId(connector.label),
      emoji: linkedAgent?.emoji ?? suggestEmoji(connector.label),
      parentOfficeAgentId: linkedAgent?.parentAgentId ?? "",
      sourceKind: "connector",
      sourceLabel: `${connector.label} runtime`,
      statusLabel: connector.health.status,
    });
  });

  return applyRecommendedStructure(rows);
}

function applyRecommendedStructure(rows: TeamDraftRow[]): TeamDraftRow[] {
  const hermes = rows.find((row) => row.name.toLowerCase().includes("hermes"));
  const scout = rows.find((row) => row.name.toLowerCase().includes("scout"));

  return rows.map((row) => {
    if (row.parentOfficeAgentId) return row;
    const normalized = row.name.toLowerCase();
    if (normalized.includes("hermes")) return { ...row, parentOfficeAgentId: "" };
    if (normalized.includes("scout")) return { ...row, parentOfficeAgentId: hermes?.officeAgentId ?? "" };
    if (normalized.includes("atlas") || normalized.includes("orbit")) {
      return { ...row, parentOfficeAgentId: scout?.officeAgentId ?? hermes?.officeAgentId ?? "" };
    }
    return row;
  });
}

function guessCommandLead(rows: TeamDraftRow[]): string {
  return rows.find((row) => row.name.toLowerCase().includes("hermes"))?.officeAgentId
    ?? rows.find((row) => row.selected)?.officeAgentId
    ?? rows[0]?.officeAgentId
    ?? "";
}

function buildTeamRequest(rows: TeamDraftRow[], commandAgentId: string, defaultRunConnectorId: string): MissionTeamBootstrapRequest {
  return {
    commandAgentId: commandAgentId || undefined,
    defaultRunConnectorId: defaultRunConnectorId || undefined,
    agents: rows
      .filter((row) => row.selected)
      .map((row) => ({
        officeAgentId: row.officeAgentId.trim(),
        connectorId: row.connectorId,
        externalId: row.externalId.trim(),
        name: row.name.trim(),
        role: row.role.trim(),
        emoji: row.emoji.trim() || undefined,
        type: "resident" as const,
        parentOfficeAgentId: row.parentOfficeAgentId.trim() || null,
      })),
  };
}

function groupTasks(tasks: MissionTask[]) {
  const groups = {
    todo: [] as MissionTask[],
    in_progress: [] as MissionTask[],
    review: [] as MissionTask[],
    done: [] as MissionTask[],
  };

  tasks.forEach((task) => {
    const stage = getMissionTaskBoardStage(task.state);
    if (stage === "todo" || stage === "backlog" || stage === "other") groups.todo.push(task);
    else if (stage === "in_progress") groups.in_progress.push(task);
    else if (stage === "qa_review" || stage === "uat_review" || stage === "ready_to_deploy") groups.review.push(task);
    else groups.done.push(task);
  });

  return groups;
}

function JourneyCard() {
  const steps = [
    { title: "Connect runtimes", copy: "Point Hermes, Claude, or Codex at your gateways and make sure they are healthy." },
    { title: "Build the org", copy: "Decide who is Hermes, Scout, Atlas, and Orbit. Save the org once." },
    { title: "Run the first task", copy: "Choose a synced Linear task and submit it to the command lead." },
    { title: "Watch the run", copy: "Follow the timeline, artifacts, and schedules from one place." },
  ];

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader>
        <CardTitle className="text-xl">From first launch to first deployed task</CardTitle>
        <CardDescription>
          This app should guide someone non-technical through the core journey instead of dumping them into infrastructure details.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => (
          <div key={step.title} className="rounded-xl border border-border/70 bg-background/80 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <span className="inline-flex size-6 items-center justify-center rounded-full border border-border/80 bg-muted text-[11px] text-foreground">
                {index + 1}
              </span>
              Step {index + 1}
            </div>
            <div className="mt-3 text-sm font-medium text-foreground">{step.title}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.copy}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ConnectorEditor(props: {
  connector: ProviderConnector | null;
  hermesDefaults: HermesDefaults;
  busyKey: string | null;
  onSave(connectorId: string, input: ProviderConnectorUpdateRequest): Promise<void>;
  onTest(connectorId: string): Promise<void>;
  onSync(connectorId: string): Promise<void>;
  onRemove(connectorId: string): Promise<void>;
}) {
  const connector = props.connector;
  const isHermes = connector?.provider === "hermes";
  const [enabled, setEnabled] = useState(false);
  const [useHermesDefaults, setUseHermesDefaults] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!connector) {
      setEnabled(false);
      setUseHermesDefaults(false);
      setFieldValues({});
      return;
    }

    setEnabled(connector.enabled);
    setUseHermesDefaults(connector.useHermesDefaults ?? isHermes);
    const nextFields: Record<string, unknown> = {};
    const fields = connector.configFields ?? [];
    fields.forEach((field) => {
      nextFields[field.key] = field.type === "password" ? "" : (connector.adapterConfig?.[field.key] ?? "");
    });
    if (connector.provider === "hermes") {
      nextFields.runtimePort = connector.adapterConfig?.runtimePort ?? parseHermesRuntimePort(connector.runtimeBaseUrl, props.hermesDefaults.runtimeHost);
    }
    setFieldValues(nextFields);
  }, [connector, isHermes, props.hermesDefaults.runtimeHost]);

  if (!connector) {
    return (
      <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <CardHeader>
          <CardTitle>Add your first runtime</CardTitle>
          <CardDescription>Choose Hermes, Claude Code, or Codex on the left to start setup.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const currentConnector = connector;
  const busyPrefix = `connector:${currentConnector.id}:`;
  const isSaving = props.busyKey === `${busyPrefix}save`;
  const isTesting = props.busyKey === `${busyPrefix}test`;
  const isSyncing = props.busyKey === `${busyPrefix}sync`;
  const isRemoving = props.busyKey === `${busyPrefix}delete`;
  const isBusy = props.busyKey?.startsWith(busyPrefix) ?? false;
  const fields = currentConnector.configFields ?? [];

  function updateField(key: string, value: unknown): void {
    setFieldValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSave(): Promise<void> {
    const tokenValue = String(fieldValues.token ?? "").trim();
    const extras: Record<string, unknown> = {};
    const knownKeys = new Set(["baseUrl", "websocketUrl", "runtimeBaseUrl", "runtimePort", "token"]);

    Object.entries(fieldValues).forEach(([key, value]) => {
      if (!knownKeys.has(key)) {
        extras[key] = value;
      }
    });

    const runtimePortValue = String(fieldValues.runtimePort ?? "").trim();
    if (currentConnector.provider === "hermes" && useHermesDefaults && runtimePortValue) {
      extras.runtimePort = Number(runtimePortValue);
    }

    await props.onSave(currentConnector.id, {
      enabled,
      baseUrl: String(fieldValues.baseUrl ?? currentConnector.baseUrl ?? ""),
      websocketUrl: currentConnector.provider === "hermes" && useHermesDefaults ? "" : String(fieldValues.websocketUrl ?? currentConnector.websocketUrl ?? ""),
      runtimeBaseUrl: currentConnector.provider === "hermes" && useHermesDefaults ? "" : String(fieldValues.runtimeBaseUrl ?? currentConnector.runtimeBaseUrl ?? ""),
      ...(tokenValue ? { token: tokenValue } : {}),
      ...(Object.keys(extras).length > 0 ? { adapterConfig: extras } : {}),
      ...(currentConnector.provider === "hermes" ? { useHermesDefaults } : {}),
    });
  }

  function renderField(field: AdapterConfigField) {
    const value = fieldValues[field.key];
    if (field.type === "boolean") {
      return (
        <label key={field.key} className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-3">
          <Checkbox checked={Boolean(value)} onCheckedChange={(checked) => updateField(field.key, Boolean(checked))} />
          <div>
            <div className="text-sm font-medium text-foreground">{field.label}</div>
            {field.hint ? <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p> : null}
          </div>
        </label>
      );
    }

    return (
      <div key={field.key} className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{field.label}</label>
        <Input
          type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
          placeholder={field.type === "password" && currentConnector.tokenConfigured ? "Leave blank to keep current" : field.placeholder}
          value={String(value ?? "")}
          onChange={(event) => updateField(field.key, field.type === "number" ? Number(event.target.value) || 0 : event.target.value)}
        />
        {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
      </div>
    );
  }

  return (
    <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          {currentConnector.label}
          <Badge className={cn("border", healthClass(currentConnector.health.status))}>{currentConnector.health.status}</Badge>
        </CardTitle>
        <CardDescription>{currentConnector.health.message ?? "Configure the connector and confirm it is healthy before moving on."}</CardDescription>
        <CardAction>
          <Badge variant="outline">{currentConnector.provider}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Last sync</div>
            <div className="mt-2 text-sm text-foreground">{currentConnector.lastSyncAt ? formatRelativeUpdate(currentConnector.lastSyncAt) : "Not synced yet"}</div>
          </div>
          <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Capabilities</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {currentConnector.capabilities.agents ? <Badge variant="outline">Agents</Badge> : null}
              {currentConnector.capabilities.schedules ? <Badge variant="outline">Schedules</Badge> : null}
              {currentConnector.capabilities.launch ? <Badge variant="outline">Runs</Badge> : null}
              {currentConnector.capabilities.subscribe ? <Badge variant="outline">Live events</Badge> : null}
            </div>
          </div>
        </div>

        <div
          className={cn(
            "rounded-2xl border px-4 py-4",
            currentConnector.health.status === "error"
              ? "border-rose-500/25 bg-rose-500/10"
              : currentConnector.health.status === "ok"
                ? "border-emerald-500/20 bg-emerald-500/8"
                : "border-white/6 bg-white/[0.02]",
          )}
        >
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {currentConnector.health.status === "error" ? "Current issue" : "Status detail"}
          </div>
          <div className="mt-2 text-sm leading-6 text-foreground">
            {currentConnector.health.message ?? "No connector status available yet."}
          </div>
        </div>

        {isHermes ? (
          <div className="space-y-4 rounded-2xl border border-white/6 bg-white/[0.02] p-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">CLI command</label>
              <Input value={String(fieldValues.baseUrl ?? "")} onChange={(event) => updateField("baseUrl", event.target.value)} placeholder="hermes" />
            </div>

            <label className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-3">
              <Checkbox checked={useHermesDefaults} onCheckedChange={(checked) => setUseHermesDefaults(Boolean(checked))} />
              <div>
                <div className="text-sm font-medium text-foreground">Use shared Hermes defaults</div>
                <p className="mt-1 text-xs text-muted-foreground">Useful when Hermes, Scout, Atlas, and Orbit share the same host and token.</p>
              </div>
            </label>

            {useHermesDefaults ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">SSH host</div>
                  <div className="mt-2 text-sm text-foreground">{props.hermesDefaults.sshHost || "Not set"}</div>
                </div>
                <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Runtime host</div>
                  <div className="mt-2 text-sm text-foreground">{props.hermesDefaults.runtimeHost || "Not set"}</div>
                </div>
                <div className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Token</div>
                  <div className="mt-2 text-sm text-foreground">{props.hermesDefaults.tokenConfigured ? "Configured" : "Not set"}</div>
                </div>
                <div className="space-y-2 md:col-span-3">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Runtime port</label>
                  <Input
                    type="number"
                    value={String(fieldValues.runtimePort ?? "")}
                    onChange={(event) => updateField("runtimePort", event.target.value)}
                    placeholder="8642"
                  />
                  <p className="text-xs text-muted-foreground">
                    {props.hermesDefaults.runtimeHost && String(fieldValues.runtimePort ?? "").trim()
                      ? `Derived runtime URL: ${props.hermesDefaults.runtimeHost.replace(/\/+$/, "")}:${String(fieldValues.runtimePort ?? "").trim()}`
                      : "Set a shared runtime host and a port to derive the gateway URL."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">SSH host</label>
                  <Input value={String(fieldValues.websocketUrl ?? "")} onChange={(event) => updateField("websocketUrl", event.target.value)} placeholder="matt@192.168.1.113" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Runtime URL</label>
                  <Input value={String(fieldValues.runtimeBaseUrl ?? "")} onChange={(event) => updateField("runtimeBaseUrl", event.target.value)} placeholder="http://192.168.1.113:8642" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Token</label>
                  <Input type="password" value={String(fieldValues.token ?? "")} onChange={(event) => updateField("token", event.target.value)} placeholder={currentConnector.tokenConfigured ? "Leave blank to keep current" : "Bearer token"} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">{fields.map(renderField)}</div>
        )}

        <label className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-3">
          <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(Boolean(checked))} />
          <div>
            <div className="text-sm font-medium text-foreground">Connector enabled</div>
            <p className="mt-1 text-xs text-muted-foreground">Disable this if you do not want it receiving runs yet.</p>
          </div>
        </label>
      </CardContent>
      <CardFooter className="justify-between">
        <div className="text-xs text-muted-foreground">
          {currentConnector.tokenConfigured || (isHermes && useHermesDefaults && props.hermesDefaults.tokenConfigured)
            ? "Authentication configured"
            : "No token configured"}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={isBusy} onClick={() => { void props.onTest(currentConnector.id); }}>
            {isTesting ? "Testing..." : "Test"}
          </Button>
          <Button variant="outline" size="sm" disabled={isBusy} onClick={() => { void props.onSync(currentConnector.id); }}>
            {isSyncing ? "Syncing..." : "Sync"}
          </Button>
          <Button size="sm" disabled={isBusy} onClick={() => { void handleSave(); }}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
          <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => { void props.onRemove(currentConnector.id); }}>
            {isRemoving ? "Removing..." : "Remove"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function HermesDefaultsEditor(props: {
  defaults: HermesDefaults;
  busyKey: string | null;
  onSave(input: { sshHost: string; runtimeHost: string; token?: string }): Promise<void>;
}) {
  const [sshHost, setSshHost] = useState(props.defaults.sshHost ?? "");
  const [runtimeHost, setRuntimeHost] = useState(props.defaults.runtimeHost ?? "");
  const [token, setToken] = useState("");

  useEffect(() => {
    setSshHost(props.defaults.sshHost ?? "");
    setRuntimeHost(props.defaults.runtimeHost ?? "");
    setToken("");
  }, [props.defaults.runtimeHost, props.defaults.sshHost, props.defaults.tokenConfigured]);

  const isBusy = props.busyKey === "hermes-defaults:save";

  return (
    <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <CardHeader>
        <CardTitle>Hermes shared connection details</CardTitle>
        <CardDescription>Use this once if Hermes-style runtimes share the same host and token, so setup stays simple.</CardDescription>
        <CardAction>
          <Badge variant="outline">{props.defaults.tokenConfigured ? "Token set" : "No token"}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">SSH host</label>
          <Input value={sshHost} onChange={(event) => setSshHost(event.target.value)} placeholder="matt@192.168.1.113" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Runtime host</label>
          <Input value={runtimeHost} onChange={(event) => setRuntimeHost(event.target.value)} placeholder="http://192.168.1.113" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">API token</label>
          <Input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={props.defaults.tokenConfigured ? "Leave blank to keep current" : "Bearer token"} />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          size="sm"
          disabled={isBusy}
          onClick={() => {
            void props.onSave({
              sshHost,
              runtimeHost,
              ...(token.trim() ? { token: token.trim() } : {}),
            });
          }}
        >
          {isBusy ? "Saving..." : "Save Hermes defaults"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function TaskDetailCard(props: { detail: MissionTaskDetail | null; busyKey: string | null; onRun(taskId: string): Promise<void>; }) {
  if (!props.detail) {
    return (
      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Select a task</CardTitle>
          <CardDescription>Choose a synced Linear task to see the brief and submit the first run.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { task, comments, events, artifacts } = props.detail;
  const isRunning = props.busyKey === `task:${task.id}:run`;

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle className="text-xl">{task.title}</CardTitle>
          <CardDescription>{task.identifier}</CardDescription>
          <CardAction>
            <Button size="sm" disabled={isRunning} onClick={() => { void props.onRun(task.id); }}>
              <PlayIcon className="size-4" />
              {isRunning ? "Submitting..." : "Submit run"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge className={cn("border", stateClass(task))}>{task.state.name}</Badge>
            {task.execution ? (
              <Badge className={cn("border", taskExecutionClass(task.execution.status))}>
                {task.execution.activeOwnerLabel ?? task.execution.connectorId} · {task.execution.status}
              </Badge>
            ) : (
              <Badge variant="outline">Not running yet</Badge>
            )}
            <Badge variant="outline">{task.assignee?.name ?? "Unassigned"}</Badge>
            <Badge variant="outline">{taskCycleLabel(task)}</Badge>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Brief</div>
            <div className="mt-3 text-sm leading-7 text-foreground">
              <MarkdownContent text={task.description?.trim() || "No task description has been mirrored yet."} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>Mirrored provider events for this task.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">
              No run events yet.
            </div>
          ) : (
            events.slice(0, 8).map((event) => (
              <div key={event.id} className="rounded-xl border border-border/70 bg-background/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-foreground">{event.summary}</div>
                  {event.status ? <Badge className={cn("border", taskExecutionClass(event.status))}>{event.status}</Badge> : null}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {event.actorLabel ?? event.kind} · {formatDateTime(event.createdAt)}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Comments and artifacts</CardTitle>
          <CardDescription>What the team knows so far.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Comments</div>
            {comments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">No comments yet.</div>
            ) : (
              comments.slice(-3).reverse().map((comment) => (
                <div key={comment.id} className="rounded-xl border border-border/70 bg-background/70 p-4">
                  <div className="text-sm font-medium text-foreground">{comment.authorName}</div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">
                    <MarkdownContent text={comment.body} />
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Artifacts</div>
            {artifacts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">No artifacts mirrored yet.</div>
            ) : (
              artifacts.slice(0, 4).map((artifact) => (
                <div key={artifact.id} className="rounded-xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-foreground">{artifact.label}</div>
                    <Badge variant="outline">{artifact.kind}</Badge>
                  </div>
                  {artifact.body ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{artifact.body}</p> : null}
                  {artifact.url ? (
                    <a className="mt-2 inline-flex items-center gap-1 text-sm text-primary" href={artifact.url} target="_blank" rel="noreferrer">
                      Open
                      <ArrowRightIcon className="size-3.5" />
                    </a>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RecentRunDetail(props: { detail: MissionTaskDetail | null; activityLog: MissionControlState["activityLog"]; }) {
  const task = props.detail?.task;

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>{task?.execution ? `${task.identifier} · ${task.execution.activeOwnerLabel ?? task.execution.connectorId}` : "Choose a run"}</CardTitle>
          <CardDescription>{task?.execution?.message ?? "Select a recent run to inspect it."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status</div>
            <div className="mt-2 text-sm text-foreground">{task?.execution?.status ?? "n/a"}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Stage</div>
            <div className="mt-2 text-sm text-foreground">{task?.execution?.stage ?? "n/a"}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Updated</div>
            <div className="mt-2 text-sm text-foreground">{task?.execution ? formatRelativeUpdate(task.execution.updatedAt) : "n/a"}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Run timeline</CardTitle>
          <CardDescription>Events returned by the provider for the selected run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.detail?.events.length ? (
            props.detail.events.slice(0, 10).map((event) => (
              <div key={event.id} className="rounded-xl border border-border/70 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-foreground">{event.summary}</div>
                  {event.status ? <Badge className={cn("border", taskExecutionClass(event.status))}>{event.status}</Badge> : null}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{event.actorLabel ?? event.kind} · {formatDateTime(event.createdAt)}</div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">No provider events mirrored yet.</div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>Live activity</CardTitle>
          <CardDescription>Recent office and provider activity.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityFeed entries={props.activityLog} limit={10} />
        </CardContent>
      </Card>
    </div>
  );
}

export function SetupView(props: {
  mission: MissionControlState;
  onAddIntegration(provider: string): Promise<void>;
  onOpenOrg(): void;
}) {
  const connectors = props.mission.missionSnapshot.connectors;
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(connectors[0]?.id ?? null);
  const previousConnectorIdsRef = useRef<string[]>(connectors.map((connector) => connector.id));

  useEffect(() => {
    if (!selectedConnectorId || !connectors.some((connector) => connector.id === selectedConnectorId)) {
      setSelectedConnectorId(connectors[0]?.id ?? null);
    }
  }, [connectors, selectedConnectorId]);

  useEffect(() => {
    const previousIds = previousConnectorIdsRef.current;
    const nextIds = connectors.map((connector) => connector.id);
    const addedConnectorId = nextIds.find((connectorId) => !previousIds.includes(connectorId));
    if (addedConnectorId) {
      setSelectedConnectorId(addedConnectorId);
    }
    previousConnectorIdsRef.current = nextIds;
  }, [connectors]);

  const selectedConnector = connectors.find((connector) => connector.id === selectedConnectorId) ?? null;
  const readyConnectors = connectors.filter((connector) => connector.enabled && connector.health.status === "ok").length;
  const showHermesDefaults = selectedConnector?.provider === "hermes";
  const canOpenOrg = readyConnectors > 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <CardHeader>
            <CardTitle>1. Choose what to add</CardTitle>
            <CardDescription>Pick the runtime or app you want this office to use. We will add it, then you can configure it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { provider: "hermes", label: "Add Hermes", copy: "Remote gateway or local CLI", icon: CableIcon },
              { provider: "claude-local", label: "Add Claude Code", copy: "Local Claude worker", icon: SparklesIcon },
              { provider: "codex-local", label: "Add Codex", copy: "Local coding worker", icon: BotIcon },
            ].map((entry) => {
              const Icon = entry.icon;
              const existingCount = connectors.filter((connector) => connector.provider === entry.provider).length;
              return (
                <button
                  key={entry.provider}
                  className="flex w-full items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.02] p-4 text-left transition hover:bg-white/[0.05]"
                  onClick={() => { void props.onAddIntegration(entry.provider); }}
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-white">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-white">{entry.label}</div>
                      {existingCount > 0 ? <Badge variant="outline">{existingCount} added</Badge> : null}
                    </div>
                    <div className="mt-1 text-sm text-white/50">{entry.copy}</div>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {connectors.length > 0 ? (
          <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <CardHeader>
              <CardTitle>2. Select a runtime</CardTitle>
              <CardDescription>Choose one from the list to configure it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {connectors.map((connector) => (
                <button
                  key={connector.id}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition",
                    connector.id === selectedConnectorId
                      ? "border-white/20 bg-white/[0.05]"
                      : "border-white/6 bg-transparent hover:bg-white/[0.03]",
                  )}
                  onClick={() => setSelectedConnectorId(connector.id)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-white">{connector.label}</div>
                      <Badge className={cn("border", healthClass(connector.health.status))}>{connector.health.status}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-white/45">{connector.provider}</div>
                  </div>
                  <ChevronRightIcon className="size-4 text-white/35" />
                </button>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="space-y-6">
        <ConnectorEditor
          connector={selectedConnector}
          hermesDefaults={props.mission.missionSnapshot.hermesDefaults}
          busyKey={props.mission.busyKey}
          onSave={props.mission.saveConnector}
          onTest={props.mission.testConnectorHealth}
          onSync={props.mission.syncConnector}
          onRemove={props.mission.removeConnector}
        />

        {showHermesDefaults ? (
          <HermesDefaultsEditor
            defaults={props.mission.missionSnapshot.hermesDefaults}
            busyKey={props.mission.busyKey}
            onSave={props.mission.saveHermesSharedDefaults}
          />
        ) : null}
      </div>

      <div className="space-y-6">
        <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <CardHeader>
            <CardTitle>3. Ready for Org</CardTitle>
            <CardDescription>Once at least one runtime is healthy, you can open Org and save the reporting lines.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Added runtimes", value: connectors.length, ready: connectors.length > 0 },
              { label: "Healthy runtimes", value: readyConnectors, ready: readyConnectors > 0 },
              { label: "Detected runtime members", value: props.mission.missionSnapshot.providerAgents.length, ready: props.mission.missionSnapshot.providerAgents.length > 0 },
              { label: "Saved org members", value: props.mission.agents.length, ready: props.mission.agents.length > 0 },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.02] px-3 py-3">
                <div className="text-sm text-white/80">{item.label}</div>
                <div className="flex items-center gap-2">
                  <Badge className="border-white/10 bg-white/5 text-white/75">{item.value}</Badge>
                  {item.ready ? <CheckCircle2Icon className="size-4 text-emerald-400" /> : <Clock3Icon className="size-4 text-white/35" />}
                </div>
              </div>
            ))}
          </CardContent>
          <CardFooter className="justify-between">
            <div className="text-xs text-white/40">
              {canOpenOrg ? "You can move on to Org now." : "Get one runtime healthy before moving on."}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 bg-white/[0.03] text-white hover:bg-white/10 hover:text-white"
              onClick={() => props.onOpenOrg()}
            >
              Open Org
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

export function OrgView(props: { mission: MissionControlState }) {
  const connectors = useMemo(
    () => props.mission.missionSnapshot.connectors.filter((connector) => connector.enabled),
    [props.mission.missionSnapshot.connectors],
  );
  const [rows, setRows] = useState<TeamDraftRow[]>([]);
  const [commandAgentId, setCommandAgentId] = useState("");
  const [defaultRunConnectorId, setDefaultRunConnectorId] = useState("");

  useEffect(() => {
    const nextRows = buildTeamDraft(connectors, props.mission.missionSnapshot.providerAgents, props.mission.agents);
    setRows(nextRows);
    const nextCommand = props.mission.missionSnapshot.teamSettings.commandAgentId || guessCommandLead(nextRows);
    setCommandAgentId(nextCommand);
    setDefaultRunConnectorId(
      props.mission.missionSnapshot.teamSettings.defaultRunConnectorId
      || nextRows.find((row) => row.officeAgentId === nextCommand)?.connectorId
      || nextRows[0]?.connectorId
      || "",
    );
  }, [connectors, props.mission.agents, props.mission.missionSnapshot.providerAgents, props.mission.missionSnapshot.teamSettings.commandAgentId, props.mission.missionSnapshot.teamSettings.defaultRunConnectorId]);

  const selectedRows = rows.filter((row) => row.selected);
  const availableParents = selectedRows.map((row) => ({ id: row.officeAgentId, name: row.name }));
  const draftProviderAgents = useMemo(
    () =>
      selectedRows.map((row) => {
        const existing = props.mission.missionSnapshot.providerAgents.find(
          (agent) => agent.connectorId === row.connectorId && agent.externalId === row.externalId,
        );
        return existing
          ? {
              ...existing,
              officeAgentId: row.officeAgentId,
              managerExternalId: undefined,
              reportsToExternalId: undefined,
            }
          : {
              connectorId: row.connectorId,
              provider: row.provider,
              externalId: row.externalId,
              name: row.name,
              officeAgentId: row.officeAgentId,
              status: "unknown" as const,
              imported: false,
            };
      }),
    [props.mission.missionSnapshot.providerAgents, selectedRows],
  );
  const draftAgents = useMemo(
    () =>
      selectedRows.map((row) => {
        const existing = props.mission.agents.find((agent) => agent.id === row.officeAgentId);
        const providerAgent = draftProviderAgents.find((agent) => agent.officeAgentId === row.officeAgentId);
        return {
          id: row.officeAgentId,
          name: row.name,
          role: row.role,
          emoji: row.emoji,
          parentAgentId: row.parentOfficeAgentId || undefined,
          connected: true,
          status: existing?.status ?? (providerAgent?.status === "working" ? "working" : "idle"),
          location: existing?.location ?? "desk",
          timestamp: existing?.timestamp ?? Date.now(),
          task: existing?.task,
          message: existing?.message,
          backendLink: existing?.backendLink ?? {
            provider:
              row.provider === "hermes"
                ? "hermes"
                : row.provider === "claude-local"
                  ? "claude"
                  : "codex",
            connectorId: row.connectorId,
            agentId: row.externalId,
            connected: true,
          },
          type: existing?.type ?? "resident",
        };
      }),
    [draftProviderAgents, props.mission.agents, selectedRows],
  );

  function updateRow(key: string, patch: Partial<TeamDraftRow>): void {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <CardHeader>
            <CardTitle>Org chart</CardTitle>
            <CardDescription>The main view is who reports to who. Edit the org below and the chart updates before you save.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[620px] overflow-hidden rounded-xl border border-white/6 bg-[#07090d]">
              <OrgChart
                agents={draftAgents}
                providerAgents={draftProviderAgents}
                selectedAgentId={props.mission.selectedAgentId}
                onSelectAgent={props.mission.setSelectedAgentId}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <CardHeader>
            <CardTitle>Edit org members</CardTitle>
            <CardDescription>Use this editor to decide who appears in the org and where they report.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Include</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Org id</TableHead>
                  <TableHead>Reports to</TableHead>
                  <TableHead>Runtime</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <Checkbox checked={row.selected} onCheckedChange={(checked) => updateRow(row.key, { selected: Boolean(checked) })} />
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-[220px] items-center gap-3">
                        <Avatar size="sm">
                          <AvatarFallback>{avatarInitials(row.name, row.emoji)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{row.name}</div>
                          <div className="text-xs text-muted-foreground">{row.sourceLabel}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input value={row.role} onChange={(event) => updateRow(row.key, { role: event.target.value })} className="h-9 min-w-[180px]" />
                    </TableCell>
                    <TableCell>
                      <Input value={row.officeAgentId} onChange={(event) => updateRow(row.key, { officeAgentId: normalizeOfficeId(event.target.value) })} className="h-9 min-w-[140px]" />
                    </TableCell>
                    <TableCell>
                      <Select value={row.parentOfficeAgentId} onValueChange={(value) => updateRow(row.key, { parentOfficeAgentId: value ?? "" })}>
                        <SelectTrigger className="h-9 min-w-[160px] rounded-xl">
                          <SelectValue placeholder="Top level" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Top level</SelectItem>
                          {availableParents
                            .filter((entry) => entry.id !== row.officeAgentId)
                            .map((entry) => (
                              <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-[130px] flex-col gap-1">
                        <Badge variant="outline">{connectors.find((connector) => connector.id === row.connectorId)?.label ?? row.connectorId}</Badge>
                        <span className="text-xs text-muted-foreground">{row.statusLabel}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <CardHeader>
            <CardTitle>Save the org</CardTitle>
            <CardDescription>Choose the command lead, the default runtime for runs, then save the structure shown in the chart.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Command lead</label>
              <Select value={commandAgentId} onValueChange={(value) => setCommandAgentId(value ?? "")}>
                <SelectTrigger className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Select a lead" />
                </SelectTrigger>
                <SelectContent>
                  {selectedRows.map((row) => (
                    <SelectItem key={row.key} value={row.officeAgentId}>{row.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Default run connector</label>
              <Select value={defaultRunConnectorId} onValueChange={(value) => setDefaultRunConnectorId(value ?? "")}>
                <SelectTrigger className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Automatic" />
                </SelectTrigger>
                <SelectContent>
                  {connectors.map((connector) => (
                    <SelectItem key={connector.id} value={connector.id}>{connector.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <div className="text-xs text-muted-foreground">{selectedRows.length} org member{selectedRows.length === 1 ? "" : "s"} selected.</div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setRows((current) => applyRecommendedStructure(current))}>
                Auto-structure
              </Button>
              <Button
                size="sm"
                disabled={props.mission.busyKey === "team:bootstrap"}
                onClick={() => {
                  void props.mission.bootstrapTeam(buildTeamRequest(rows, commandAgentId, defaultRunConnectorId));
                }}
              >
                {props.mission.busyKey === "team:bootstrap" ? "Saving..." : "Save org"}
              </Button>
            </div>
          </CardFooter>
        </Card>

        <Card className="border-white/6 bg-[#0b0d11] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <CardHeader>
            <CardTitle>Recommended structure</CardTitle>
            <CardDescription>Default it this way for your current four-gateway setup.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p><strong className="text-foreground">Hermes</strong> is the command lead and default entrypoint.</p>
            <p><strong className="text-foreground">Scout</strong> reports to Hermes and acts as lead engineer.</p>
            <p><strong className="text-foreground">Atlas</strong> and <strong className="text-foreground">Orbit</strong> report to Scout and stay focused on their own work areas.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function WorkView(props: { mission: MissionControlState }) {
  const [search, setSearch] = useState("");
  const [lane, setLane] = useState("todo");
  const visibleTasks = props.mission.missionSnapshot.tasks
    .filter((task) => {
      const needle = search.trim().toLowerCase();
      if (!needle) return true;
      return `${task.identifier} ${task.title} ${task.team.name} ${task.state.name}`.toLowerCase().includes(needle);
    })
    .sort(compareMissionTasksForBoard);
  const groups = groupTasks(visibleTasks);
  const laneTasks = groups[lane as keyof typeof groups] ?? groups.todo;

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>3. Choose the first task</CardTitle>
          <CardDescription>The clearest path is: pick one task, review the brief, and submit one run.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{visibleTasks.length} synced tasks</Badge>
            <Badge variant="outline">{props.mission.missionSnapshot.taskSync.state}</Badge>
            <Badge variant="outline">{props.mission.missionSnapshot.tasks.filter((task) => task.execution).length} tasks with runs</Badge>
          </div>
          <div className="w-full max-w-sm">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search issues, teams, or keys" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Task board</CardTitle>
            <CardDescription>Filter by the lane that matters, instead of dumping every state on screen at once.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={lane} onValueChange={setLane}>
              <TabsList variant="line" className="mb-4">
                <TabsTrigger value="todo">Todo</TabsTrigger>
                <TabsTrigger value="in_progress">In progress</TabsTrigger>
                <TabsTrigger value="review">Review</TabsTrigger>
                <TabsTrigger value="done">Done</TabsTrigger>
              </TabsList>
              {["todo", "in_progress", "review", "done"].map((value) => (
                <TabsContent key={value} value={value}>
                  <ScrollArea className="h-[680px] pr-4">
                    <div className="space-y-3">
                      {(value === lane ? laneTasks : groups[value as keyof typeof groups] ?? []).length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-sm text-muted-foreground">
                          No tasks in this lane.
                        </div>
                      ) : (
                        (value === lane ? laneTasks : groups[value as keyof typeof groups] ?? []).map((task) => (
                          <button
                            key={task.id}
                            className={cn(
                              "w-full rounded-2xl border p-4 text-left transition",
                              props.mission.selectedTaskId === task.id
                                ? "border-primary/40 bg-primary/5"
                                : "border-border/70 bg-background/70 hover:border-primary/25",
                            )}
                            onClick={() => props.mission.setSelectedTaskId(task.id)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{task.identifier}</span>
                                  <Badge className={cn("border", stateClass(task))}>{task.state.name}</Badge>
                                </div>
                                <div className="mt-3 text-sm font-medium leading-6 text-foreground">{task.title}</div>
                              </div>
                              <span className="text-xs text-muted-foreground">{formatRelativeStamp(task.updatedAt)}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Badge variant="outline">{task.assignee?.name ?? "Unassigned"}</Badge>
                              <Badge variant="outline">{taskCycleLabel(task)}</Badge>
                              {task.execution ? <Badge className={cn("border", taskExecutionClass(task.execution.status))}>{task.execution.status}</Badge> : null}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        <TaskDetailCard detail={props.mission.selectedTaskDetail} busyKey={props.mission.busyKey} onRun={props.mission.runTask} />
      </div>
    </div>
  );
}

export function RunsView(props: { mission: MissionControlState }) {
  const recentTasks = [...props.mission.missionSnapshot.tasks]
    .filter((task) => task.execution)
    .sort((left, right) => (right.execution?.updatedAt ?? 0) - (left.execution?.updatedAt ?? 0));

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/70">
        <CardHeader>
          <CardTitle>4. Watch the run</CardTitle>
          <CardDescription>Runs and schedules are the first version of a heartbeat model: discrete wakeups, observable status, and clear history.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recent runs</div>
            <div className="mt-2 text-xl font-semibold text-foreground">{recentTasks.length}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Queued</div>
            <div className="mt-2 text-xl font-semibold text-foreground">{recentTasks.filter((task) => task.execution?.status === "queued").length}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Running</div>
            <div className="mt-2 text-xl font-semibold text-foreground">{recentTasks.filter((task) => task.execution?.status === "running").length}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Wakeups</div>
            <div className="mt-2 text-xl font-semibold text-foreground">{props.mission.missionSnapshot.schedules.length}</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
              <CardDescription>Select a run to inspect it.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[520px] pr-4">
                <div className="space-y-3">
                  {recentTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-sm text-muted-foreground">
                      No runs yet. Go to Work and submit the first task.
                    </div>
                  ) : (
                    recentTasks.map((task) => (
                      <button
                        key={task.id}
                        className={cn(
                          "w-full rounded-2xl border p-4 text-left transition",
                          props.mission.selectedTaskId === task.id
                            ? "border-primary/40 bg-primary/5"
                            : "border-border/70 bg-background/70 hover:border-primary/25",
                        )}
                        onClick={() => props.mission.setSelectedTaskId(task.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">{task.identifier}</div>
                            <div className="mt-1 text-sm text-muted-foreground">{task.title}</div>
                          </div>
                          <Badge className={cn("border", taskExecutionClass(task.execution?.status))}>{task.execution?.status}</Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="outline">{task.execution?.activeOwnerLabel ?? task.execution?.connectorId}</Badge>
                          <Badge variant="outline">{formatRelativeUpdate(task.execution?.updatedAt)}</Badge>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>Schedules and wakeups</CardTitle>
              <CardDescription>Keep cron-like behavior here instead of forcing it into the core onboarding flow.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {props.mission.missionSnapshot.schedules.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">
                  No schedules imported yet.
                </div>
              ) : (
                props.mission.missionSnapshot.schedules.map((schedule) => (
                  <div key={schedule.id} className="rounded-xl border border-border/70 bg-background/70 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-foreground">{schedule.name}</div>
                      <Badge className={cn("border", taskExecutionClass(schedule.status))}>{schedule.status}</Badge>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">{schedule.recurrence}</div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>Next {schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : "n/a"}</span>
                      <Separator orientation="vertical" className="h-4" />
                      <span>{schedule.targetLabel || schedule.targetAgentId || "No target"}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <RecentRunDetail detail={props.mission.selectedTaskDetail} activityLog={props.mission.activityLog} />
      </div>
    </div>
  );
}

export function SettingsView(props: { mission: MissionControlState }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Workspace overview</CardTitle>
            <CardDescription>Overall office status and background services.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {[
              { label: "Connection", value: props.mission.connectionState },
              { label: "Task sync", value: props.mission.missionSnapshot.taskSync.state },
              { label: "Runtimes", value: String(props.mission.missionSnapshot.connectors.length) },
              { label: "Saved org members", value: String(props.mission.agents.length) },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border/70 bg-background/70 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                <div className="mt-2 text-lg font-semibold text-foreground">{item.value}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Schedules</CardTitle>
            <CardDescription>Background wakeups and imported automation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {props.mission.missionSnapshot.schedules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground">No schedules imported yet.</div>
            ) : (
              props.mission.missionSnapshot.schedules.map((schedule) => (
                <div key={schedule.id} className="rounded-xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{schedule.name}</div>
                    <Badge className={cn("border", taskExecutionClass(schedule.status))}>{schedule.status}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{schedule.recurrence}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>What belongs here</CardTitle>
            <CardDescription>Settings should describe the office as a whole, not walk people through first-run setup.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>Setup is where runtimes are added and configured.</p>
            <p>Org is where reporting lines are saved and visualized.</p>
            <p>Work is where tasks are selected and submitted.</p>
            <p>Runs is where execution and wakeups are monitored.</p>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Runtime overview</CardTitle>
            <CardDescription>Read-only health for everything already configured.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {props.mission.missionSnapshot.connectors.map((connector) => (
              <div key={connector.id} className="rounded-xl border border-border/70 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-foreground">{connector.label}</div>
                  <Badge className={cn("border", healthClass(connector.health.status))}>{connector.health.status}</Badge>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{connector.health.message ?? "No connector message yet."}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function taskCycleLabel(task: MissionTask): string {
  if (!task.cycle) return "No cycle";
  if (task.cycle.name && task.cycle.name !== "Cycle") return task.cycle.name;
  if (typeof task.cycle.number === "number") return `Cycle ${task.cycle.number}`;
  return "Cycle";
}
