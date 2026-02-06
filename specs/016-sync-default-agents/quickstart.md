# Quickstart: Sync Default Agent Generation

## Goal

Verify that `sync` defaults to available agent platforms, respects explicit target lists, and reports clear summaries.

## Steps

1. Run `sync` with no explicit target filter on a machine that has at least one supported agent CLI on `PATH`.
2. Confirm only those available targets are synced and that skipped targets include a reason in the summary.
3. Run `sync` with an explicit target list that includes a platform not on `PATH`.
4. Confirm the explicitly requested target is synced despite being unavailable by detection.
5. Run `sync` on a machine with no supported agent CLIs on `PATH`.
6. Confirm no outputs are changed, the command exits successfully, and a clear actionable message is shown.

## Expected Results

- Default `sync` only generates outputs for available platforms.
- Explicit target lists override availability detection.
- No-available-target scenarios are successful no-ops with guidance.
