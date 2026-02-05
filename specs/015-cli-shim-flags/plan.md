# Implementation Plan: CLI Shim Surface

**Branch**: `015-cli-shim-flags` | **Date**: 2026-01-23 | **Spec**:
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/015-cli-shim-flags/spec.md
**Input**: Feature specification from
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/015-cli-shim-flags/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Define the omniagent CLI shim flag surface for interactive and one-shot execution, including
approval policy, sandbox defaults, output formats, model selection, web search permission, and
agent passthrough. Parse flags consistently across modes, resolve the agent from `--agent` or
`omniagent.config.*`, translate shim flags to agent CLI args via a capability matrix, warn on
unsupported flags (no-op), enforce invalid-usage errors, and pass through agent output unmodified.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js `fs/promises` + `path`, `jiti`, Vite, Vitest, Biome, @typescript/native-preview (tsgo)  
**Storage**: Filesystem (repo-local agents directory and user home state under `~/.omniagent/state/`)  
**Testing**: Vitest (`npm test`) + Biome check (`npm run check`)  
**Target Platform**: Node.js CLI (macOS/Linux/Windows), ES modules  
**Project Type**: Single project (`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src`, `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests`)  
**Performance Goals**: Interactive start <2s (SC-001); CLI parsing + config resolution <200ms for
standard repos  
**Constraints**: CLI-first adapter; deterministic flag resolution; no silent passthrough; output
passed through unmodified; unsupported shared flags warn + no-op via capability matrix; exit
codes mapped to spec; <100MB memory  
**Scale/Scope**: Local CLI invocations with tens of flags and small config files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- CLI-first compiler design: PASS (shim only translates flags and delegates to external agent
  CLIs; omniagent still does not host or orchestrate models).
- Markdown-first, human-readable output: PASS (canonical sources remain Markdown; CLI output can be
  text or JSON without proprietary formats).
- Explicit lossy mapping transparency: PASS (invalid shim flags/values fail validation; agent-
  unsupported shared flags warn + no-op; passthrough is explicit via `--`).
- Test-driven validation: PASS (plan adds CLI parsing + exit code + passthrough tests).
- Predictable resolution order: PASS (agent resolution documented: `--agent` flag, then
  `omniagent.config.*` default).
- Performance standards: PASS (single config lookup; no repo scans beyond agents dir).

Post-Phase-1 Check: PASS (no new violations introduced in design artifacts).

## Project Structure

### Documentation (this feature)

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/015-cli-shim-flags/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src/
├── cli/
│   ├── commands/
│   ├── shim/
│   │   ├── agent-capabilities.ts
│   │   ├── build-args.ts
│   │   ├── errors.ts
│   │   ├── execute.ts
│   │   ├── flags.ts
│   │   ├── index.ts
│   │   ├── resolve-invocation.ts
│   │   └── types.ts
│   └── index.ts
├── lib/
│   ├── agents-dir.ts
│   ├── repo-root.ts
│   ├── supported-targets.ts
│   └── targets/
│       ├── config-loader.ts
│       └── config-types.ts
└── index.ts

/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests/
├── commands/
├── docs/
├── lib/
└── subagents/
```

**Structure Decision**: Single project layout using `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src`
and `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
