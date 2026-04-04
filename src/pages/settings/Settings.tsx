import { useState } from "react";
import { LinkIcon, PaletteIcon, AlertTriangleIcon, KeyIcon, CheckCircleIcon, LockIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";

interface SettingsProps {
  mission: MissionControlState;
}

const NAV_ANCHORS = [
  { id: "integrations", label: "Integrations" },
  { id: "credentials", label: "Engine Credentials" },
  { id: "appearance", label: "Appearance" },
  { id: "danger", label: "Danger Zone" },
];

export function Settings({ mission }: SettingsProps) {
  const [activeSection, setActiveSection] = useState("integrations");
  const [linearKey, setLinearKey] = useState("");
  const [hermesKey, setHermesKey] = useState("");
  const [openclawKey, setOpenclawKey] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("obsidian");

  return (
    <div className="flex h-full">
      {/* Left Nav */}
      <div className="w-[200px] shrink-0 border-r border-white/[0.06] bg-[#131314] p-4">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Settings</div>
        <nav className="space-y-0.5">
          {NAV_ANCHORS.map((a) => (
            <button
              key={a.id}
              onClick={() => setActiveSection(a.id)}
              className={cn(
                "flex w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
                activeSection === a.id
                  ? "bg-white/[0.08] text-white"
                  : "text-[#918f90] hover:bg-white/[0.04] hover:text-[#c8c4d7]",
              )}
            >
              {a.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* Integrations */}
          <section id="integrations">
            <SectionHeader icon={<LinkIcon className="size-4" />} title="Linear Integration" subtitle="Connect your Linear workspace for task synchronization" />
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-5">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">API Key</label>
                  <input
                    type="password"
                    value={linearKey}
                    onChange={(e) => setLinearKey(e.target.value)}
                    placeholder="lin_api_xxxxxxxxxxxxxxxx"
                    className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3.5 py-2.5 text-[13px] text-white outline-none placeholder:text-[#918f90] focus:border-[#5e4ae3]/50"
                  />
                </div>
                <button className="shrink-0 rounded-lg bg-gradient-to-r from-[#c6bfff] to-[#5e4ae3] px-4 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90">
                  Test Connection
                </button>
              </div>
              {mission.missionSnapshot.taskSync.state === "ok" && (
                <div className="mt-3 flex items-center gap-2 text-[12px] text-emerald-400">
                  <CheckCircleIcon className="size-3.5" />
                  Connected — syncing {mission.missionSnapshot.tasks.length} tasks
                </div>
              )}
            </div>
          </section>

          {/* Engine Credentials */}
          <section id="credentials">
            <SectionHeader icon={<KeyIcon className="size-4" />} title="Engine Credentials" subtitle="API keys for your execution engines" />
            <div className="mt-4 grid grid-cols-2 gap-4">
              <CredentialCard
                name="Hermes-9"
                placeholder="herm_xxxxxxxx"
                value={hermesKey}
                onChange={setHermesKey}
                color="border-emerald-500/20"
              />
              <CredentialCard
                name="OpenClaw-X"
                placeholder="ocx_xxxxxxxx"
                value={openclawKey}
                onChange={setOpenclawKey}
                color="border-[#5e4ae3]/20"
              />
            </div>
          </section>

          {/* Appearance */}
          <section id="appearance">
            <SectionHeader icon={<PaletteIcon className="size-4" />} title="Interface Theme" subtitle="Choose your preferred visual style" />
            <div className="mt-4 grid grid-cols-2 gap-4">
              <button
                onClick={() => setSelectedTheme("obsidian")}
                className={cn(
                  "rounded-xl border p-4 text-left transition-all",
                  selectedTheme === "obsidian"
                    ? "border-[#5e4ae3]/50 bg-[#5e4ae3]/[0.06] ring-2 ring-[#5e4ae3] ring-offset-2 ring-offset-[#0f0f10]"
                    : "border-white/[0.06] bg-[#1c1b1c] hover:border-white/[0.1]",
                )}
              >
                <div className="mb-3 h-16 rounded-lg bg-gradient-to-br from-[#131314] to-[#1c1b1c]" />
                <div className="text-[13px] font-semibold text-white">Obsidian Command</div>
                <div className="mt-0.5 text-[11px] text-[#918f90]">Dark theme optimized for focus</div>
              </button>
              <div className="relative rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4 opacity-50">
                <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.04] px-2 py-0.5 text-[10px] text-[#918f90]">
                  <LockIcon className="size-2.5" />
                  Enterprise
                </div>
                <div className="mb-3 h-16 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200" />
                <div className="text-[13px] font-semibold text-white">Solar White</div>
                <div className="mt-0.5 text-[11px] text-[#918f90]">Light theme for daytime use</div>
              </div>
            </div>
          </section>

          {/* Danger Zone */}
          <section id="danger">
            <SectionHeader icon={<AlertTriangleIcon className="size-4 text-red-400" />} title="Danger Zone" subtitle="Irreversible actions — proceed with caution" danger />
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.03] p-5 shadow-[0_0_30px_rgba(239,68,68,0.05)]">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold text-white">Purge Agent Memory</div>
                    <div className="text-[12px] text-[#918f90]">Wipe all learned behaviors and conversation history</div>
                  </div>
                  <button className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/20">
                    Purge Memory
                  </button>
                </div>
                <div className="h-px bg-red-500/10" />
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold text-white">Reset Engine Credentials</div>
                    <div className="text-[12px] text-[#918f90]">Remove all stored API keys and tokens</div>
                  </div>
                  <button className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/20">
                    Reset Keys
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer Metadata */}
        <div className="mx-auto mt-10 flex max-w-3xl items-center justify-center gap-6 text-[11px] text-[#918f90]">
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-400" />Secure Link Established</span>
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#5e4ae3]" />Encryption Active</span>
          <span>OS BUILD 2024.12.1-alpha</span>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon, title, subtitle, danger }: { icon: React.ReactNode; title: string; subtitle: string; danger?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className={cn("mt-0.5", danger ? "text-red-400" : "text-[#5e4ae3]")}>{icon}</div>
      <div>
        <h2 className="text-[16px] font-semibold text-white">{title}</h2>
        <p className="mt-0.5 text-[13px] text-[#918f90]">{subtitle}</p>
      </div>
    </div>
  );
}

function CredentialCard({ name, placeholder, value, onChange, color }: { name: string; placeholder: string; value: string; onChange: (v: string) => void; color: string }) {
  return (
    <div className={cn("rounded-xl border bg-[#1c1b1c] p-4", color)}>
      <div className="mb-3 text-[14px] font-semibold text-white">{name}</div>
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">API Key</label>
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[#918f90] focus:border-[#5e4ae3]/50"
        />
      </div>
    </div>
  );
}
