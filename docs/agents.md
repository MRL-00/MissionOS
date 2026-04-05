# Agents

Agents are the execution units in MissionOS.

Each agent stores:

- Identity: name, role, emoji, color
- Engine: codex, cursor, claude-code, openclaw, pi, or hermes
- Skills and tools
- Connection config
- Optional inline `SOUL.md` and `AGENTS.md`

If **Managed externally** is enabled, MissionOS skips inline prompt injection.
