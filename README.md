# agentctl

One config, many agents.

agentctl is a CLI that lets a team define a single, canonical agent configuration and sync it to multiple
AI coding agents. It solves the everyday pain where each agent expects the same features in a different
shape, so two developers using different agents can still share the exact same tooling and intent.

## Why it exists

Many agents use bespoke config formats. Teams either duplicate configs or accept drift. agentctl unifies
that into a single source of truth and compiles it to each runtime.

## What it does today

Right now, agentctl focuses on **skills** and **slash commands**:

- Canonical skills: `agents/skills/`
- Canonical slash commands: `agents/commands/` (Claude Code format: Markdown with optional YAML frontmatter)
- `agentctl sync` copies skills and maps slash commands into each supported target's expected location

## Supported targets (current)

- Claude Code
- OpenAI Codex
- GitHub Copilot
- Gemini CLI (skills require `experimental.skills` to be enabled)

## Quick start

```bash
# 1) Create canonical skills
mkdir -p agents/skills
printf "# My Skill\n" > agents/skills/example.md

# 2) Build the CLI
npm install
npm run build

# 3) Sync to all targets
node dist/cli.js sync
```

## Sync command

```bash
agentctl sync
agentctl sync --only claude
agentctl sync --only gemini
agentctl sync --skip codex
agentctl sync --yes
agentctl sync --json
```

## Roadmap

- Skills, agents, and slash commands unification
- AGENT.md unification (mirroring CLAUDE.md)
- More target coverage (Cursor, etc.)
