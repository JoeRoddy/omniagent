# agentctrl

One config, many agents.

agentctrl is a CLI that lets a team define a single, canonical agent configuration and sync it to
multiple AI coding agents. It solves the everyday pain where each agent expects the same features in
a different shape, so two developers using different agents can still share the exact same tooling
and intent.

## Why it exists

Many agents use bespoke config formats. Teams either duplicate configs or accept drift. agentctrl
unifies that into a single source of truth and compiles it to each runtime.

## What it does today

Right now, agentctrl focuses on **skills**, **subagents**, and **slash commands**:

- Canonical skills: `agents/skills/`
- Canonical subagents: `agents/agents/` (Claude Code subagent format: Markdown with YAML
  frontmatter; `name` overrides the filename when present)
- Canonical slash commands: `agents/commands/` (Claude Code format: Markdown with optional YAML
  frontmatter; filename becomes the command name; use `targets`/`targetAgents` to scope sync)
- `agentctrl sync` copies skills, syncs subagents to Claude Code (and converts to skills for other
  targets), and maps slash commands into each supported target's expected location

## Supported targets (current)

- Claude Code (skills + slash commands + subagents, project/global)
- OpenAI Codex (skills + global slash-command prompts; subagents converted to skills)
- GitHub Copilot CLI (skills; slash commands + subagents converted to skills)
- Gemini CLI (skills require `experimental.skills`; slash commands project/global; subagents
  converted to skills)

## Quick start

```bash
# 1) Create canonical skills
mkdir -p agents/skills
printf "# My Skill\n" > agents/skills/example.md

# 2) Create a canonical slash command
mkdir -p agents/commands
cat <<'CMD' > agents/commands/plan-release.md
---
description: Plan a release
targets:
  - claude
  - gemini
---
Draft a release plan with milestones and owners.
CMD

# 3) Build the CLI
npm install
npm run build

# 4) Sync to all targets
node dist/cli.js sync
```

## Slash commands

Slash commands are Markdown files in `agents/commands/`. The filename is the command name. Optional
YAML frontmatter can include metadata like `description` and can scope targets via `targets` or
`targetAgents` (values: `claude`, `gemini`, `codex`, `copilot`). By default, commands sync to all
supported targets.

## Subagents

Subagents are Markdown files in `agents/agents/` using the Claude Code subagent format (YAML
frontmatter + prompt body). The `name` frontmatter field overrides the filename; if omitted, the
filename (without `.md`) is used. Non-Claude targets receive converted skills at
`.target/skills/<name>/SKILL.md`.

## Sync command

```bash
agentctrl sync
agentctrl sync --only claude
agentctrl sync --only gemini
agentctrl sync --skip codex
agentctrl sync --yes
agentctrl sync --json
```

## Roadmap

- Skills, agents, and slash commands unification
- AGENT.md unification (mirroring CLAUDE.md, cursor rules, etc)
- private / local config
