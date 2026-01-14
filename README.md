# omniagent

One config, many agents.

omniagent is a CLI that lets a team define a single, canonical agent configuration and sync it to
multiple AI coding agents.

Many agents use bespoke config formats. Teams either duplicate configs or accept drift. omniagent
unifies that into a single source of truth and compiles it to each runtime.

## What it does today

Right now, omniagent focuses on **skills**, **subagents**, and **slash commands**:

- Canonical skills: `agents/skills/`
- Canonical subagents: `agents/agents/` (Claude Code subagent format: Markdown with YAML
  frontmatter; `name` overrides the filename when present)
- Canonical slash commands: `agents/commands/` (Claude Code format: Markdown with optional YAML
  frontmatter; filename becomes the command name)
- `omniagent sync` copies skills, syncs subagents to Claude Code (and converts to skills for other
  targets), and maps slash commands into each supported target's expected location

## Supported targets (current)

- Claude Code (skills + slash commands + subagents, project/global)
- OpenAI Codex (skills + global slash-command prompts; subagents converted to skills)
- GitHub Copilot CLI (skills; slash commands + subagents converted to skills)
- Gemini CLI (skills require `experimental.skills`; slash commands project/global; subagents
  converted to skills)

## Quick start

```bash
# 1) Create a subagent
mkdir -p agents/agents
cat > agents/agents/release-helper.md <<'AGENT'
---
name: release-helper
description: "Help draft release plans and checklists."
---
Draft a release plan with milestones and owners.
AGENT

# 2) sync your tooling to your desired agents
npx omniagent@latest sync --only claude,codex,gemini
```

Only Claude supports native subagents. Other targets will receive converted skills.

Example outputs:

```text
.claude/agents/release-helper.md
.codex/skills/release-helper/SKILL.md
.gemini/skills/release-helper/SKILL.md
```

## Custom Frontmatter Config

Syncable Markdown files (skills, subagents, slash commands) can include YAML frontmatter for
metadata and targeting. Common keys:

- `targets` or `targetAgents`: single value or list; case-insensitive. Values: `claude`, `gemini`,
  `codex`, `copilot`. These defaults can be overridden per run with `--only` or filtered with
  `--skip`.
- `name`: overrides the filename (when supported).
- `description`: optional metadata (when supported).

Example:

```yaml
---
name: release-helper
description: 'Help draft release plans and checklists.'
targets:
  - claude
  - gemini
---
```

## Skills

Canonical skills live in `agents/skills/` (each skill folder contains `SKILL.md`).

## Slash commands

Slash commands are Markdown files in `agents/commands/`. The filename is the command name. Optional
YAML frontmatter can include metadata like `description`. By default, commands sync to all
supported targets.

## Subagents

Subagents are Markdown files in `agents/agents/` using the Claude Code subagent format (YAML
frontmatter + prompt body). The `name` frontmatter field overrides the filename; if omitted, the
filename (without `.md`) is used. Non-Claude targets receive converted skills at
`.target/skills/<name>/SKILL.md`.

## Agent Scoped Templating

Agent scoped templating lets you keep a single canonical file while including or excluding blocks
for specific agents.

It works in every syncable file type (skills, subagents, slash commands, and future
syncable features).

```text
Shared content.

<agents claude,codex>
Only Claude and Codex see this.
</agents>

<agents not:claude,gemini>
Everyone except Claude and Gemini see this.
</agents>

More shared content.
```

## Sync command

```bash
npx omniagent@latest sync
npx omniagent@latest sync --only claude
npx omniagent@latest sync --only gemini
npx omniagent@latest sync --skip codex
npx omniagent@latest sync --yes
npx omniagent@latest sync --json
```

Run-level overrides:

- `--only` replaces per-file frontmatter defaults for this run.
- `--skip` filters the active target set (frontmatter defaults or all targets).
- If both are provided, `--only` applies first, then `--skip`.

## Roadmap

- Skills, agents, and slash commands unification
- AGENT.md unification (mirroring CLAUDE.md, cursor rules, etc)
- private / local config
