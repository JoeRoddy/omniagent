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

## Quick start

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

## CLI shim (interactive + one-shot)

`omniagent` without a subcommand acts as a shim to agent CLIs. Select an agent explicitly with
`--agent` or set a `defaultAgent` in `agents/omniagent.config.*`.

```bash
# Interactive (default)
omniagent --agent codex

# One-shot prompt
omniagent -p "Summarize the repo" --agent codex --output json

# Piped stdin
echo "Summarize the repo" | omniagent --agent codex

# Passthrough to agent CLI
omniagent --agent codex -- --some-agent-flag --model gpt-5
```

Shared flags:

- `--approval <prompt|auto-edit|yolo>` (aliases: `--auto-edit`, `--yolo`)
- `--sandbox <workspace-write|off>` (defaults to `off` when `--yolo` is set and `--sandbox` is
  not explicit)
- `--output <text|json|stream-json>` (aliases: `--json`, `--stream-json`)
- `--model <name>`
- `--web <on|off|true|false|1|0>` (bare `--web` enables)

Notes:

- `--` passthrough is only valid after `--agent`.
- Unsupported shared flags emit a warning and are ignored.
- Agent output is passed through unmodified for all output formats.
- Some approval values are agent-specific (for example, Claude ignores `--approval auto-edit`
  and warns).
- Output formats are only supported in one-shot mode for agents that expose them; interactive runs
  warn when explicitly set.

### Shared-flag capability matrix

| Agent   | Approval | Sandbox | Output | Model | Web |
|---------|----------|---------|--------|-------|-----|
| codex   | ✓        | ✓       | ✓      | ✓     | ✓   |
| claude  | ✓        | ✗       | ✓      | ✓     | ✗   |
| gemini  | ✓        | ✓       | ✓      | ✓     | ✓   |
| copilot | ✓        | ✗       | ✗      | ✓     | ✗   |

## What you can sync

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

Default agents directory is `agents/`. Override it with `--agentsDir` (relative to the project
root, or an absolute path).

## Use cases

- **Keep a team-wide review assistant consistent** while each person uses their preferred tool.
- **Ship one release-helper subagent** that works everywhere.
- **Avoid tool wars** by supporting Claude, Codex, Gemini, and Copilot from one source of truth.
- **Layer personal tweaks** without polluting the repo using `.local` overrides.

## Requirements

- Node.js 18+

## Local validation

Run the same steps as CI:

1. `npm ci`
2. `npm run check`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

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

### Custom targets (omniagent.config.*)

Define custom targets in the agents directory. The CLI auto-discovers the first match in:
`omniagent.config.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs`.

```ts
const config = {
	targets: [
		{
			id: "acme",
			displayName: "Acme Agent",
			outputs: {
				skills: "{repoRoot}/.acme/skills/{itemName}",
				subagents: "{repoRoot}/.acme/agents/{itemName}.md",
				commands: {
					projectPath: "{repoRoot}/.acme/commands/{itemName}.md",
					userPath: "{homeDir}/.acme/commands/{itemName}.md",
				},
				instructions: "AGENTS.md",
			},
		},
	],
	disableTargets: ["copilot"],
};

export default config;
```

- Built-in IDs require `override: true` or `inherits: "claude"` to avoid collisions.
- `disableTargets` removes built-ins from the active target set.
- Placeholders: `{repoRoot}`, `{homeDir}`, `{agentsDir}`, `{targetId}`, `{itemName}`,
  `{commandLocation}`.
- When multiple targets resolve to the same output file, default writers handle
  skills/subagents/instructions. Command collisions are errors.

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
npx omniagent@latest sync --agentsDir ./my-custom-agents
npx omniagent@latest sync --list-local
npx omniagent@latest sync --yes
npx omniagent@latest sync --json
```

Run-level overrides:

- `--only` replaces per-file frontmatter defaults for this run.
- `--skip` filters the active target set (frontmatter defaults or all targets).
- `--exclude-local` omits local sources entirely (or only for the listed categories).
- `--list-local` prints detected local items and exits.
- `--agentsDir` points to the agents directory (default `agents/`, resolved from the repo root).
- If both are provided, `--only` applies first, then `--skip`.
