import { useState } from "react";
import type { FormEvent } from "react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";

export function ProjectSetupPage({ mission }: { mission: MissionControlState }) {
  const [name, setName] = useState("MissionOS HQ");
  const [description, setDescription] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextName = String(formData.get("name") ?? "");
    const nextDescription = String(formData.get("description") ?? "");
    const ok = await mission.saveProject({ name: nextName, description: nextDescription });
    if (ok) {
      setName("");
      setDescription("");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f0f10] px-6 py-10">
      <div className="w-full max-w-2xl rounded-2xl border border-white/[0.06] bg-[#131314] p-6 shadow-2xl shadow-black/25">
        <div className="mb-6">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Project Setup</div>
          <h1 className="text-2xl font-semibold text-white">Create the workspace project</h1>
          <p className="mt-2 text-[13px] text-[#918f90]">This singleton project anchors resets, missions, and onboarding.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label="Project Name" name="name" value={name} onChange={setName} placeholder="MissionOS HQ" />
          <div>
            <label htmlFor="project-description" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Description</label>
            <textarea
              id="project-description"
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe what this workspace is for..."
              className="h-32 w-full rounded-lg border border-white/[0.08] bg-[#1c1b1c] px-3.5 py-2.5 text-[13px] text-white outline-none placeholder:text-[#918f90] focus:border-[#5e4ae3]/50"
            />
          </div>

          {mission.error ? <div className="text-[12px] text-red-400">{mission.error}</div> : null}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={mission.busyKey === "project:create"}
              className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {mission.busyKey === "project:create" ? "Saving..." : "Continue to onboarding"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const id = `project-${name}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">{label}</label>
      <input
        id={id}
        name={name}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.08] bg-[#1c1b1c] px-3.5 py-2.5 text-[13px] text-white outline-none placeholder:text-[#918f90] focus:border-[#5e4ae3]/50"
      />
    </div>
  );
}
