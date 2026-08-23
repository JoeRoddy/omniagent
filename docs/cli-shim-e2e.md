# CLI Shim E2E (Baseline-First)

This is a contributor/maintainer workflow. For overall development guidance, start with
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

This suite treats the real agent CLIs as the ground truth. It records their stdout/stderr first,
then verifies the shim produces identical output and invokes the expected command/args.

## What it covers
- Shared shim flags are translated into agent-specific argv
  (approval/sandbox/output/model/web/effort).
- One-shot vs interactive command shapes and prompt placement.
- Passthrough ordering relative to the prompt.
- Translation trace matches the expected invocation for each case.

## Key files
- Expected invocations: `tests/e2e/cli-shim/expected-invocations.ts`
- Shared cases: `tests/e2e/cli-shim/cases.ts`
- Harness: `tests/e2e/cli-shim/cli-shim.e2e.test.ts`
- Agent configs (env + binary checks): `src/lib/targets/builtins/*/e2e/agent.config.ts`
- Baseline outputs: `src/lib/targets/builtins/*/e2e/expected/`

## How it works
1) **Baseline record mode** runs the real CLI directly using expected invocations.
2) **Compare mode** runs the shim with `--trace-translate` and compares:
   - shim stdout vs baseline stdout
   - shim stderr (minus trace + warnings) vs baseline stderr
   - shim translation trace command/args vs expected invocation
   - warnings (if specified) vs expected warnings

The trace is emitted as a single stderr line:
`OA_TRANSLATION={...}`.

## Adding a case
A case is baseline-backed by default: compare mode reads its recorded stdout/stderr and **fails**
when those artifacts are missing, so a deleted or unrecorded baseline can never quietly disable
coverage. Record the artifacts with `OA_E2E_RECORD_BASELINE=1` before the case lands.

When a baseline genuinely cannot be recorded, declare an `assertion` mode on the case instead —
the exemption then lives in `cases.ts` where it is reviewable, not in the runner:

- `assertion: "structured"` parses the run's stdout payload and asserts the translated argv.
  Used by `output-schema-inline`, whose temp paths and model output are nondeterministic.
- `assertion: "trace"` asserts only the translated argv and warnings. Used by `effort-high`,
  because the committed codex baselines pin a model this repo can no longer record against.

Set `omitPassthroughDefaults: true` on a case that drives a shared flag an agent config also pins
through `passthroughDefaults` (codex pins reasoning effort that way), otherwise the shim rejects
the run as a passthrough/shared-flag conflict.

## Prereqs
- Build before running E2E: `npm run build`
- Install the target CLIs (codex/claude/agy/copilot)
- Set required env for each CLI per `agent.config.ts` (auth, model, etc.)

## Environment flags
- `OA_E2E=1` enables compare mode.
- `OA_E2E_RECORD_BASELINE=1` enables baseline record mode.
  - Also accepts `OA_E2E_RECORD=baseline` or `OA_E2E_RECORD=1`.
- `OA_E2E_AGENT=codex|claude|agy|copilot` filters agents (comma-separated allowed).
- Model envs:
  - `OA_E2E_CODEX_MODEL`
  - `OA_E2E_CLAUDE_MODEL`
  - `OA_E2E_AGY_MODEL`
  - `OA_E2E_COPILOT_MODEL`

## Commands
Record baselines (real CLI):
```bash
npm run build
OA_E2E_RECORD_BASELINE=1 OA_E2E_AGENT=codex OA_E2E_CODEX_MODEL=gpt-5.1-codex-mini \
  npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts
```

Compare shim vs baselines:
```bash
OA_E2E=1 OA_E2E_AGENT=codex OA_E2E_CODEX_MODEL=gpt-5.1-codex-mini \
  npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts
```

All agents (record or compare):
```bash
OA_E2E_RECORD_BASELINE=1 npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts
OA_E2E=1 npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts
```

## When to re-record baselines
- If a target CLI updates its output format or version banner.
- If the expected invocation mapping changes.

## Adding a new case
1) Add to `tests/e2e/cli-shim/cases.ts`.
2) Define expected invocations in `tests/e2e/cli-shim/expected-invocations.ts`.
3) Record baselines for each affected agent.
