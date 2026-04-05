import { useRef, useMemo, useState } from "react";
import { AlertTriangleIcon, CheckCircleIcon, GitBranchIcon, ImageIcon, KeyIcon, LinkIcon, PaletteIcon, Trash2Icon, UploadIcon } from "lucide-react";
import type { EngineConnectionResult } from "@/mission/appTypes";
import { describeEngineVersion, seedEngineConfig } from "@/lib/engineConfig";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SettingsProps {
  mission: MissionControlState;
}

const NAV_ANCHORS = [
  { id: "profile", label: "Profile" },
  { id: "integrations", label: "Integrations" },
  { id: "credentials", label: "Execution Engines" },
  { id: "usage", label: "Usage & Billing" },
  { id: "appearance", label: "Appearance" },
  { id: "danger", label: "Danger Zone" },
];

export function Settings({ mission }: SettingsProps) {
  const [activeSection, setActiveSection] = useState("profile");
  const [profileName, setProfileName] = useState(mission.user?.displayName ?? "");
  const [profileEmoji, setProfileEmoji] = useState(mission.user?.avatarEmoji ?? "👤");
  const [projectLogo, setProjectLogo] = useState(mission.settingsMap.project_logo ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("obsidian");
  const [status, setStatus] = useState("");
  const [projectConfirm, setProjectConfirm] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>(mission.settingsMap);
  const [engineTestResults, setEngineTestResults] = useState<Record<string, EngineConnectionResult>>({});

  const engineConfigs = useMemo(
    () =>
      Object.fromEntries(
        mission.engines.map((engine) => {
          const key = `engine.${engine.id}`;
          return [engine.id, seedEngineConfig(engine, settingsDraft[key]) as Record<string, string>];
        }),
      ),
    [mission.engines, settingsDraft],
  );

  return (
    <div className="flex h-full">
      <div className="w-[200px] shrink-0 border-r border-white/[0.06] bg-[#131314] p-4">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Settings</div>
        <nav className="space-y-0.5">
          {NAV_ANCHORS.map((anchor) => (
            <button
              key={anchor.id}
              onClick={() => setActiveSection(anchor.id)}
              className={cn(
                "flex w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
                activeSection === anchor.id ? "bg-white/[0.08] text-white" : "text-[#918f90] hover:bg-white/[0.04] hover:text-[#c8c4d7]",
              )}
            >
              {anchor.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <section id="profile" className={activeSection !== "profile" ? "hidden" : ""}>
            <SectionHeader icon={<KeyIcon className="size-4" />} title="Profile" subtitle="Local account identity and password changes" />
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-5">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Display Name" value={profileName} onChange={setProfileName} placeholder="Mission Control" />
                <FormField label="Avatar Emoji" value={profileEmoji} onChange={setProfileEmoji} placeholder="👤" />
                <div className="col-span-2">
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Project Logo</label>
                  <LogoUpload value={projectLogo} onChange={setProjectLogo} />
                </div>
                <FormField label="Current Password" value={currentPassword} onChange={setCurrentPassword} placeholder="••••••••" type="password" />
                <FormField label="New Password" value={newPassword} onChange={setNewPassword} placeholder="••••••••" type="password" />
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={async () => {
                    const ok = await mission.saveProfile({ displayName: profileName, avatarEmoji: profileEmoji });
                    await mission.updateSettingsMap({ ...settingsDraft, project_logo: projectLogo });
                    if (ok) setStatus("Profile saved.");
                  }}
                  className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2.5 text-[13px] font-medium text-white"
                >
                  Save Profile
                </button>
                <button
                  onClick={async () => {
                    const ok = await mission.updatePassword({ currentPassword, newPassword });
                    if (ok) {
                      setCurrentPassword("");
                      setNewPassword("");
                      setStatus("Password updated.");
                    }
                  }}
                  className="rounded-lg border border-white/[0.08] px-4 py-2.5 text-[13px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                >
                  Change Password
                </button>
              </div>
            </div>
          </section>

          <section id="integrations" className={activeSection !== "integrations" ? "hidden" : ""}>
            <SectionHeader icon={<LinkIcon className="size-4" />} title="Linear Integration" subtitle="Connect your Linear workspace for issue synchronization" />
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-5">
              <div className="grid grid-cols-[1fr_180px] gap-3">
                <FormField
                  label="API Key"
                  value={settingsDraft.linear_api_key ?? ""}
                  onChange={(value) => setSettingsDraft({ ...settingsDraft, linear_api_key: value })}
                  placeholder="lin_api_xxxxx"
                  type="password"
                />
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Use Linear for Issues</label>
                  <Select value={settingsDraft.linear_use_for_issues ?? "false"} onValueChange={(value) => setSettingsDraft({ ...settingsDraft, linear_use_for_issues: value ?? "false" })}>
                    <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">Off</SelectItem>
                      <SelectItem value="true">On</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={async () => {
                    const ok = await mission.updateSettingsMap(settingsDraft);
                    if (ok) setStatus("Linear settings saved.");
                  }}
                  className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2.5 text-[13px] font-medium text-white"
                >
                  Save
                </button>
                <button
                  onClick={async () => {
                    await mission.updateSettingsMap(settingsDraft);
                    const result = await mission.testLinearConnection();
                    if (result) setStatus(`Connected — ${result.workspace}`);
                  }}
                  className="rounded-lg border border-white/[0.08] px-4 py-2.5 text-[13px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                >
                  Test Connection
                </button>
              </div>
              {mission.settingsMap.linear_api_key ? (
                <div className="mt-3 flex items-center gap-2 text-[12px] text-emerald-400">
                  <CheckCircleIcon className="size-3.5" />
                  Linear API key configured
                </div>
              ) : null}
            </div>

            <div className="mt-6" />
            <SectionHeader icon={<GitBranchIcon className="size-4" />} title="GitHub Integration" subtitle="Connect a GitHub account for repo cloning, branching, and PR creation" />
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-5">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label="Personal Access Token"
                  value={settingsDraft.github_pat ?? ""}
                  onChange={(value) => setSettingsDraft({ ...settingsDraft, github_pat: value })}
                  placeholder="ghp_xxxxx"
                  type="password"
                />
                <FormField
                  label="Workspace Directory (optional)"
                  value={settingsDraft.github_workspace_dir ?? ""}
                  onChange={(value) => setSettingsDraft({ ...settingsDraft, github_workspace_dir: value })}
                  placeholder="./workspaces"
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={async () => {
                    const ok = await mission.updateSettingsMap(settingsDraft);
                    if (ok) setStatus("GitHub settings saved.");
                  }}
                  className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2.5 text-[13px] font-medium text-white"
                >
                  Save
                </button>
                <button
                  onClick={async () => {
                    await mission.updateSettingsMap(settingsDraft);
                    const result = await mission.testGitHubConnection();
                    if (result) setStatus(`GitHub — ${result.message}`);
                  }}
                  className="rounded-lg border border-white/[0.08] px-4 py-2.5 text-[13px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                >
                  Test Connection
                </button>
              </div>
              {mission.settingsMap.github_pat ? (
                <div className="mt-3 flex items-center gap-2 text-[12px] text-emerald-400">
                  <CheckCircleIcon className="size-3.5" />
                  GitHub token configured
                </div>
              ) : null}
            </div>
          </section>

          <section id="credentials" className={activeSection !== "credentials" ? "hidden" : ""}>
            <SectionHeader icon={<KeyIcon className="size-4" />} title="Execution Engines" subtitle="Store connection settings for each supported adapter" />
            <div className="mt-4 grid grid-cols-2 gap-4">
              {mission.engines.map((engine) => (
                <div key={engine.id} className="rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="text-[14px] font-semibold text-white">{engine.label}</div>
                    {engineTestResults[engine.id]?.currentVersion ? (
                      <span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 text-[10px] font-medium text-[#c8c4d7]">
                        v{engineTestResults[engine.id]?.currentVersion}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-3">
                    {engine.fields.map((field) => (
                      <FormField
                        key={field.key}
                        label={field.label}
                        value={String(engineConfigs[engine.id]?.[field.key] ?? field.defaultValue ?? "")}
                        onChange={(value) => {
                          const nextConfig = {
                            ...(engineConfigs[engine.id] ?? {}),
                            [field.key]: value,
                          };
                          setSettingsDraft({
                            ...settingsDraft,
                            [`engine.${engine.id}`]: JSON.stringify(nextConfig),
                          });
                        }}
                        placeholder={field.placeholder ?? ""}
                        type={field.type === "password" ? "password" : "text"}
                      />
                    ))}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={async () => {
                        const ok = await mission.updateSettingsMap(settingsDraft);
                        if (ok) setStatus(`${engine.label} settings saved.`);
                      }}
                      className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[12px] font-medium text-white"
                    >
                      Save
                    </button>
                    <button
                      onClick={async () => {
                        const result = await mission.testEngineConnection(engine.id, engineConfigs[engine.id] ?? {});
                        if (result) {
                          setEngineTestResults((current) => ({
                            ...current,
                            [engine.id]: result,
                          }));
                          setStatus(`${engine.label}: ${result.ok ? "✓" : "✗"} ${result.message}`);
                        }
                      }}
                      className="rounded-lg border border-white/[0.08] px-4 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
                    >
                      Test
                    </button>
                  </div>
                  {engineTestResults[engine.id] ? (
                    <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] text-[#c8c4d7]">
                      <div className={engineTestResults[engine.id]?.ok ? "text-emerald-300" : "text-amber-200"}>
                        {engineTestResults[engine.id]?.ok ? "✓" : "✗"} {engineTestResults[engine.id]?.message}
                      </div>
                      {describeEngineVersion(engineTestResults[engine.id]) ? (
                        <div className="mt-1">{describeEngineVersion(engineTestResults[engine.id])}</div>
                      ) : null}
                      {engineTestResults[engine.id]?.updateAvailable && engineTestResults[engine.id]?.upgradeCommand ? (
                        <div className="mt-1 text-[#918f90]">Upgrade: <code>{engineTestResults[engine.id]?.upgradeCommand}</code></div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section id="appearance" className={activeSection !== "appearance" ? "hidden" : ""}>
            <SectionHeader icon={<PaletteIcon className="size-4" />} title="Interface Theme" subtitle="The current theme is preserved while functionality is added underneath it" />
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
                <div className="mt-0.5 text-[11px] text-[#918f90]">Current production theme</div>
              </button>
              <div className="rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-4 opacity-50">
                <div className="mb-3 h-16 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200" />
                <div className="text-[13px] font-semibold text-white">Solar White</div>
                <div className="mt-0.5 text-[11px] text-[#918f90]">Reserved</div>
              </div>
            </div>
          </section>

          <section id="usage" className={activeSection !== "usage" ? "hidden" : ""}>
            <SectionHeader icon={<CheckCircleIcon className="size-4" />} title="Usage & Billing" subtitle="Estimated token and spend display settings for the runs dashboard" />
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Display Currency</label>
                  <Select
                    value={settingsDraft.usage_currency ?? "USD"}
                    onValueChange={(raw) => {
                      const currency = raw ?? "USD";
                      setSettingsDraft({
                        ...settingsDraft,
                        usage_currency: currency,
                        usage_usd_exchange_rate:
                          settingsDraft.usage_usd_exchange_rate
                          ?? (currency === "NZD" ? "1.65" : "1"),
                      });
                    }}
                  >
                    <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="NZD">NZD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <FormField
                  label="Manual FX Rate"
                  value={settingsDraft.usage_usd_exchange_rate ?? ((settingsDraft.usage_currency ?? "USD") === "NZD" ? "1.65" : "1")}
                  onChange={(value) => setSettingsDraft({ ...settingsDraft, usage_usd_exchange_rate: value })}
                  placeholder="1 USD = X display currency"
                />
              </div>
              <div className="mt-3 text-[12px] text-[#918f90]">
                Spend is estimated from prompt/output text length and converted using your manual FX rate.
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={async () => {
                    const ok = await mission.updateSettingsMap(settingsDraft);
                    if (ok) setStatus("Usage settings saved.");
                  }}
                  className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2.5 text-[13px] font-medium text-white"
                >
                  Save
                </button>
              </div>
            </div>
          </section>

          <section id="danger" className={activeSection !== "danger" ? "hidden" : ""}>
            <SectionHeader icon={<AlertTriangleIcon className="size-4 text-red-400" />} title="Danger Zone" subtitle="Reset the SQLite project and return to first run" danger />
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.03] p-5 shadow-[0_0_30px_rgba(239,68,68,0.05)]">
              <div className="space-y-4">
                <div>
                  <div className="text-[13px] font-semibold text-white">Reset Project</div>
                  <div className="text-[12px] text-[#918f90]">Type the project name to confirm a full wipe.</div>
                </div>
                <input
                  value={projectConfirm}
                  onChange={(event) => setProjectConfirm(event.target.value)}
                  placeholder={mission.project?.name ?? "project name"}
                  className="w-full rounded-lg border border-red-500/20 bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
                />
                <button
                  onClick={async () => {
                    const ok = await mission.wipeProject(projectConfirm);
                    if (ok) setStatus("Project reset.");
                  }}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/20"
                >
                  Reset Project
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="mx-auto mt-10 flex max-w-3xl items-center justify-center gap-6 text-[11px] text-[#918f90]">
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-400" />Secure Link Established</span>
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#5e4ae3]" />Encryption Active</span>
          <span>OS BUILD 2026.04.05</span>
        </div>

        {status ? <div className="mx-auto mt-4 max-w-3xl text-[12px] text-[#918f90]">{status}</div> : null}
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

function LogoUpload({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be under 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Resize to 64x64 for storage efficiency
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, 64, 64);
        onChange(canvas.toDataURL("image/png"));
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex size-14 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#39147e] to-[#2e1065]">
        {value?.startsWith("data:") ? (
          <img src={value} alt="Logo" className="size-full object-cover" />
        ) : (
          <span className="text-lg font-bold text-white">{value || "M"}</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
          >
            <UploadIcon className="size-3.5" />
            Upload Image
          </button>
          {value?.startsWith("data:") ? (
            <button
              onClick={() => onChange("")}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/10"
            >
              <Trash2Icon className="size-3.5" />
              Remove
            </button>
          ) : null}
        </div>
        <span className="text-[11px] text-[#585658]">PNG, JPG, or SVG. Max 5MB.</span>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none placeholder:text-[#918f90] focus:border-[#5e4ae3]/50"
      />
    </div>
  );
}
