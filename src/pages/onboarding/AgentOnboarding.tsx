import { NetworkIcon, ShieldIcon, ZapIcon } from "lucide-react";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";
import { AgentWizard } from "./AgentWizard";

interface AgentOnboardingProps {
  mission: MissionControlState;
}

export function AgentOnboarding({ mission }: AgentOnboardingProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141415] shadow-2xl shadow-black/50">
        <AgentWizard
          mission={mission}
          onComplete={() => mission.setActiveView("orgchart")}
          onCancel={() => mission.logout()}
          submitLabel="Initialize Agent"
        />

        {/* Info cards */}
        <div className="grid grid-cols-3 gap-px border-t border-white/[0.06] bg-white/[0.06]">
          <InfoCard icon={<ShieldIcon className="size-3.5" />} title="Encrypted" description="Local SQLite storage" />
          <InfoCard icon={<ZapIcon className="size-3.5" />} title="Low-Latency" description="Test before onboarding" />
          <InfoCard icon={<NetworkIcon className="size-3.5" />} title="Multi-Agent" description="Org chart sync" />
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-[#141415] px-4 py-3">
      <div className="mb-1 text-[#5e4ae3]">{icon}</div>
      <div className="text-[11px] font-semibold text-[#918f90]">{title}</div>
      <div className="text-[10px] leading-snug text-[#585658]">{description}</div>
    </div>
  );
}
