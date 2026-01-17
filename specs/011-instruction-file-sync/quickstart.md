# Quickstart: Instruction File Sync

**Date**: 2026-01-17

## 1) Add instruction sources

### Option A: Repo `AGENTS.md` (default)

Place `AGENTS.md` files anywhere outside `/agents`. These act as plain-text sources. Targets are
generated next to the source file.

Example:

```text
repo/
├── docs/
│   └── AGENTS.md
└── src/
    └── AGENTS.md
```

### Option B: `/agents/**` templates (advanced)

Use templated sources under `/agents`. The `*.AGENTS.md` prefix is recommended for searchability,
but non-prefixed `AGENTS.md` files are still supported. For templates outside `agents/AGENTS.md`,
`outPutPath` is required.

Example template:

```text
/agents/guide.AGENTS.md
---
outPutPath: docs/
---
<agents include="claude,gemini">
# Team Instructions
</agents>
```

## 2) Run sync

Run the sync command with your desired targets. Targets include Claude, Gemini, Codex, and Copilot.
Use `--only` or `--skip` to filter instruction outputs, and `--exclude-local` to ignore local
sources.

Example:

```bash
omniagent sync --targets claude,gemini
```

## 3) Review outputs and summaries

- Outputs are generated next to repo sources or under the template `outPutPath` directory.
- When both Codex and Copilot are selected, a single `AGENTS.md` is written and counted once.
- Summaries include instruction source and output counts.

## 4) Safe cleanup

If sources are removed, tracked outputs are deleted only when they still match the last generated
hash. Diverged outputs are retained with warnings in non-interactive mode.
