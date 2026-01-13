# Quickstart: Sync Custom Slash Commands

## Prerequisites
- Create canonical commands in `agents/commands/` using Claude Code's command
  definition format (Markdown file per command, filename = command name,
  optional YAML frontmatter for description).
- Build the CLI (if running from source):

```bash
cd /Users/joeroddy/Documents/dev/projects/open-source/omniagent
npm install
npm run build
```

## Create a Command

```bash
mkdir -p /Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/commands
cat <<'CMD' > /Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/commands/plan-release.md
---
description: "Draft a release plan"
---
Summarize the release steps, owners, and timeline.
CMD
```

## Sync Commands (Interactive)

```bash
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync
```

Expected: prompts for Codex handling and conflict resolution, with default local
scope (project) for Claude/Gemini, followed by a per-target summary.

## Sync Commands with Defaults

```bash
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --yes
```

Expected: defaults are applied (project scope for Gemini/Claude, global prompts
for Codex, convert-to-skills for unsupported targets) and a summary is printed.

## Limit Targets

```bash
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --only claude,gemini
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --skip codex
```

## JSON Output

```bash
node /Users/joeroddy/Documents/dev/projects/open-source/omniagent/dist/cli.js sync --json
```
