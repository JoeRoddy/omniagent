# Sync Basics

`omniagent sync` compiles canonical sources into target-specific files.

## Canonical inputs

- `agents/agents/*.md` (subagents)
- `agents/skills/*/SKILL.md` (skills)
- `agents/commands/*.md` (slash commands)
- `AGENTS.md` (repo instruction file)

## Target behavior

- Claude supports native subagents.
- Codex, Gemini, and Copilot receive converted outputs where needed.
- Target-specific output paths are handled by built-in target definitions.

## Run-time filtering

Use these flags per sync run:

- `--only <targets>` to include a subset.
- `--skip <targets>` to remove targets after `--only` is applied.
- `--exclude-local[=skills,commands,subagents,instructions]` to ignore local overrides.
- `--list-local` to print detected local items and exit.

## Per-file targeting (frontmatter)

```yaml
---
name: release-helper
targets: [claude, gemini]
---
```

Supported fields:

- `targets` or `targetAgents`: `claude`, `gemini`, `codex`, `copilot`
- `name`: overrides filename where supported
- `description`: optional metadata

For full command examples, see [`docs/reference.md`](reference.md).
