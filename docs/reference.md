# Command Reference

## Sync

```bash
npx omniagent@latest sync
npx omniagent@latest sync --only claude
npx omniagent@latest sync --skip codex
npx omniagent@latest sync --exclude-local
npx omniagent@latest sync --exclude-local=skills,commands
npx omniagent@latest sync --agentsDir ./my-custom-agents
npx omniagent@latest sync --list-local
npx omniagent@latest sync --yes
npx omniagent@latest sync --verbose
npx omniagent@latest sync --json
```

Run-level override behavior:

- `--only` replaces per-file frontmatter defaults for this run.
- `--skip` filters the active target set after `--only`.
- If both are provided, `--only` applies first and `--skip` applies second.

## Usage

```bash
npx omniagent@latest usage
npx omniagent@latest usage codex
npx omniagent@latest usage claude
npx omniagent@latest usage agy
npx omniagent@latest usage --only codex,claude
npx omniagent@latest usage --sort=reset
npx omniagent@latest usage --sort=left
npx omniagent@latest usage codex --window=weekly
npx omniagent@latest usage codex --window=5h
npx omniagent@latest usage --timeout=45
npx omniagent@latest usage --agentsDir ./my-custom-agents
npx omniagent@latest usage codex --json
npx omniagent@latest usage codex --debug
```

Command surface:

- `omniagent usage` reports usage rows for installed, active targets that support usage
  extraction.
- `omniagent usage <target>` reports one target by target id or alias.
- `omniagent usage --only <targets>` reports multiple comma-separated target ids or aliases.
- `omniagent usage --sort=reset` sorts human table rows globally by soonest reset time.
- `omniagent usage --sort=left` sorts human table rows globally by lowest percent left.
- The command accepts at most one positional target.
- `--sort` is only supported for human table output, not `--json` or `--debug`.
- Built-in usage targets are Codex, Claude, and Antigravity (`agy`; `gemini` is accepted as
  an alias). Copilot does not support
  usage extraction in v1.

Target behavior:

- With no target, omniagent checks usage-capable targets and skips agents whose usage launch
  command is not installed.
- With an explicit target, a missing required CLI is an error.
- Unknown targets and targets without usage extraction are invalid usage errors.
- Usage extraction may launch agent TUIs. omniagent uses cheap/minimal launch settings where
  possible, but an agent may still incur cost if it reads repo context or instructions on startup.
- Some CLIs gate usage inspection behind onboarding state — Antigravity requires the project to be trusted (run `agy` once and accept the trust prompt).
- omniagent does not complete auth or onboarding prompts for you.
- Usage extraction times out after 30 seconds unless the target config defines a target-specific
  timeout. Built-in TUI probes may use longer defaults. Pass `--timeout=<seconds>` to override the
  per-agent timeout for the current run, or use explicit units such as `--timeout=500ms`,
  `--timeout=5s`, or `--timeout=1m`.
- `--agentsDir <path>` reads target configuration from a non-default agents directory. Relative
  paths resolve from the project root, or from the current directory when no repository root is
  found, and must point to an existing directory.

Windows:

- `--window=<window>` filters returned rows to the requested window.
- Common windows include `hourly`, `weekly`, and aliases such as `5h`.
- Custom window strings are accepted. If no row matches the requested window, the command emits a
  note instead of failing.

Timeouts:

- `--timeout=<duration>` controls the per-agent extraction timeout.
- A bare number is interpreted as seconds, so `--timeout=5` means 5 seconds.
- `--timeout` overrides target-specific timeout defaults for that run.
- If one target times out in all-target mode, omniagent renders that target as an error row while
  still showing results from any targets that finished.

JSON and debug:

- `--json` prints a stable JSON envelope with `schemaVersion`, `generatedAt`, `targets`,
  `errors`, and `notes`.
- `--debug` implies JSON and includes extractor debug artifacts when available, such as raw TUI
  output or screen snapshots.
- Debug output may contain sensitive local agent output. Use it for troubleshooting, not routine
  logging.

Failure basics:

- Invalid usage, such as unknown targets, unsupported targets, multiple targets, an empty
  `--window`, or an invalid `--timeout`, exits with code 2.
- Missing explicit CLIs, invalid target configuration, repository discovery failures, and usage
  extraction failures, including per-target timeouts, exit with code 1.
- In all-target mode, partial extraction failures are reported alongside successful targets and
  cause exit code 1.
- If no installed active usage-capable agents are found in all-target mode, omniagent prints an
  actionable note and exits successfully.

## Shim

```bash
omniagent --agent codex
omniagent -p "Summarize the repo" --agent codex --output json
echo "Summarize the repo" | omniagent --agent codex
```

For full shim behavior, see [`docs/cli-shim.md`](cli-shim.md).
