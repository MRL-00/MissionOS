import { useState } from "react";
import { CheckIcon, ShieldIcon, ZapIcon, NetworkIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";

interface AgentOnboardingProps {
  mission: MissionControlState;
}

const STEPS = ["Identification", "Core Engine", "Capabilities", "Persona"];

const ENGINES = [
  { id: "claude", name: "Claude Code v3.5", description: "Advanced reasoning and code generation", color: "from-amber-500/20 to-amber-600/10 border-amber-500/30" },
  { id: "hermes", name: "Hermes-2-Pro", description: "Fast local execution engine", color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30" },
  { id: "openclaw", name: "OpenClaw Ultra", description: "Multi-agent orchestration platform", color: "from-[#5e4ae3]/20 to-[#5e4ae3]/10 border-[#5e4ae3]/30" },
  { id: "codex", name: "Codex Prime", description: "Specialized code analysis engine", color: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/30" },
];

const SKILLS = ["Planning", "Code Review", "Testing", "Analysis", "Web Search", "Deployment", "Documentation", "Security"];

const AGENT_COLORS = ["#5e4ae3", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899", "#8b5cf6", "#06b6d4"];

export function AgentOnboarding({ mission }: AgentOnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [selectedEngine, setSelectedEngine] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState(AGENT_COLORS[0]);
  const [webSearch, setWebSearch] = useState(true);
  const [codeExec, setCodeExec] = useState(true);
  const [fileSystem, setFileSystem] = useState(false);
  const [soulMd, setSoulMd] = useState("");
  const [agentsMd, setAgentsMd] = useState("");

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-[11px] font-semibold",
                    i < currentStep
                      ? "bg-emerald-500 text-white"
                      : i === currentStep
                        ? "bg-[#5e4ae3] text-white"
                        : "bg-white/[0.06] text-[#918f90]",
                  )}
                >
                  {i < currentStep ? <CheckIcon className="size-3.5" /> : i + 1}
                </div>
                <span className={cn("text-[12px] font-medium", i === currentStep ? "text-white" : "text-[#918f90]")}>{step}</span>
                {i < STEPS.length - 1 && <div className="mx-3 h-px w-12 bg-white/[0.08]" />}
              </div>
            ))}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-[#5e4ae3] transition-all" style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>

        {/* Step Content */}
        {currentStep === 0 && (
          <div className="mx-auto max-w-2xl space-y-6">
            <SectionTitle title="Agent Identification" subtitle="Set up the basic identity for your new agent" />

            <div className="flex items-start gap-6">
              {/* Avatar */}
              <div className="flex flex-col items-center gap-2">
                <div className="flex size-20 items-center justify-center rounded-full text-2xl font-bold text-white" style={{ background: `linear-gradient(135deg, ${selectedColor}80, ${selectedColor})` }}>
                  {name ? name[0]?.toUpperCase() : "?"}
                </div>
                <span className="text-[11px] text-[#918f90]">Avatar</span>
              </div>

              <div className="flex-1 space-y-4">
                <FormField label="Agent Name" placeholder="e.g. Pickle, Scout-01" value={name} onChange={setName} />
                <FormField label="Role / Title" placeholder="e.g. Orchestrator, QA Engineer" value={role} onChange={setRole} />
              </div>
            </div>

            {/* Color Picker */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Agent Color</label>
              <div className="flex gap-2">
                {AGENT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setSelectedColor(c)}
                    className={cn("size-8 rounded-full transition-all", selectedColor === c && "ring-2 ring-white ring-offset-2 ring-offset-[#0f0f10]")}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className="mx-auto max-w-2xl space-y-6">
            <SectionTitle title="Core Engine" subtitle="Select the primary execution engine for this agent" />
            <div className="grid grid-cols-2 gap-3">
              {ENGINES.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEngine(e.id)}
                  className={cn(
                    "rounded-xl border bg-gradient-to-br p-4 text-left transition-all",
                    e.color,
                    selectedEngine === e.id ? "ring-2 ring-[#5e4ae3] ring-offset-2 ring-offset-[#0f0f10]" : "opacity-70 hover:opacity-100",
                  )}
                >
                  <div className="text-[14px] font-semibold text-white">{e.name}</div>
                  <div className="mt-1 text-[12px] text-[#918f90]">{e.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="mx-auto max-w-2xl space-y-6">
            <SectionTitle title="Capabilities & Tooling" subtitle="Configure what this agent can do" />

            {/* Skills */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Skills</label>
              <div className="flex flex-wrap gap-2">
                {SKILLS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSelectedSkills((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all",
                      selectedSkills.includes(s)
                        ? "border-[#5e4ae3]/50 bg-[#5e4ae3]/20 text-[#c6bfff]"
                        : "border-white/[0.08] bg-white/[0.03] text-[#918f90] hover:border-white/[0.15]",
                    )}
                  >
                    {selectedSkills.includes(s) && <CheckIcon className="mr-1 inline size-3" />}
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Tool Access */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Tool Access</label>
              <div className="space-y-2">
                <ToggleRow label="Web Search" description="Allow agent to search the web" checked={webSearch} onChange={setWebSearch} />
                <ToggleRow label="Code Execution" description="Allow agent to run code" checked={codeExec} onChange={setCodeExec} />
                <ToggleRow label="File System" description="Allow file read/write access" checked={fileSystem} onChange={setFileSystem} />
              </div>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="mx-auto max-w-2xl space-y-6">
            <SectionTitle title="Agent Persona" subtitle="Define the agent's personality and behavior guidelines" />

            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">SOUL.md</label>
              <textarea
                value={soulMd}
                onChange={(e) => setSoulMd(e.target.value)}
                placeholder="Define the agent's core personality, values, and communication style..."
                className="h-32 w-full rounded-xl border border-white/[0.08] bg-[#1c1b1c] px-4 py-3 text-[13px] text-white outline-none placeholder:text-[#918f90] focus:border-[#5e4ae3]/50"
              />
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">AGENTS.md</label>
              <textarea
                value={agentsMd}
                onChange={(e) => setAgentsMd(e.target.value)}
                placeholder="Define relationships with other agents, collaboration rules..."
                className="h-32 w-full rounded-xl border border-white/[0.08] bg-[#1c1b1c] px-4 py-3 text-[13px] text-white outline-none placeholder:text-[#918f90] focus:border-[#5e4ae3]/50"
              />
            </div>
          </div>
        )}

        {/* Info Cards */}
        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-3">
          <InfoCard icon={<ShieldIcon className="size-4" />} title="Encrypted Instance" description="All agent data is encrypted at rest and in transit" />
          <InfoCard icon={<ZapIcon className="size-4" />} title="Low-Latency Execution" description="Sub-100ms response time for local engines" />
          <InfoCard icon={<NetworkIcon className="size-4" />} title="Multi-Agent Sync" description="Real-time state synchronization across agents" />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.06] bg-[#131314] px-6 py-4">
        <button className="rounded-lg border border-white/[0.08] px-4 py-2 text-[13px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04]">
          Cancel
        </button>
        <div className="flex gap-2">
          {currentStep > 0 && (
            <button onClick={() => setCurrentStep((s) => s - 1)} className="rounded-lg border border-white/[0.08] px-4 py-2 text-[13px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]">
              Back
            </button>
          )}
          <button className="rounded-lg border border-white/[0.08] px-4 py-2 text-[13px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04]">
            Save Draft
          </button>
          {currentStep < STEPS.length - 1 ? (
            <button onClick={() => setCurrentStep((s) => s + 1)} className="rounded-lg bg-gradient-to-r from-[#c6bfff] to-[#5e4ae3] px-5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90">
              Next Step
            </button>
          ) : (
            <button className="rounded-lg bg-gradient-to-r from-[#c6bfff] to-[#5e4ae3] px-5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90">
              Initialize Agent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-1 text-[13px] text-[#918f90]">{subtitle}</p>
    </div>
  );
}

function FormField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.08] bg-[#1c1b1c] px-3.5 py-2.5 text-[13px] text-white outline-none placeholder:text-[#918f90] focus:border-[#5e4ae3]/50"
      />
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#1c1b1c] px-4 py-3">
      <div>
        <div className="text-[13px] font-medium text-white">{label}</div>
        <div className="text-[11px] text-[#918f90]">{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn("h-5 w-9 rounded-full transition-colors", checked ? "bg-[#5e4ae3]" : "bg-white/[0.1]")}
      >
        <div className={cn("size-4 rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

function InfoCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
      <div className="mb-2 text-[#5e4ae3]">{icon}</div>
      <div className="text-[13px] font-semibold text-white">{title}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-[#918f90]">{description}</div>
    </div>
  );
}
