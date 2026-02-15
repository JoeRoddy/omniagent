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

npx omniagent@latest sync --only claude,codex
```

Typical outputs:

```text
.claude/
  agents/
    release-helper.md
.codex/
  skills/
    release-helper/
      SKILL.md
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
npx omniagent@latest sync --skip codex

# Use a non-default agents directory
npx omniagent@latest sync --agentsDir ./my-custom-agents

# Show local-only overrides and exit
npx omniagent@latest sync --list-local

# Shim mode (no subcommand)
omniagent --agent codex
omniagent -p "Summarize this repo" --agent codex --output json
```

## Local Overrides (`.local`)

Use `.local` files for personal variants that should not become team defaults.

```text
agents/
  commands/
    deploy.local.md
  skills/
    review-helper.local/
      SKILL.md
```

Directory-style overrides are also supported:

```text
agents/
  .local/
    commands/
      deploy.md
    skills/
      review-helper/
        SKILL.md
    agents/
      release-helper.md
```

If a `.local` item matches a shared item name, the local item wins for your sync run. Generated
outputs do not keep the `.local` suffix.

Use `--list-local` to see active local items, or `--exclude-local` to ignore them for a run.

## Basic Templating

Use `<agents ...>` blocks when some text should render only for specific targets.

```md
Shared guidance for all targets.

<agents claude,codex>
Extra instructions only for Claude and Codex.
</agents>
```

For advanced templating and dynamic scripts (`<nodejs>`, `<shell>`), see
[`docs/templating.md`](docs/templating.md).

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

## Requirements

- Node.js 18+

## Contributing

Development and test workflows are documented in [`CONTRIBUTING.md`](CONTRIBUTING.md).
