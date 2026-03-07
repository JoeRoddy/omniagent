# Getting Started

This page expands the quickstart from the root README.

## 1. Create canonical sources

`omniagent` expects source files in `agents/` by default:

```text
agents/
  agents/     # Claude-style subagents
  skills/     # Shared skills
  commands/   # Slash commands
  .local/     # Personal overrides (never synced)
AGENTS.md     # Optional repo-wide instructions
```

## 2. Add one subagent

```bash
mkdir -p agents/agents
cat > agents/agents/release-helper.md <<'AGENT'
---
name: release-helper
description: "Help draft release plans and checklists."
---
Draft a release plan with milestones and owners.
AGENT
```

## 3. Sync

```bash
npx omniagent@latest sync
```

The tool writes target-specific files for enabled targets.

## 4. Iterate

Edit files in `agents/`, then run `sync` again. Do not hand-edit generated files.

## Next pages

- Behavior and target selection: [`docs/sync-basics.md`](sync-basics.md)
- Advanced configuration: [`docs/custom-targets.md`](custom-targets.md)
- Templating and scripts: [`docs/templating.md`](templating.md)
