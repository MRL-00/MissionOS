import {
  BotIcon,
  GitBranchIcon,
  LayersIcon,
  LayoutDashboardIcon,
  NetworkIcon,
  RocketIcon,
  TerminalIcon,
  ZapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MissionControlState } from "@/mission/hooks/useMissionControl";

interface LandingPageProps {
  mission: MissionControlState;
}

const features: FeatureItem[] = [
  {
    icon: NetworkIcon,
    title: "Agent Org Chart",
    description: "Define your team structure. Assign roles, build hierarchies, and let agents know who they report to and who they collaborate with.",
  },
  {
    icon: LayersIcon,
    title: "Mission Orchestration",
    description: "Create missions that coordinate multiple agents. Lead agents plan and delegate work across the team, with full traceability.",
  },
  {
    icon: BotIcon,
    title: "Multi-Engine Support",
    description: "Connect Claude Code, Codex, Pi, and more. Each agent can use a different engine with its own configuration and tools.",
  },
  {
    icon: TerminalIcon,
    title: "Live Run Streaming",
    description: "Watch agent runs in real time. See output, tool calls, and delegation as it happens — no waiting for logs.",
  },
  {
    icon: GitBranchIcon,
    title: "GitHub Integration",
    description: "Link missions to repositories. Agents automatically create branches, push changes, and open pull requests.",
  },
  {
    icon: ZapIcon,
    title: "Scheduled Execution",
    description: "Set up cron-based schedules for recurring tasks. Agents run on your timetable, whether it's daily reviews or weekly sweeps.",
  },
];

const steps: StepItem[] = [
  {
    number: "01",
    title: "Create your project",
    description: "Set up your local MissionOS instance with a single account. No cloud signup, no vendor lock-in.",
  },
  {
    number: "02",
    title: "Onboard your agents",
    description: "Add AI agents with the built-in wizard. Pick an engine, configure access, and define their role in your org.",
  },
  {
    number: "03",
    title: "Launch missions",
    description: "Define objectives, assign agents, and let the lead agent break down work and delegate across your team.",
  },
];

interface FeatureItem {
  icon: typeof NetworkIcon;
  title: string;
  description: string;
}

interface StepItem {
  number: string;
  title: string;
  description: string;
}

function FeatureCard({ icon: Icon, title, description }: FeatureItem) {
  return (
    <div className="group relative rounded-xl border border-white/[0.06] bg-[#131314] p-6 transition-colors hover:border-white/[0.12] hover:bg-white/[0.02]">
      <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#39147e]/40 to-[#2e1065]/40">
        <Icon className="size-5 text-[#a78bfa]" />
      </div>
      <h3 className="mb-2 text-[15px] font-semibold text-white">{title}</h3>
      <p className="text-[13px] leading-relaxed text-[#918f90]">{description}</p>
    </div>
  );
}

function StepCard({ number, title, description }: StepItem) {
  return (
    <div className="flex gap-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#39147e] to-[#2e1065]">
        <span className="text-[13px] font-bold text-white">{number}</span>
      </div>
      <div>
        <h3 className="mb-1 text-[15px] font-semibold text-white">{title}</h3>
        <p className="text-[13px] leading-relaxed text-[#918f90]">{description}</p>
      </div>
    </div>
  );
}

export function LandingPage({ mission }: LandingPageProps) {
  const hasAccount = mission.bootstrap?.hasAccount ?? false;

  function handleGetStarted() {
    if (hasAccount) {
      mission.setActiveView("login");
    } else {
      mission.setActiveView("setup");
    }
  }

  return (
    <div className="min-h-screen bg-[#0f0f10] text-[#e5e2e3]">
      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0f0f10]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#39147e] to-[#2e1065]">
              <RocketIcon className="size-4 text-white" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-white">MissionOS</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleGetStarted}
              className="rounded-lg bg-gradient-to-r from-[#39147e] to-[#2e1065] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            >
              {hasAccount ? "Sign in" : "Get started"}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Gradient orbs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/4 top-0 size-[600px] rounded-full bg-[#39147e]/[0.07] blur-[120px]" />
          <div className="absolute right-1/4 top-1/3 size-[400px] rounded-full bg-gradient-to-b from-[#2e1065]/[0.05] to-transparent blur-[100px]" />
        </div>

        <div className="relative mx-auto max-w-4xl px-6 pb-24 pt-20 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-[12px] font-medium text-[#a78bfa]">
            <ZapIcon className="size-3.5" />
            Open-source multi-agent orchestration
          </div>

          <h1 className="mb-6 text-5xl font-bold leading-[1.1] tracking-tight text-white sm:text-6xl">
            Your AI agents,{" "}
            <span className="bg-gradient-to-r from-[#a78bfa] to-[#7c3aed] bg-clip-text text-transparent">
              organized
            </span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-[17px] leading-relaxed text-[#918f90]">
            MissionOS gives your AI agents a shared workspace, an org chart, and a mission plan.
            Delegate work across Claude Code, Codex, Pi and more — all from one dashboard.
          </p>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleGetStarted}
              className={cn(
                "rounded-xl px-6 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90",
                "bg-gradient-to-r from-[#39147e] to-[#2e1065] shadow-lg shadow-[#39147e]/25",
              )}
            >
              {hasAccount ? "Sign in to MissionOS" : "Get started — it's free"}
            </button>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-6 py-3 text-[14px] font-medium text-[#c8c4d7] transition-colors hover:bg-white/[0.06]"
            >
              View on GitHub
            </a>
          </div>

          {/* App preview */}
          <div className="relative mx-auto mt-16 max-w-4xl">
            <div className="overflow-hidden rounded-xl border border-white/[0.08] shadow-2xl shadow-black/50">
              <img
                src="/assets/hero.png"
                alt="MissionOS dashboard showing missions, agents, and run history"
                className="w-full"
              />
            </div>
            {/* Fade overlay at bottom */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 rounded-b-xl bg-gradient-to-t from-[#0f0f10] to-transparent" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight text-white">
            Everything you need to run an AI team
          </h2>
          <p className="mx-auto max-w-xl text-[15px] text-[#918f90]">
            MissionOS coordinates your AI agents so they work together — not in isolation.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-white/[0.04] bg-[#0c0c0d]">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight text-white">Up and running in minutes</h2>
            <p className="mx-auto max-w-md text-[15px] text-[#918f90]">
              Self-host, single binary, local-first. No cloud dependencies required.
            </p>
          </div>

          <div className="flex flex-col gap-8">
            {steps.map((step) => (
              <StepCard key={step.number} {...step} />
            ))}
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="border-t border-white/[0.04]">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <div className="mb-10 text-center">
            <h2 className="mb-3 text-2xl font-bold tracking-tight text-white">Built for developers</h2>
            <p className="text-[14px] text-[#918f90]">
              Lightweight, extensible, and completely self-contained.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "React + Vite", sub: "Frontend" },
              { label: "Express + SQLite", sub: "Backend" },
              { label: "Claude · Codex · Pi", sub: "Engines" },
              { label: "Docker", sub: "Deploy" },
            ].map((tech) => (
              <div
                key={tech.label}
                className="rounded-xl border border-white/[0.06] bg-[#131314] px-4 py-4 text-center"
              >
                <div className="text-[13px] font-semibold text-white">{tech.label}</div>
                <div className="mt-1 text-[11px] text-[#6f6b74]">{tech.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/[0.04] bg-gradient-to-b from-[#0f0f10] to-[#131314]">
        <div className="mx-auto max-w-2xl px-6 py-24 text-center">
          <RocketIcon className="mx-auto mb-6 size-12 text-[#a78bfa]" />
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white">
            Ready to launch your first mission?
          </h2>
          <p className="mb-8 text-[15px] text-[#918f90]">
            MissionOS is open source and runs entirely on your machine. No API keys needed to get started — just add your agents and go.
          </p>
          <button
            onClick={handleGetStarted}
            className="rounded-xl bg-gradient-to-r from-[#39147e] to-[#2e1065] px-8 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-[#39147e]/25 transition-opacity hover:opacity-90"
          >
            {hasAccount ? "Sign in to MissionOS" : "Get started — it's free"}
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center overflow-hidden rounded bg-gradient-to-br from-[#39147e] to-[#2e1065]">
              <RocketIcon className="size-3 text-white" />
            </div>
            <span className="text-[13px] font-medium text-[#6f6b74]">MissionOS</span>
          </div>
          <p className="text-[12px] text-[#6f6b74]">Open source · Self-hosted · Local-first</p>
        </div>
      </footer>
    </div>
  );
}