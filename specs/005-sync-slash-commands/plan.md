# Implementation Plan: Sync Custom Slash Commands

**Branch**: `005-sync-slash-commands` | **Date**: January 11, 2026 | **Spec**: `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/005-sync-slash-commands/spec.md`
**Input**: Feature specification from `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/005-sync-slash-commands/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add a `sync-commands` CLI flow that reads canonical slash commands from
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/commands/`
in Claude Code's command definition format and ports them to Gemini CLI, Codex,
and other targets. The flow includes default local scope (project) for
Claude/Gemini, conflict handling, safe removal of previously synced commands,
and a `--yes` mode that accepts defaults. Unsupported targets (Copilot CLI)
default to skill conversion (skip by excluding the target), and Codex warns
about the lack of project-level prompts while offering options for global
prompts or skill conversion.

## Technical Context

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+
**Primary Dependencies**: yargs, Node.js fs/promises + path, Vitest, Vite, Biome
**Storage**: Filesystem (repo `agents/commands/`, project target dirs, user home dirs)
**Testing**: Vitest
**Target Platform**: Node.js 18+ CLI (macOS/Linux/Windows)
**Project Type**: Single CLI project
**Performance Goals**: Sync up to 25 commands across 4 targets in <2s (excluding prompts)
**Constraints**: No external CLI tools; non-destructive for non-managed files; explicit lossy-mapping warnings; continue after per-target failures; JSON and human output; Claude Code command format as canonical source
**Scale/Scope**: 4 initial targets, default local scope for Claude/Gemini, local filesystem-only sync

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. CLI-First Compiler Design**: PASS. The feature compiles canonical command
  definitions into target-specific formats without running agents or external
  services.
- **II. Markdown-First, Human-Readable Output**: PASS. Canonical commands follow
  Claude Code's Markdown format with optional YAML frontmatter; CLI output remains
  human-readable with JSON option; generated files include provenance comments
  where supported.
- **III. Explicit Lossy Mapping Transparency**: PASS. The plan includes warnings
  for unsupported targets and Codex project-scope limitations, plus default
  skill conversion.
- **IV. Test-Driven Validation**: PASS. Planned unit/integration coverage for
  parsing, mapping, conflict handling, deletion, and per-target outputs.
- **V. Predictable Resolution Order**: PASS. Canonical source is repo-local with
  default scopes applied consistently and documented in output.

**Post-Phase 1 Re-check**: PASS. Design artifacts include manifest-based state
tracking, explicit warnings, and contract outputs aligned with the constitution.

## Project Structure

### Documentation (this feature)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/005-sync-slash-commands/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/
├── cli/
│   ├── commands/
│   │   ├── sync.ts              # existing (skills)
│   │   └── sync-commands.ts      # new
│   └── index.ts                  # update command registration
├── lib/
│   ├── slash-commands/
│   │   ├── catalog.ts            # load/validate canonical commands
│   │   ├── targets.ts            # capability profiles and destinations
│   │   ├── sync.ts               # plan + apply sync
│   │   ├── manifest.ts           # managed command tracking
│   │   └── formatting.ts         # target-specific file rendering
│   └── sync-targets.ts           # existing
└── index.ts

/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/
└── commands/
    ├── sync.test.ts              # existing
    └── sync-commands.test.ts     # new
```

**Structure Decision**: Single CLI project. Add a new command under
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/cli/commands/`
with shared slash-command logic in `src/lib/slash-commands/`, and tests under
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/commands/`.

## Complexity Tracking

No constitution violations identified.
