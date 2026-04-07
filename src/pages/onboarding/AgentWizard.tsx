import { useEffect, useMemo, useState } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, RocketIcon, XIcon } from "lucide-react";
import type { EngineConnectionResult } from "@/mission/appTypes";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { describeEngineVersion, engineConnectionGuide, serializeEngineConfig } from "@/lib/engineConfig";
import { AGENT_PERSONA_PRESETS, DEFAULT_AGENT_SKILLS, dedupeSkills, normalizeSkillName } from "@/lib/agentPersonaPresets";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "@/components/EmojiPicker";

const STEPS = ["Identification", "Core Engine", "Capabilities", "Persona"];
const AGENT_COLORS = ["#5e4ae3", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#8b5cf6", "#06b6d4"];
const CLAUDE_MODEL_OPTIONS = [
  { value: "", label: "Default (Sonnet)" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

interface AgentWizardProps {
  mission: MissionControlState;
  onComplete: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  submitLabel?: string;
  initialAgent?: {
    id: string;
    name: string;
    role: string | null;
    emoji: string;
    color: string;
    engine: string;
    skills: string[];
    tools: string[];
    connection_config: Record<string, unknown>;
    soul_md: string | null;
    agents_md: string | null;
    external_config: boolean;
  };
}

export function AgentWizard({ mission, onComplete, onCancel, cancelLabel = "Cancel", submitLabel = "Initialize Agent", initialAgent }: AgentWizardProps) {
  const isEditing = !!initialAgent;
  const initialCustomSkills = useMemo(
    () => dedupeSkills((initialAgent?.skills ?? []).filter((skill) => !DEFAULT_AGENT_SKILLS.some((entry) => entry.toLowerCase() === skill.toLowerCase()))),
    [initialAgent?.skills],
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [name, setName] = useState(initialAgent?.name ?? "");
  const [role, setRole] = useState(initialAgent?.role ?? "");
  const [emoji, setEmoji] = useState(initialAgent?.emoji ?? "");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<string | null>(initialAgent?.engine ?? mission.engines[0]?.id ?? null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(dedupeSkills(initialAgent?.skills ?? []));
  const [customSkills, setCustomSkills] = useState<string[]>(initialCustomSkills);
  const [customSkillInput, setCustomSkillInput] = useState("");
  const [selectedColor, setSelectedColor] = useState(initialAgent?.color ?? AGENT_COLORS[0]);
  const [webSearch, setWebSearch] = useState(initialAgent ? initialAgent.tools.includes("web-search") : true);
  const [codeExec, setCodeExec] = useState(initialAgent ? initialAgent.tools.includes("code-exec") : true);
  const [fileSystem, setFileSystem] = useState(initialAgent ? initialAgent.tools.includes("file-system") : false);
  const [managedExternally, setManagedExternally] = useState(initialAgent?.external_config ?? false);
  const [connectionConfigByEngine, setConnectionConfigByEngine] = useState<Record<string, string>>(
    initialAgent ? { [initialAgent.engine]: JSON.stringify(initialAgent.connection_config, null, 2) } : {},
  );
  const [soulMd, setSoulMd] = useState(initialAgent?.soul_md ?? "# Purpose\nBe an effective operator.");
  const [agentsMd, setAgentsMd] = useState(initialAgent?.agents_md ?? "# Rules\nCollaborate clearly with other agents.");
  const [testResultsByEngine, setTestResultsByEngine] = useState<Record<string, EngineConnectionResult>>({});

  const selectedEngineDefinition = useMemo(
    () => mission.engines.find((engine) => engine.id === selectedEngine) ?? mission.engines[0] ?? null,
    [mission.engines, selectedEngine],
  );

  const engineCards = useMemo(
    () =>
      mission.engines.map((engine) => ({
        ...engine,
        color:
          engine.id === "claude-code"
            ? "from-amber-500/20 to-amber-600/10 border-amber-500/30"
            : engine.id === "hermes"
              ? "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30"
              : engine.id === "codex"
                ? "from-cyan-500/20 to-cyan-600/10 border-cyan-500/30"
                : "from-[#5e4ae3]/20 to-[#5e4ae3]/10 border-[#5e4ae3]/30",
      })),
    [mission.engines],
  );

  useEffect(() => {
    if (!selectedEngine && mission.engines[0]?.id) {
      setSelectedEngine(mission.engines[0].id);
    }
  }, [mission.engines, selectedEngine]);

  useEffect(() => {
    if (!mission.engines.length) {
      return;
    }

    setConnectionConfigByEngine((current) => {
      const next = { ...current };
      mission.engines.forEach((engine) => {
        if (!next[engine.id]) {
          next[engine.id] = serializeEngineConfig(engine, mission.settingsMap[`engine.${engine.id}`]);
        }
      });
      return next;
    });
  }, [mission.engines, mission.settingsMap]);

  const selectedConnectionConfigText = selectedEngineDefinition
    ? (connectionConfigByEngine[selectedEngineDefinition.id] ?? serializeEngineConfig(selectedEngineDefinition, mission.settingsMap[`engine.${selectedEngineDefinition.id}`]))
    : "{}";
  const selectedGuide = selectedEngineDefinition ? engineConnectionGuide(selectedEngineDefinition) : null;
  const selectedTestResult = selectedEngineDefinition ? (testResultsByEngine[selectedEngineDefinition.id] ?? null) : null;
  const allSkills = useMemo(
    () => dedupeSkills([...DEFAULT_AGENT_SKILLS, ...customSkills]),
    [customSkills],
  );

  function toggleSkill(skill: string) {
    setSelectedSkills((current) => {
      const next = current.includes(skill)
        ? current.filter((entry) => entry !== skill)
        : [...current, skill];
      return dedupeSkills(next);
    });
  }

  function addCustomSkill() {
    const normalized = normalizeSkillName(customSkillInput);
    if (!normalized) {
      return;
    }
    setCustomSkills((current) => dedupeSkills([...current, normalized]));
    setSelectedSkills((current) => dedupeSkills([...current, normalized]));
    setCustomSkillInput("");
  }

  function removeCustomSkill(skill: string) {
    setCustomSkills((current) => current.filter((entry) => entry !== skill));
    setSelectedSkills((current) => current.filter((entry) => entry !== skill));
  }

  function applyPreset(presetId: string) {
    const preset = AGENT_PERSONA_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    setName((current) => current || preset.suggestedName);
    setRole(preset.suggestedRole);
    setCustomSkills((current) => dedupeSkills([
      ...current,
      ...preset.skills.filter((skill) => !DEFAULT_AGENT_SKILLS.some((entry) => entry.toLowerCase() === skill.toLowerCase())),
    ]));
    setSelectedSkills((current) => dedupeSkills([...current, ...preset.skills]));
    setWebSearch(preset.tools.webSearch);
    setCodeExec(preset.tools.codeExec);
    setFileSystem(preset.tools.fileSystem);
    setManagedExternally(false);
    setSoulMd(preset.soulMd);
    setAgentsMd(preset.agentsMd);
  }

  async function handleSubmit() {
    try {
      const connectionConfig = JSON.parse(selectedConnectionConfigText) as Record<string, unknown>;
      const payload = {
        name,
        role,
        emoji: emoji || name[0]?.toUpperCase() || "🤖",
        color: selectedColor,
        engine: selectedEngineDefinition?.id ?? mission.engines[0]?.id ?? "codex",
        connection_type: selectedEngineDefinition?.connectionType ?? "cli",
        connection_config: connectionConfig,
        skills: dedupeSkills(selectedSkills),
        tools: [webSearch ? "web-search" : null, codeExec ? "code-exec" : null, fileSystem ? "file-system" : null].filter(Boolean),
        soul_md: soulMd,
        agents_md: agentsMd,
        external_config: managedExternally,
        active: true,
      };

      const ok = isEditing
        ? await mission.editAgent(initialAgent.id, payload)
        : await mission.createAgent(payload);

      if (ok) {
        onComplete();
      }
    } catch {
      if (!selectedEngineDefinition) {
        return;
      }
      setTestResultsByEngine((current) => ({
        ...current,
        [selectedEngineDefinition.id]: {
          ok: false,
          message: "Connection config must be valid JSON.",
          latency_ms: 0,
        },
      }));
    }
  }

  return (
    <>
      {/* Step indicator */}
      <div className="border-b border-white/[0.06] px-6 pt-6 pb-5">
        <div className="mb-4 flex items-center justify-center gap-1.5">
          {STEPS.map((step, index) => (
            <div key={step} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[10px] font-semibold transition-colors",
                  index < currentStep
                    ? "bg-emerald-500/20 text-emerald-400"
                    : index === currentStep
                      ? "bg-[#39147e] text-white"
                      : "bg-white/[0.06] text-[#585658]",
                )}
              >
                {index < currentStep ? <CheckIcon className="size-3" /> : index + 1}
              </div>
              <span
                className={cn(
                  "text-[11px] font-medium transition-colors",
                  index === currentStep ? "text-white" : index < currentStep ? "text-[#918f90]" : "text-[#585658]",
                )}
              >
                {step}
              </span>
              {index < STEPS.length - 1 ? <div className="mx-1 h-px w-6 bg-white/[0.06]" /> : null}
            </div>
          ))}
        </div>
        <div className="h-0.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] transition-all duration-500"
            style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {currentStep === 0 ? (
          <div className="space-y-5">
            <SectionTitle title="Agent Identification" subtitle="Set up the basic identity for your new agent" />
            <div className="flex items-start gap-5">
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(true)}
                  className="flex size-16 items-center justify-center rounded-2xl text-xl font-bold text-white shadow-lg transition-all hover:scale-105 hover:brightness-110"
                  style={{ background: `linear-gradient(135deg, ${selectedColor}90, ${selectedColor})`, boxShadow: `0 8px 24px ${selectedColor}30` }}
                >
                  {emoji || (name ? name[0]?.toUpperCase() : "?")}
                </button>
                <span className="text-[10px] text-[#585658]">Click to pick</span>
                {showEmojiPicker ? (
                  <EmojiPicker
                    value={emoji}
                    onSelect={(e) => setEmoji(e)}
                    onClear={() => setEmoji("")}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                ) : null}
              </div>
              <div className="flex-1 space-y-3">
                <FormField label="Agent Name" placeholder="e.g. Pickle, Scout-01" value={name} onChange={setName} />
                <FormField label="Role / Title" placeholder="e.g. Orchestrator, QA Engineer" value={role} onChange={setRole} />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Agent Color</label>
              <div className="flex gap-2">
                {AGENT_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    className={cn(
                      "size-7 rounded-full transition-all hover:scale-110",
                      selectedColor === color ? "ring-2 ring-white/80 ring-offset-2 ring-offset-[#141415]" : "opacity-60 hover:opacity-100",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {currentStep === 1 ? (
          <div className="space-y-5">
            <SectionTitle title="Core Engine" subtitle="Select the primary execution engine for this agent" />
            <div className="grid grid-cols-2 gap-2.5">
              {engineCards.map((engine) => (
                <button
                  key={engine.id}
                  onClick={() => setSelectedEngine(engine.id)}
                  className={cn(
                    "rounded-xl border bg-gradient-to-br p-3.5 text-left transition-all",
                    engine.color,
                    selectedEngine === engine.id ? "ring-2 ring-[#5e4ae3] ring-offset-2 ring-offset-[#141415]" : "opacity-60 hover:opacity-100",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px] font-semibold text-white">{engine.label}</div>
                    {testResultsByEngine[engine.id]?.currentVersion ? (
                      <span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 text-[10px] font-medium text-[#c8c4d7]">
                        v{testResultsByEngine[engine.id]?.currentVersion}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-[#918f90]">{engine.description}</div>
                  {testResultsByEngine[engine.id] ? (
                    <div className={cn("mt-2 text-[10px]", testResultsByEngine[engine.id]?.ok ? "text-emerald-300" : "text-amber-200")}>
                      {describeEngineVersion(testResultsByEngine[engine.id]) ?? testResultsByEngine[engine.id]?.message}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>

            {selectedEngine === "claude-code" ? (
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Model</label>
                <select
                  value={(() => {
                    try {
                      const cfg = JSON.parse(selectedConnectionConfigText) as Record<string, unknown>;
                      return typeof cfg.model === "string" ? cfg.model : "";
                    } catch { return ""; }
                  })()}
                  onChange={(event) => {
                    if (!selectedEngineDefinition) return;
                    try {
                      const cfg = JSON.parse(selectedConnectionConfigText) as Record<string, unknown>;
                      if (event.target.value) {
                        cfg.model = event.target.value;
                      } else {
                        delete cfg.model;
                      }
                      setConnectionConfigByEngine((current) => ({
                        ...current,
                        [selectedEngineDefinition.id]: JSON.stringify(cfg, null, 2),
                      }));
                    } catch { /* invalid JSON, ignore */ }
                  }}
                  className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none transition-colors focus:border-[#5e4ae3]/50"
                >
                  {CLAUDE_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="mt-1 text-[10px] text-[#585658]">
                  Leave as default for cost-efficient Sonnet. Use Opus for complex multi-file tasks.
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Connection Config (JSON)</label>
              {selectedGuide ? (
                <div className="mb-2 rounded-xl border border-white/[0.06] bg-[#0f0f10] px-3.5 py-2.5">
                  <div className="text-[11px] font-medium text-white">{selectedGuide.title}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-[#918f90]">{selectedGuide.body}</div>
                </div>
              ) : null}
              <textarea
                value={selectedConnectionConfigText}
                onChange={(event) => {
                  if (!selectedEngineDefinition) {
                    return;
                  }
                  setConnectionConfigByEngine((current) => ({
                    ...current,
                    [selectedEngineDefinition.id]: event.target.value,
                  }));
                }}
                className="h-24 w-full rounded-xl border border-white/[0.08] bg-[#0f0f10] px-3.5 py-2.5 font-mono text-[12px] text-white outline-none transition-colors focus:border-[#5e4ae3]/50"
              />
              <div className="mt-1 text-[10px] text-[#585658]">
                Seeded from saved engine settings or provider defaults. HTTP engines can point to another LAN host by replacing `localhost` with its IP.
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (!selectedEngineDefinition) return;
                    try {
                      const parsed = JSON.parse(selectedConnectionConfigText) as Record<string, unknown>;
                      const result = await mission.testEngineConnection(selectedEngineDefinition.id, parsed);
                      if (result) {
                        setTestResultsByEngine((current) => ({
                          ...current,
                          [selectedEngineDefinition.id]: result,
                        }));
                      }
                    } catch {
                      setTestResultsByEngine((current) => ({
                        ...current,
                        [selectedEngineDefinition.id]: {
                          ok: false,
                          message: "Connection config must be valid JSON.",
                          latency_ms: 0,
                        },
                      }));
                    }
                  }}
                  className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white"
                >
                  Test Connection
                </button>
                {selectedTestResult ? (
                  <span className={cn("text-[11px]", selectedTestResult.ok ? "text-emerald-300" : "text-amber-200")}>
                    {selectedTestResult.ok ? "✓" : "✗"} {selectedTestResult.message}
                  </span>
                ) : null}
              </div>
              {selectedTestResult?.currentVersion ? (
                <div className="mt-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] text-[#c8c4d7]">
                  <div>{describeEngineVersion(selectedTestResult)}</div>
                  {selectedTestResult.updateAvailable && selectedTestResult.upgradeCommand ? (
                    <div className="mt-1 text-[#918f90]">Upgrade: <code>{selectedTestResult.upgradeCommand}</code></div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {currentStep === 2 ? (
          <div className="space-y-5">
            <SectionTitle title="Capabilities & Tooling" subtitle="Configure what this agent can do" />
            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Skills</label>
              <div className="flex flex-wrap gap-1.5">
                {allSkills.map((skill) => (
                  <button
                    key={skill}
                    onClick={() => toggleSkill(skill)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
                      selectedSkills.includes(skill)
                        ? "border-[#5e4ae3]/50 bg-[#39147e]/20 text-[#c6bfff]"
                        : "border-white/[0.08] bg-white/[0.02] text-[#918f90] hover:border-white/[0.15] hover:text-white",
                    )}
                  >
                    {selectedSkills.includes(skill) ? <CheckIcon className="mr-1 inline size-2.5" /> : null}
                    {skill}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={customSkillInput}
                  onChange={(event) => setCustomSkillInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCustomSkill();
                    }
                  }}
                  placeholder="Add custom skill, e.g. React Native"
                  className="flex-1 rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[12px] text-white outline-none placeholder:text-[#585658] focus:border-[#5e4ae3]/50"
                />
                <button
                  onClick={addCustomSkill}
                  type="button"
                  className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                >
                  Add Skill
                </button>
              </div>
              {customSkills.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {customSkills.map((skill) => (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => removeCustomSkill(skill)}
                      className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[11px] text-[#918f90] transition-colors hover:border-red-400/30 hover:text-red-300"
                    >
                      {skill}
                      <XIcon className="size-3" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Tool Access</label>
              <div className="space-y-1.5">
                <ToggleRow label="Web Search" description="Allow agent to search the web" checked={webSearch} onChange={setWebSearch} />
                <ToggleRow label="Code Execution" description="Allow agent to run code" checked={codeExec} onChange={setCodeExec} />
                <ToggleRow label="File System" description="Allow file read/write access" checked={fileSystem} onChange={setFileSystem} />
              </div>
            </div>
          </div>
        ) : null}

        {currentStep === 3 ? (
          <div className="space-y-5">
            <SectionTitle title="Agent Persona" subtitle="Define the agent's personality and behavior guidelines" />
            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[#585658]">Quick Presets</label>
              <div className="grid grid-cols-3 gap-2">
                {AGENT_PERSONA_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-[#5e4ae3]/40 hover:bg-[#39147e]/10"
                  >
                    <div className="text-[12px] font-semibold text-white">{preset.label}</div>
                    <div className="mt-0.5 text-[11px] text-[#918f90]">{preset.suggestedRole}</div>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#585658]">
                Presets update role, tools, skills, and inline prompt scaffolding for the selected agent.
              </p>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-[#0f0f10] px-3.5 py-2.5 text-[12px] text-[#918f90]">
              <input type="checkbox" checked={managedExternally} onChange={(event) => setManagedExternally(event.target.checked)} className="accent-[#5e4ae3]" />
              Managed externally
            </label>
            {!managedExternally ? (
              <>
                <div className="rounded-xl border border-white/[0.06] bg-[#0f0f10] px-3.5 py-2.5 text-[11px] leading-relaxed text-[#918f90]">
                  Selected skills, <code className="text-[#c8c4d7]">SOUL.md</code>, and <code className="text-[#c8c4d7]">AGENTS.md</code> are prepended to each run prompt when this agent is managed here.
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[#585658]">SOUL.md</label>
                  <textarea
                    value={soulMd}
                    onChange={(event) => setSoulMd(event.target.value)}
                    className="h-28 w-full rounded-xl border border-white/[0.08] bg-[#0f0f10] px-3.5 py-2.5 font-mono text-[12px] text-white outline-none transition-colors placeholder:text-[#585658] focus:border-[#5e4ae3]/50"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[#585658]">AGENTS.md</label>
                  <textarea
                    value={agentsMd}
                    onChange={(event) => setAgentsMd(event.target.value)}
                    className="h-28 w-full rounded-xl border border-white/[0.08] bg-[#0f0f10] px-3.5 py-2.5 font-mono text-[12px] text-white outline-none transition-colors placeholder:text-[#585658] focus:border-[#5e4ae3]/50"
                  />
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3.5">
        <button
          onClick={onCancel}
          className="text-[12px] font-medium text-[#585658] transition-colors hover:text-[#918f90]"
        >
          {cancelLabel}
        </button>
        <div className="flex items-center gap-2">
          {currentStep > 0 ? (
            <button
              onClick={() => setCurrentStep((step) => step - 1)}
              className="flex items-center gap-1 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <ChevronLeftIcon className="size-3.5" />
              Back
            </button>
          ) : null}
          {currentStep < STEPS.length - 1 ? (
            <button
              onClick={() => setCurrentStep((step) => step + 1)}
              className="flex items-center gap-1 rounded-lg bg-[#39147e] px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-[#2e1065]/25 transition-all hover:bg-[#7c3aed]"
            >
              Next
              <ChevronRightIcon className="size-3.5" />
            </button>
          ) : (
            <button
              onClick={() => void handleSubmit()}
              className="flex items-center gap-1.5 rounded-lg bg-[#39147e] px-4 py-1.5 text-[12px] font-semibold text-white shadow-lg shadow-[#2e1065]/25 transition-all hover:bg-[#7c3aed]"
            >
              <RocketIcon className="size-3.5" />
              {submitLabel}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      <p className="mt-0.5 text-[12px] text-[#585658]">{subtitle}</p>
    </div>
  );
}

function FormField({ label, placeholder, value, onChange, type = "text" }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#585658]">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder:text-[#585658] focus:border-[#5e4ae3]/50"
      />
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#0f0f10] px-3.5 py-2.5">
      <div>
        <div className="text-[12px] font-medium text-white">{label}</div>
        <div className="text-[10px] text-[#585658]">{description}</div>
      </div>
      <button onClick={() => onChange(!checked)} className={cn("h-5 w-9 rounded-full transition-colors", checked ? "bg-[#39147e]" : "bg-white/[0.1]")}>
        <div className={cn("size-4 rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
    </div>
  );
}
