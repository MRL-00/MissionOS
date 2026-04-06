import { useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MissionLink } from "@/components/MissionLink";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FAQ = `
## FAQ

### When does onboarding appear?
Only on first run, until the first agent exists.

### Where are agent credentials stored?
Engine and integration values are stored in SQLite settings, not in environment variables.

### How do agent files work?
If an agent is not managed externally, selected skills plus inline \`SOUL.md\` and \`AGENTS.md\` are prepended to each run prompt.
`;

export function HelpPage({ mission }: { mission: MissionControlState }) {
  const [type, setType] = useState("bug");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await mission.sendFeedback({ type, message });
    if (ok) {
      setMessage("");
      setStatus("Feedback captured.");
    }
  }

  return (
    <div className="grid h-full grid-cols-[1.2fr_0.8fr] gap-6 p-6">
      <div className="rounded-xl border border-white/[0.06] bg-[#1c1b1c] p-5">
        <div className="mb-4">
          <h1 className="text-[18px] font-semibold text-white">Help</h1>
          <p className="mt-1 text-[13px] text-[#918f90]">Documentation shortcuts, FAQs, and feedback intake.</p>
        </div>
        <div className="prose prose-invert max-w-none prose-headings:text-white prose-p:text-[#c8c4d7] prose-li:text-[#c8c4d7]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{FAQ}</ReactMarkdown>
        </div>
        <div className="mt-6 flex gap-2">
          <MissionLink
            view="docs"
            search="path=getting-started.md"
            navigate={mission.setActiveView}
            className="rounded-lg border border-white/[0.08] px-4 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
          >
            Getting Started
          </MissionLink>
          <MissionLink
            view="docs"
            search="path=issues.md"
            navigate={mission.setActiveView}
            className="rounded-lg border border-white/[0.08] px-4 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
          >
            Issues Docs
          </MissionLink>
          <MissionLink
            view="docs"
            search="path=agent-handoff-testing.md"
            navigate={mission.setActiveView}
            className="rounded-lg border border-white/[0.08] px-4 py-2 text-[12px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.04]"
          >
            Handoff Test
          </MissionLink>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#131314] p-5">
        <div className="mb-4">
          <h2 className="text-[16px] font-semibold text-white">Report a Bug</h2>
          <p className="mt-1 text-[12px] text-[#918f90]">This writes to the local feedback table.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Type</label>
            <Select value={type} onValueChange={(v) => setType(v ?? "bug")}>
              <SelectTrigger className="w-full border-white/[0.08] bg-[#0f0f10] text-[13px] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bug">Bug</SelectItem>
                <SelectItem value="suggestion">Suggestion</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#918f90]">Message</label>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="h-40 w-full rounded-lg border border-white/[0.08] bg-[#0f0f10] px-3 py-2 text-[13px] text-white outline-none"
            />
          </div>
          {status ? <div className="text-[12px] text-emerald-400">{status}</div> : null}
          <div className="flex justify-end">
            <button className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[13px] font-medium text-white">
              Send Feedback
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
