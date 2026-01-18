# omniagent

One config, many agents.

omniagent lets teams stay in sync while everyone uses their tool of choice. Define agent
content once and sync it to Claude Code, OpenAI Codex, GitHub Copilot CLI, and Gemini CLI.

```text
# Before (manual drift)
.claude/agents/release-helper.md
.codex/skills/release-helper/SKILL.md
.gemini/skills/release-helper/SKILL.md
.copilot/skills/release-helper/SKILL.md

# After (single source of truth)
agents/agents/release-helper.md
npx omniagent@latest sync
```

## Quick start (subagents)

Create a Claude subagent once, then sync everywhere:

```bash
mkdir -p agents/agents
cat > agents/agents/release-helper.md <<'AGENT'
---
name: release-helper
description: "Help draft release plans and checklists."
---
Draft a release plan with milestones and owners.
AGENT

npx omniagent@latest sync --only claude,codex,gemini,copilot
```

Outputs:

```text
.claude/agents/release-helper.md
.codex/skills/release-helper/SKILL.md
.gemini/skills/release-helper/SKILL.md
.copilot/skills/release-helper/SKILL.md
```

Only Claude supports native subagents. Other targets receive converted skills so they still work.

## What you can sync (show, don’t tell)

### Subagents (Claude format → converted skills elsewhere)

```text
agents/agents/release-helper.md
---
name: release-helper
description: "Help draft release plans and checklists."
---
Draft a release plan with milestones and owners.
```

### Skills

```text
agents/skills/review-helper/SKILL.md
You are a reviewer. Focus on risks, edge cases, and missing tests.
```

### Slash commands

```text
agents/commands/review.md
---
description: "Review a diff with a strict checklist."
---
Summarize issues by severity with file/line references.
```

### Instruction files

```text
AGENTS.md
Global team instructions for all agents.
```

## How it works

1. Author canonical files in `agents/` (and/or repo `AGENTS.md`).
2. Run `omniagent sync`.
3. Omniagent writes the right files for each target tool.

## Supported targets

- Claude Code (native subagents + skills + slash commands)
- OpenAI Codex (skills + global slash-command prompts; subagents converted to skills)
- GitHub Copilot CLI (skills; slash commands + subagents converted to skills)
- Gemini CLI (skills require `experimental.skills`; slash commands project/global;
  subagents converted to skills)

## Repo layout (canonical sources)

```text
agents/
  agents/        # subagents (Claude format)
  skills/        # skills (one folder per skill)
  commands/      # slash commands
  .local/        # personal overrides (ignored in outputs)
AGENTS.md        # repo-wide instructions (optional)
```

## Use cases

- **Keep a team-wide review assistant consistent** while each person uses their preferred tool.
- **Ship one release-helper subagent** that works everywhere.
- **Avoid tool wars** by supporting Claude, Codex, Gemini, and Copilot from one source of truth.
- **Layer personal tweaks** without polluting the repo using `.local` overrides.

## Requirements

- Node.js 18+

## Advanced

### Targeting via frontmatter

```yaml
---
name: release-helper
targets: [claude, gemini]
---
```

- `targets` / `targetAgents`: `claude`, `gemini`, `codex`, `copilot`.
- `name`: overrides filename when supported.
- `description`: optional metadata.

### Instruction templates (per-target outputs)

```text
/agents/guide.AGENTS.md
---
outPutPath: docs/
---
<agents include="claude,gemini">
# Team Instructions
</agents>
```

- Templates live under `/agents/**` and can target specific outputs.
- `outPutPath` is treated as a directory; filename is ignored if supplied.

### Local overrides (personal, never synced)

```text
agents/commands/deploy.local.md
agents/skills/review-helper.local/SKILL.md
```

Local items override shared items with the same name. Outputs never include `.local`.

### Agent-scoped templating

```text
Shared content.

<agents claude,codex>
Only Claude and Codex see this.
</agents>

<agents not:claude,gemini>
Everyone except Claude and Gemini see this.
</agents>
```

## CLI reference

```bash
npx omniagent@latest sync
npx omniagent@latest sync --only claude
npx omniagent@latest sync --skip codex
npx omniagent@latest sync --exclude-local
npx omniagent@latest sync --exclude-local=skills,commands
npx omniagent@latest sync --list-local
npx omniagent@latest sync --yes
npx omniagent@latest sync --json
```

Run-level overrides:

- `--only` replaces per-file frontmatter defaults for this run.
- `--skip` filters the active target set (frontmatter defaults or all targets).
- `--exclude-local` omits local sources entirely (or only for the listed categories).
- `--list-local` prints detected local items and exits.
- If both are provided, `--only` applies first, then `--skip`.
