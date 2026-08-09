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
- Some CLIs gate usage inspection behind auth or onboarding state. When Antigravity requests
  directory trust, interactive human output shows the exact directory and asks before forwarding
  approval. Declining trust stops that extraction, and authentication remains manual.
- Antigravity reports weekly Models & Quota rows for each model group.
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
- JSON, debug, and non-interactive runs never prompt for Antigravity directory trust. If trust is
  requested, they return a `trust_required` extraction error with exit code 1 so automation cannot
  grant trust implicitly.
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

## Search

```bash
npx omniagent@latest search merge conflict
npx omniagent@latest search "merge conflict"
npx omniagent@latest search merge conflict --copy
npx omniagent@latest search merge conflict --copy 3
npx omniagent@latest search merge conflict --print 2
npx omniagent@latest search merge conflict --full --no-interactive
npx omniagent@latest search --project . migration
npx omniagent@latest search --project bt-monorepo rls
npx omniagent@latest search --role assistant flaky test
npx omniagent@latest search --role agent exploration
npx omniagent@latest search --only codex --since 7d deploy
npx omniagent@latest search deploy --all-history
npx omniagent@latest search --skip codex refactor
npx omniagent@latest search --regex "TODO\(\w+\)"
npx omniagent@latest search --limit 50 --json refactor
```

Searches the conversation transcripts agent CLIs already write to disk so you can find a prompt
you wrote before and reuse it. The primary path is copying a past message to the clipboard.
Nothing is launched, nothing is written, and no network request is made — unlike `usage`, no agent
CLI needs to be installed for its past sessions to be searchable.

Large searches with no date range may receive an automatic `--since` cutoff based on transcript
file counts and sizes. The effective range is always displayed. An explicit `--since` or `--until`
bypasses adaptation; `--all-history` disables it and scans every candidate transcript, which may be
slow. This does not remove the 10,000-result safety cap. Discovery still walks filesystem metadata,
but old transcript contents are not read. No persistent index or cache is created.

### Picking a result

By default, results open in an interactive picker: a list on top, the full text of the highlighted
match below.

| Key | Action |
| --- | --- |
| `↑` / `↓`, `ctrl-p` / `ctrl-n` | Move between results |
| any character | Filter the results further, in memory, with no re-scan |
| `enter` | Copy the highlighted message to the clipboard and exit |
| `ctrl-r` | Copy that session's resume command instead |
| `esc` | Clear the filter; exit when the filter is already empty |
| `ctrl-c` | Exit without copying |

Result numbers stay fixed to the unfiltered list, so a number seen while filtering is the same
number `--copy` and `--print` accept.

### Non-interactive use

The picker is skipped automatically outside a TTY and whenever `--json`, `--copy`, or `--print` is
passed, so scripts and agents never hit a prompt. `--no-interactive` forces the plain listing.

- `--copy [n]` copies a result and prints a confirmation to stderr. With no number it copies the
  newest match. If no clipboard helper is available the text is written to stdout instead of being
  lost, and the command exits 1.
- `--print [n]` writes only that result's complete message text to stdout — no header, no excerpt,
  no resume line — so `omniagent search deploy --print | pbcopy` works and an agent gets clean
  input.
- `--full` prints every match's complete text instead of a one-line excerpt.
- `--json` carries full text in `matches[].text` with newlines preserved, so
  `omniagent search deploy --json | jq -r '.matches[0].text'` round-trips a prompt verbatim.
- Put the query before `--copy` / `--print`. `search --copy merge conflict` would otherwise consume
  a search term as the index; that case is rejected with a message naming the fix.

- Command surface: `search [query..]` with `--role`, `--project`, `--only`, `--skip`, `--since`,
  `--until`, `--all-history`, `--limit`, `--case-sensitive`, `--regex`, `--full`, `--copy`, `--print`,
  `--no-interactive`, `--agentsDir`, and `--json`.
- Query behavior: matching is case-insensitive by default. Each argument is a separate term and
  all terms must match, so `search merge conflict` also finds "conflict during the merge". Quote a
  phrase to match it exactly: `search "merge conflict"`.
- Role behavior: `--role user` (the default) returns only what you typed. `assistant` returns
  agent replies, `agent` returns subagent transcripts, and `all` spans everything. Agents declare
  which roles they record; requesting one an agent cannot produce prints a note rather than
  silently returning nothing.
- Scope behavior: every project is searched by default. `--project` accepts either a path or a
  name fragment — a value that looks like a path (`.`, `./x`, `~/x`, `/x`) is resolved and scoped
  to the repository containing it, so `--project .` means "this repository"; anything else matches
  the project path as a case-insensitive substring.
- Target behavior: `--only` and `--skip` accept comma-separated target ids or aliases and are
  mutually exclusive. Only agents that declare a `history` capability are searchable.
- Result order is newest first. `--limit` defaults to 20 and applies after ordering; pass
  `--limit 0` to use the 10,000-result safety cap.
- Each hit in the plain listing is numbered and prints a resume command, prefixed with `cd` when
  the session belongs to another directory, so it can be pasted as-is.
- Notes and warnings go to stderr in both modes, keeping stdout a clean, pipeable result list.
- Zero matches is a successful result and exits 0. Invalid flag values exit 2. An invalid agents
  directory, invalid target configuration, or an agent named in `--only` with no history to search
  exits 1. Interrupting a search exits 130.
- Transcripts can contain secrets you pasted into a session. Human output shows only a window
  around the match, but `--json` includes full message text.

## Shim

```bash
omniagent --agent codex
omniagent -p "Summarize the repo" --agent codex --output json
echo "Summarize the repo" | omniagent --agent codex
```

For full shim behavior, see [`docs/cli-shim.md`](cli-shim.md).
