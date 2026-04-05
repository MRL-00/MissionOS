# Agent Handoff Testing

Use this when testing an issue that should be owned by a delegator and implemented by an engineer.

## Goal

For `EPIC-002`, you want:

- the issue assigned to `Boss`
- `Boss` to coordinate only
- `Claudy` to perform the code work in the linked repo

## Preflight Checklist

Before starting the test, confirm:

- the mission linked to the issue has the correct GitHub repo configured
- `EPIC-002` is attached to that mission
- `EPIC-002` is assigned to `Boss`
- `Boss` exists as an agent and is not marked as managed externally
- `Claudy` exists as an agent and is not marked as managed externally
- `Boss` has the `Boss` preset applied
- `Claudy` has the `Claudy` preset applied
- the engine configured for the run can actually execute
- the issue description is specific enough for delegation

## Important Limitation

Assigning an issue to `Boss` does not automatically start a run.

You still need to start a run for `Boss` from the Runs page, or trigger the equivalent backend path yourself.

## Required Delegation Syntax

MissionOS recognizes handoffs when the running agent outputs this exact single-line format:

`@agent:Claudy: <message>`

If `Boss` does not use that syntax, MissionOS will not create the follow-up run for `Claudy`.

## Recommended Test Prompt For Boss

Use a prompt shaped like this when starting the run:

`Handle EPIC-002 for mission EpicZone. You are the delegator only. Review the issue, then hand implementation to Claudy using the MissionOS @agent syntax. The linked repo is inherited from the mission.`

## What Success Looks Like

You should see:

- a run started for `Boss`
- output from `Boss` containing an `@agent:Claudy:` handoff
- a new agent message from `Boss` to `Claudy`
- a follow-up run started for `Claudy`
- repo work happening under `Claudy`, not `Boss`

## Suggested Agent Setup

### Boss

- role: `Orchestrator`
- code execution: disabled
- file system: disabled
- web search: optional

### Claudy

- role: `Engineer`
- code execution: enabled
- file system: enabled
- web search: optional

### Cody

- role: `iOS Developer`
- use only for Apple-platform specific tasks

## Skills

Skills are now included in locally managed prompts.

Use them to make routing clearer, for example:

- `Boss`: `Planning`, `Analysis`, `Documentation`
- `Claudy`: `Testing`, `Code Review`, `Documentation`, `Analysis`
- `Cody`: `Testing`, `Code Review`, `Documentation`

Custom skills can be added directly in the Agent Wizard.
