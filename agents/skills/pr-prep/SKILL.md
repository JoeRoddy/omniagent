---
name: pr-prep
description: Run PR preparation checks in strict order (fix, test, build) and resolve failures before moving on. Use when asked to prep a repo for PR submission or to verify it passes autofix, tests, and build sequentially.
---

# Pr Prep

## Workflow

1. Run `npm run fix` and wait for completion.
2. If it fails, investigate and fix the root cause, then re-run `npm run fix` until it succeeds.
3. Run `npm test` and wait for completion.
4. If it fails, fix the issue(s), then re-run `npm test` until it succeeds.
5. Run `npm run build` and wait for completion.
6. If it fails, fix the issue(s), then re-run `npm run build` until it succeeds.

## Rules

- Keep the order strict: fix → test → build.
- Do not start the next step until the current step passes.
- Re-run the same step after fixing; do not skip ahead.
- Stop only when all three commands pass in order.
