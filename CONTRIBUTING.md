# Contributing

This document is for contributors and maintainers working on the `omniagent` codebase.

If you are using `omniagent` as an npm package consumer, start with [`README.md`](README.md).

## Local Setup

- Node.js 18+
- npm

Install dependencies:

```bash
npm ci
```

## Local Validation

Run the same checks used by CI before opening a PR:

```bash
npm run check
npm run typecheck
npm test
npm run build
```

## Docs Changes

When updating docs, keep root `README.md` consumer-focused.

- End-user usage and product behavior belong in `README.md` and `docs/*.md`.
- Development and contribution workflows belong in `CONTRIBUTING.md`.
- Update docs assertions in `tests/docs/readme.test.ts` when docs architecture changes.

## CLI Shim E2E (Contributor Workflow)

CLI shim E2E is a contributor-only verification flow and is not required for normal package usage.

Detailed guide:

- [`docs/cli-shim-e2e.md`](docs/cli-shim-e2e.md)

Quick commands:

```bash
# Build first
npm run build

# Record baseline outputs from real CLIs
OA_E2E_RECORD_BASELINE=1 npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts

# Compare shim output to recorded baselines
OA_E2E=1 npm test -- tests/e2e/cli-shim/cli-shim.e2e.test.ts
```
