# Research: Vitest CLI Testing

**Feature**: 002-vitest-cli-testing
**Date**: 2026-01-10

## Vitest Configuration

### Decision: Use standard Node.js Vitest configuration

**Rationale**: Vitest provides native TypeScript and ES module support. The `environment: 'node'` setting is optimal for CLI testing.

**Alternatives considered**:
- Jest: Requires additional TypeScript/ESM configuration; Vitest is simpler for modern TS projects
- Node.js native test runner: Less mature ecosystem, fewer assertion utilities

### Recommended Configuration (`vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
  }
})
```

## CLI Testing Approach

### Decision: Unit test via direct yargs invocation

**Rationale**: The existing `runCli(argv)` function already accepts custom argv, making unit testing straightforward. No need to spawn processes for basic command testing.

**Alternatives considered**:
- Process spawning with execa: Higher overhead, slower tests; useful for integration tests but overkill for unit tests
- Subprocess with child_process: More verbose, less ergonomic than direct invocation

### Testing Pattern

```typescript
import { runCli } from '../../src/cli/index.js'

// Mock console.log to capture output
const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

// Invoke CLI with simulated args
await runCli(['node', 'agentctl', 'hello'])

// Assert output
expect(consoleSpy).toHaveBeenCalledWith('Hello, World!')
```

## Command Structure Pattern

### Decision: Separate command modules with yargs `.command()` API

**Rationale**: Yargs supports modular command definitions. Each command in its own file improves testability and organization.

**Alternatives considered**:
- Single file with all commands: Less maintainable as CLI grows
- Commander.js: Different API paradigm; yargs already in use

### Example Structure

```typescript
// src/cli/commands/hello.ts
import type { CommandModule } from 'yargs'

export const helloCommand: CommandModule = {
  command: 'hello',
  describe: 'Print a greeting',
  handler: () => console.log('Hello, World!')
}
```

## Dependencies

### Decision: Add vitest as dev dependency

| Package | Version | Purpose |
|---------|---------|---------|
| vitest | ^2.1.0 | Test framework |
| @vitest/coverage-v8 | ^2.1.0 | Coverage reporting (optional) |

**Rationale**: Vitest integrates seamlessly with Vite (already in use for build). Native TypeScript support without additional babel/ts-jest config.

## Test File Structure

### Decision: Mirror source structure in tests/

```
tests/
└── commands/
    ├── hello.test.ts
    ├── greet.test.ts
    └── echo.test.ts
```

**Rationale**: Clear 1:1 mapping between source and test files. Easy to find tests for any given command.

## Error Handling Testing

### Decision: Test exit codes and stderr output

**Pattern**:
```typescript
// Spy on process.exit for error cases
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

await runCli(['node', 'agentctl', 'greet']) // Missing required arg

expect(exitSpy).toHaveBeenCalledWith(1)
```

**Rationale**: CLI tools should exit with non-zero codes on errors. Tests verify this contract.

## Summary of Decisions

| Topic | Decision | Key Reason |
|-------|----------|------------|
| Test Framework | Vitest | Native TS/ESM, Vite integration |
| Testing Approach | Direct yargs invocation | Existing `runCli(argv)` supports it |
| Command Structure | Modular CommandModule exports | Testability, maintainability |
| Test Organization | Mirror source in tests/ | Clear mapping |
| Error Testing | Mock process.exit, check stderr | Verify CLI contracts |
