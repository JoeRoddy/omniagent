# omniagent

One source of truth for agent content across Claude, Codex, Gemini, and Copilot.

Define canonical agent files once in `agents/`, then run `sync` to compile target-specific outputs.

## Quickstart

```bash
mkdir -p agents/agents
cat > agents/agents/release-helper.md <<'AGENT'
---
name: release-helper
description: "Help draft release plans and checklists."
---
Draft a release plan with milestones and owners.
AGENT

npx omniagent@latest sync
```

Typical outputs:

```text
.claude/agents/release-helper.md
.codex/skills/release-helper/SKILL.md
.gemini/skills/release-helper/SKILL.md
.copilot/skills/release-helper/SKILL.md
```

## How It Works

1. Author canonical sources in `agents/` (and optional repo `AGENTS.md`).
2. Run `omniagent sync`.
3. Omniagent writes target-specific files, converting unsupported surfaces when needed.

## Common Commands

```bash
# Sync all active targets
npx omniagent@latest sync

# Sync specific targets
npx omniagent@latest sync --only claude,codex

# Skip a target for this run
npx omniagent@latest sync --skip gemini

# Use a non-default agents directory
npx omniagent@latest sync --agentsDir ./my-custom-agents

# Show local-only overrides and exit
npx omniagent@latest sync --list-local

# Shim mode (no subcommand)
omniagent --agent codex
omniagent -p "Summarize this repo" --agent codex --output json
```

## Documentation

- Docs index: [`docs/README.md`](docs/README.md)
- Getting started: [`docs/getting-started.md`](docs/getting-started.md)
- Sync basics: [`docs/sync-basics.md`](docs/sync-basics.md)
- CLI shim details: [`docs/cli-shim.md`](docs/cli-shim.md)
- Custom targets (custom agents): [`docs/custom-targets.md`](docs/custom-targets.md)
- Local overrides: [`docs/local-overrides.md`](docs/local-overrides.md)
- Templating and dynamic scripts: [`docs/templating.md`](docs/templating.md)
- Command reference: [`docs/reference.md`](docs/reference.md)
- Troubleshooting: [`docs/troubleshooting.md`](docs/troubleshooting.md)
- CLI shim E2E guide: [`docs/cli-shim-e2e.md`](docs/cli-shim-e2e.md)

## Requirements

- Node.js 18+

## Validation

```bash
npm run check
npm test
```
