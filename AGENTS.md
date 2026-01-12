# agentctrl Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-01-10

## Active Technologies
- TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js fs/promises + path (004-sync-agent-config)
- Filesystem (repo-local directories) (004-sync-agent-config)
- TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js fs/promises + path, Vitest, Vite, Biome (005-sync-slash-commands)
- Filesystem (repo `agents/commands/`, project target dirs, user home dirs) (005-sync-slash-commands)
- Filesystem (repo-local config + target directories) (006-add-custom-subagents)

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
- 006-add-custom-subagents: Added TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js fs/promises + path
- 005-sync-slash-commands: Added TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js fs/promises + path, Vitest, Vite, Biome
- 005-sync-slash-commands: Added TypeScript 5.9 (ES2022) on Node.js 18+ + yargs, Node.js fs/promises + path, Vitest, Vite, Biome




<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
