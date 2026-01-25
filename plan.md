# CLI Shim Missing Functionality Plan

## Goals
- Translate shared shim flags into real agent-specific CLI invocations.
- Make translation configurable per target via the existing config API.
- Support interactive vs one-shot command shapes and prompt placement.
- Validate and test real argv translation, not just flag parsing.

## Status (2026-01-25)
- Baseline E2E harness + expected invocations in place; compare runs passing per agent.
- Model baselines recorded with envs: claude=opus, gemini=gemini-2.5-flash,
  copilot=gpt-5.2.
- Copilot CLI target mapping now includes `--model`.
- Optional follow-ups: record all agents in one go; document record/compare commands.

## Decisions (locked)
- `--agent` accepts any resolved target id/alias from config (not just preconfigured ids).
- If a user defines a target with the same id and **no** `inherits`, the user definition replaces the preconfigured target entirely.
- If `inherits` is present, merge with the inherited target.
- CLI help/capabilities output remains static (no config lookup).

## Non-goals
- Dynamic help output derived from config.
- Changing the shared flag surface (`--approval`, `--sandbox`, `--output`, `--model`, `--web`).

## Design Work

### 1) Data model additions
- Add a formal CLI translation model to target config types.
- New types in `src/lib/targets/config-types.ts`:
	- `InvocationMode`, `PromptSpec`, `ModeCommand`, `TargetCliDefinition`, `TranslationResult`.
	- `TargetDefinition.cli?: TargetCliDefinition`
	- `ResolvedTarget.cli?: TargetCliDefinition`
- Update `defaultAgent` in config types/validation to accept any string (resolved later).

### 2) Config validation + resolution
- Validate `cli` shapes in `src/lib/targets/config-validate.ts`.
	- Ensure `modes.interactive` and `modes.oneShot` are present when `cli` is provided.
	- Validate enum-like values for `approval`, `sandbox`, `output` maps.
	- Validate `prompt` spec (flag vs positional).
- Update target resolution in `src/lib/targets/resolve-targets.ts`:
	- If target overrides a preconfigured id and `inherits` is not set, replace the entire target definition (no merge).
	- If `inherits` is set, merge with the inherited target (including `cli`).
- Update default agent resolution (`src/lib/targets/default-agent.ts`):
	- Validate `defaultAgent` against resolved targets/aliases rather than `AGENT_IDS`.

### 3) Agent selection + config loading
- `src/cli/shim/flags.ts`:
	- Allow any string for `--agent` (store raw value, normalize for lookup).
- `src/cli/shim/resolve-invocation.ts`:
	- Load config once, resolve targets, and resolve `--agent` via id/alias.
	- Emit invalid-usage errors for unknown/disabled targets or missing `cli`.
	- Keep existing shared-flag parsing and session/requests logic.

### 4) Translation engine (core missing functionality)
- Replace the static `agent-capabilities` flow with a translation engine.
- New module `src/cli/shim/translate.ts`:
	- Input: `ResolvedInvocation` + `ResolvedTarget` + `TargetCliDefinition`.
	- Output: `{ command, args, warnings }`.
	- Steps (default translation):
		1) Select base command/args from `modes[invocation.mode]`.
		2) Apply flag mappings in fixed order: approval → sandbox → output → model → web.
		3) Emit warnings when a request maps to `null`/missing or capability absent.
		4) Inject prompt for one-shot using `prompt` spec (flag or positional).
		5) Insert passthrough args per `passthrough.position` (before prompt vs after).
	- Support `cli.translate(invocation)` hook to fully override translation.
- Update `src/cli/shim/build-args.ts` to call the translation engine and return result.
- Remove or deprecate `src/cli/shim/agent-capabilities.ts`.

### 5) Preconfigured target CLI mappings
Add `cli` to built-in targets (`src/lib/targets/builtins/*/target.ts`).
These mappings must be verified against actual agent CLIs before finalizing:
- **Codex**
	- interactive: `codex`
	- one-shot: `codex exec <prompt>` (prompt positional last)
	- approval: `--ask-for-approval on-request`, `--full-auto`, `--yolo`
	- sandbox: `--sandbox workspace-write|off`
	- output: `--json` / `--json` for stream-json if supported
	- web: `--search` on, (off: none)
	- model: `-m` or `--model` (confirm)
- **Claude Code**
	- interactive: `claude`
	- one-shot: `claude -p <prompt>`
	- output: `--output-format <text|json|stream-json>` (confirm)
	- web: unsupported (warn on `--web`)
	- approval/model: confirm supported flags
- **Gemini CLI**
	- interactive: `gemini`
	- one-shot: `gemini -p <prompt>` (or `gemini exec -p` if required)
	- output: `--output-format ...` (confirm)
	- web: supported (confirm actual flag)
	- approval/model: confirm supported flags
- **Copilot CLI**
	- interactive: `copilot`
	- one-shot: `copilot -p <prompt>`
	- approval: map `yolo` → `--allow-all-tools` (confirm), warn for others if unsupported
	- model/web/output: unsupported (warn)

## Tests
- Update existing shim tests to assert translated argv (not shim flags).
	- `tests/commands/cli-shim-*.test.ts`
- Add baseline-first E2E coverage that records real CLI outputs and compares shim stdout/stderr
  + translation trace command/args against expected invocations.
	- Baselines recorded for codex/claude/gemini/copilot; shim compare passing for all agents after output normalization.
- Add per-agent translation test cases for:
	- one-shot vs interactive command shapes
	- output json mapping
	- web on/off mapping
	- approval/sandbox mapping + warnings
	- passthrough ordering (before/after prompt)
- Add config tests for:
	- `--agent` custom ids/aliases
	- defaultAgent validation against resolved targets
	- override (full replace) vs inherits (merge) semantics
	- missing `cli` on selected target → invalid usage

## Docs
- Update README or add a short `docs/cli-shim.md` with:
	- shared flags
	- example per-agent translations
	- how to override `cli` in `omniagent.config.*`

## Implementation Sequence
1) Add CLI types + config validation for `cli`.
2) Update target resolution (replace vs inherits merge) and defaultAgent validation.
3) Update shim parsing/agent resolution to use resolved targets.
4) Implement translation engine and wire into execute/build-args.
5) Add/verify built-in `cli` mappings.
6) Update tests and docs.
