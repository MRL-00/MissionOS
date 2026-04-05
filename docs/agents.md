# Agents

Agents are the execution units in MissionOS.

Each agent stores:

- Identity: name, role, emoji, color
- Engine: codex, cursor, claude-code, openclaw, pi, or hermes
- Skills and tools
- Connection config
- Optional inline `SOUL.md` and `AGENTS.md`

If **Managed externally** is enabled, MissionOS skips inline prompt injection.

If an agent is managed inside MissionOS, run prompts are composed from:

- selected skills
- inline `SOUL.md`
- inline `AGENTS.md`
- the task prompt itself

The Agent Wizard now includes quick presets for:

- `Boss` for delegation-only orchestration
- `Claudy` for general engineering work
- `Cody` for iOS-specific work

Custom skills can also be added in the wizard and are injected into the run prompt with the rest of the local scaffolding.
