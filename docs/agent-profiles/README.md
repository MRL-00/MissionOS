# Agent Profiles

These files are copy-ready `SOUL.md` and `AGENTS.md` prompts for the current team setup.

Included profiles:

- `Boss/`
- `Claudy/`
- `Cody/`

Suggested use:

1. Open the relevant agent in the Agent Wizard.
2. Paste the matching `SOUL.md` into the `SOUL.md` field.
3. Paste the matching `AGENTS.md` into the `AGENTS.md` field.
4. Keep `Managed externally` off if you want MissionOS to inject these prompts into runs.

Recommended pairing:

- `Boss`: delegation-only by prompt and role, but keep runtime writable if Boss is expected to hand work to an implementation agent within the same Codex run
- `Claudy`: engineering owner, code execution on, file system on
- `Cody`: iOS specialist, code execution on, file system on
