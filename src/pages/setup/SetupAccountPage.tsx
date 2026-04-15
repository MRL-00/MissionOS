import { useState } from "react";
import type { FormEvent } from "react";
import { MissionLink } from "@/components/MissionLink";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";

export function SetupAccountPage({ mission }: { mission: MissionControlState }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await mission.register({ username, password, displayName });
    if (ok) {
      setUsername("");
      setDisplayName("");
      setPassword("");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f0f10] px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-white/[0.06] bg-[#131314] p-6 shadow-2xl shadow-black/25">
        <div className="mb-6">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">MissionOS Setup</div>
          <h1 className="text-2xl font-semibold text-white">Create your local account</h1>
          <p className="mt-2 text-[13px] text-[#918f90]">
            MissionOS starts empty. Create the first user to unlock project setup and onboarding.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label="Username" value={username} onChange={setUsername} placeholder="operator" />
          <Field label="Display Name" value={displayName} onChange={setDisplayName} placeholder="Mission Control" />
          <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" type="password" />

          {mission.error ? <div className="text-[12px] text-red-400">{mission.error}</div> : null}

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-3">
              <MissionLink
                view="landing"
                navigate={mission.setActiveView}
                className="rounded-lg border border-white/[0.08] px-4 py-2 text-[13px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white"
              >
                Back
              </MissionLink>
              <MissionLink
                view="login"
                navigate={mission.setActiveView}
                className="rounded-lg px-4 py-2 text-[13px] font-medium text-[#918f90] transition-colors hover:text-[#a78bfa]"
              >
                Existing account
              </MissionLink>
            </div>
            <button
              type="submit"
              disabled={mission.busyKey === "auth:register"}
              className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {mission.busyKey === "auth:register" ? "Creating..." : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
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
        className="w-full rounded-lg border border-white/[0.08] bg-[#1c1b1c] px-3.5 py-2.5 text-[13px] text-white outline-none placeholder:text-[#918f90] focus:border-[#5e4ae3]/50"
      />
    </div>
  );
}
