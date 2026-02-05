# omniagent Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-01-10

## Active Technologies
- TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js fs/promises + path (004-sync-agent-config)
- Filesystem (repo-local directories) (004-sync-agent-config)
- TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js fs/promises + path, Vitest, Vite, Biome (005-sync-slash-commands)
- Filesystem (repo `agents/commands/`, project target dirs, user home dirs) (005-sync-slash-commands)
- Filesystem (repo-local config + target directories) (006-add-custom-subagents)
- TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js `fs/promises`, `path`, Vitest, Vite, Biome (007-agent-templating)
- Filesystem (repo-local config + target directories + user home config) (007-agent-templating)
- Filesystem (repo-local agents/ directories and user home state under `~/.omniagent/state/`) (009-local-config-sync)
- Filesystem (repo-local sources/outputs + user home state under `~/.omniagent/state/`) (010-instruction-file-sync)
- Filesystem (repo-local `agents/` directory or user-supplied agents directory) (012-agents-dir-override)
- TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, @typescript/native-preview (tsgo), Vitest, Vite, Biome (013-fix-typecheck-ci)
- Filesystem (repo-local config and user home state) (013-fix-typecheck-ci)
- TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js `fs/promises` + `path`, Vite, Vitest, Biome (014-add-custom-targets)
- Filesystem (repo-local directories and user home state under `~/.omniagent/state/`) (014-add-custom-targets)
- TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js `fs/promises` + `path`, `jiti`, Vite, Vitest, Biome, @typescript/native-preview (tsgo) (015-cli-shim-flags)
- Filesystem (repo-local agents directory and user home state under `~/.omniagent/state/`) (015-cli-shim-flags)

- TypeScript 5.x, ES2022 target + yargs (CLI parsing), Vitest (testing), Vite (build), Biome (formatting/linting) (003-biome-integration)

- TypeScript 5.x, ES2022 target + yargs (CLI parsing), Vitest (testing) (002-vitest-cli-testing)

- TypeScript 5.x, Node.js 18+ + yargs (CLI parsing only) (001-cli-foundation)

## Project Structure

```text
src/
tests/
```

## Commands

npm run check && npm test

## Code Style

TypeScript 5.x, Node.js 18+: Enforced by Biome (formatting and linting)
- Line width: 100 characters
- Indentation: Tabs (2-space width)
- Quotes: Double quotes
- Semicolons: Always
- Run `npm run format` before committing

## Recent Changes
- 015-cli-shim-flags: Added TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js `fs/promises` + `path`, `jiti`, Vite, Vitest, Biome, @typescript/native-preview (tsgo)
- 014-add-custom-targets: Added TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js `fs/promises` + `path`, Vite, Vitest, Biome




<!-- MANUAL ADDITIONS START -->
  (skills, subagents, slash commands) and must be supported by future syncable features.
  tool-specific directories so we don't publish junk.
  CLI shim E2E docs: docs/cli-shim-e2e.md
<!-- MANUAL ADDITIONS END -->
