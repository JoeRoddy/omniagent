# Implementation Plan: Custom Agent Targets

**Branch**: `014-custom-agent-targets` | **Date**: 2026-01-21 | **Spec**:
/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/014-custom-agent-targets/spec.md
**Input**: Feature specification from
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/014-custom-agent-targets/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add omniagent.config.* discovery in the agents directory to define custom targets, override or
disable built-ins, and merge all targets at runtime with strict validation for collisions,
placeholders, and conversions. Migrate built-in targets to the same schema, export default
writers for collision resolution, and keep sync behavior backward compatible when no config
exists.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9 (ES2022) on Node.js 18+  
**Primary Dependencies**: yargs, Node.js `fs/promises` + `path`, Vite, Vitest, Biome  
**Storage**: Filesystem (repo-local directories and user home state under `~/.omniagent/state/`)  
**Testing**: Vitest (`npm test`) + Biome check (`npm run check`)  
**Target Platform**: Node.js CLI (macOS/Linux/Windows), ES modules  
**Project Type**: Single project (`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/src`,
`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/tests`)  
**Performance Goals**: Validate <500ms, compile/sync <2s for typical repos  
**Constraints**: CLI-first compiler; deterministic resolution; fail-fast validation with no outputs;
<100MB memory  
**Scale/Scope**: Local repos with tens to hundreds of agent items; single-process sync

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- CLI-first compiler design: PASS (config only influences compilation/sync outputs).
- Markdown-first, human-readable output: PASS (canonical sources remain Markdown; config is optional
  TS/JS and outputs remain markdown/provenanced).
- Explicit lossy mapping transparency: PASS (conversion errors are surfaced; unsupported features
  are explicit per target).
- Test-driven validation: PASS (plan adds schema/merge/collision/convert tests).
- Predictable resolution order: PASS (deterministic agentsDir discovery + built-in merge; extension
  precedence documented).
- Performance standards: PASS (single config load; reuse catalogs; no extra scans).

Post-Phase-1 Check: PASS (no new violations introduced in design artifacts).

## Project Structure

### Documentation (this feature)

```text
 /Users/joeroddy/Documents/dev/projects/open-source/omniagent/specs/014-custom-agent-targets/
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
│   └── index.ts
├── lib/
│   ├── agents-dir.ts
│   ├── instructions/
│   ├── slash-commands/
│   ├── skills/
│   ├── subagents/
│   ├── sync-targets.ts
│   └── supported-targets.ts
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
