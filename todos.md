# CLI Shim E2E TODOs

## Current
- [x] Add --trace-translate flag and emit translation JSON line
- [x] Build shared E2E harness + cases under tests/e2e/cli-shim
- [x] Add per-agent E2E configs colocated with built-in targets
- [x] Add explicit --auto-edit alias case
- [x] Add explicit --output flag case
- [x] Fix sandbox case to use workspace-write
- [x] Bump E2E per-test timeout to match spawn timeout
- [x] Add explicit expected invocations per case/agent
- [x] Add baseline record mode for real CLIs
- [x] Compare shim output + trace vs baselines, with warning stripping

## Next
- [x] Verify expected invocations vs CLI docs for codex/claude/gemini/copilot
- [x] Run `npm run build` before recording baselines
- [x] Record a single agent baseline (real CLI): OA_E2E_RECORD_BASELINE=1 OA_E2E_AGENT=codex OA_E2E_CODEX_MODEL=... npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts
- [x] Record baselines for codex/claude/gemini/copilot (real CLI)
- [x] Normalize codex/claude/gemini output comparison for nondeterministic stdout/stderr
- [x] Bump gemini E2E timeout to accommodate slow runs
- [x] Capture model values for model test cases (OA_E2E_CLAUDE_MODEL=opus,
  OA_E2E_GEMINI_MODEL=gemini-2.5-flash, OA_E2E_COPILOT_MODEL=gpt-5.2)
- [x] Verify passthrough flags per agent (update agent.config.ts if needed)
- [x] Compare shim to baselines: OA_E2E=1 OA_E2E_AGENT=codex OA_E2E_CODEX_MODEL=... npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts
- [x] Compare shim to baselines for claude/gemini/copilot
- [ ] (Optional) Record all agents baselines in one go (real CLI): OA_E2E_RECORD_BASELINE=1 npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts
- [ ] Document E2E run/record instructions (optional)

## Scratchpad: Baseline Plan

Goal: treat the real CLIs as the ground truth. Record their stdout/stderr first, then verify the
shim produces identical output *and* invokes the expected command/args.

1) Define ground-truth invocations (independent of the shim).
   - Create `tests/e2e/cli-shim/expected-invocations.ts`.
   - For each `SHARED_CASES` entry, map each agent to an explicit `{ command, args, warnings? }`.
   - Base the mapping on `research/cli-surfaces/*` and confirmed CLI docs (not on the shim).
   - Include which cases are unsupported per agent and the expected warning strings (if any).

2) Add a baseline recording mode that runs the *real* CLIs directly.
   - Add an env flag (ex: `OA_E2E_RECORD_BASELINE=1` or `OA_E2E_RECORD=baseline`).
   - When baseline recording is enabled:
     - Skip the shim entirely.
     - Use the expected invocations from step 1.
     - Run `command` + `args` via `spawnSync`.
     - Capture stdout + stderr and require `exitCode === 0`.
     - Write files to the agent `expectedDir`:
       - `<case>.stdout.txt`
       - `<case>.stderr.txt`
       - `<case>.trace.json` (store the expected invocation object)

3) Update the normal E2E run to compare shim output to baselines.
   - Keep running `node dist/cli.js ...` with `--trace-translate`.
   - Parse `OA_TRANSLATION=...` from stderr.
   - Remove shim warnings from stderr before comparison:
     - Either strip lines that exactly match `trace.warnings`,
       or collect warnings separately and compare to expected warnings from step 1.
   - Compare:
     - Shim stdout == baseline stdout.
     - Shim stderr (minus trace + warnings) == baseline stderr.
     - Shim translation trace command/args == expected invocation command/args.
     - Shim warnings == expected warnings (if specified).

4) Keep test selection/skip logic consistent.
   - Reuse `SHARED_CASES` and agent filtering (`OA_E2E_AGENT`).
   - Skip a case if there is no expected invocation mapping for that agent.
   - Honor existing `requiredEnv` and `cliCommand` checks for both baseline and shim runs.

5) Make outputs deterministic where possible.
   - For both baseline and shim runs, set:
     - `NO_COLOR=1`
     - `TERM=dumb`
     - any agent-specific env from `agent.config.ts`.
   - Keep prompt inputs tiny (`"marco"`).

6) Update docs / todos.
   - Add “baseline record” and “shim compare” commands to `todos.md`.
   - Optional: brief instructions in README or a short note in tests.

Command flow:
- Build: `npm run build`
- Record baselines: `OA_E2E_RECORD_BASELINE=1 OA_E2E_AGENT=codex OA_E2E_CODEX_MODEL=... npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts`
- Compare shim to baselines: `OA_E2E=1 OA_E2E_AGENT=codex OA_E2E_CODEX_MODEL=... npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts`
