# Codex

Codex runs through the local `codex` CLI.

## Required fields

- `codexPath`
- `apiKey` (optional if your environment already provides it)

## Optional fields

- `sandboxMode`

Supported values:

- `full-auto` for writable implementation runs
- `read-only` for analysis-only runs

## Test

MissionOS validates the adapter by running `codex --version`.
