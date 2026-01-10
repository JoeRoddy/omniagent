# Quickstart: Vitest CLI Testing

**Feature**: 002-vitest-cli-testing
**Date**: 2026-01-10

## Prerequisites

- Node.js 18+
- npm

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the CLI:
   ```bash
   npm run build
   ```

## Running Tests

Run all tests:
```bash
npm test
```

Run tests in watch mode (during development):
```bash
npm run test:watch
```

Run tests with coverage:
```bash
npm run test:coverage
```

## Example Commands

After building, test the example commands:

```bash
# Simple greeting
npx agentctl hello
# Output: Hello, World!

# Personalized greeting
npx agentctl greet Alice
# Output: Hello, Alice!

# Uppercase greeting
npx agentctl greet Bob --uppercase
# Output: HELLO, BOB!

# Echo with options
npx agentctl echo "test" --times 3 --prefix "> "
# Output:
# > test
# > test
# > test
```

## Adding a New Command

1. Create command file in `src/cli/commands/`:
   ```typescript
   // src/cli/commands/mycommand.ts
   import type { CommandModule } from 'yargs'

   export const myCommand: CommandModule = {
     command: 'mycommand <arg>',
     describe: 'Description of my command',
     builder: (yargs) => yargs.positional('arg', { type: 'string' }),
     handler: (argv) => {
       console.log(`Received: ${argv.arg}`)
     }
   }
   ```

2. Register in CLI entry (`src/cli/index.ts`):
   ```typescript
   import { myCommand } from './commands/mycommand.js'

   // In yargs chain:
   .command(myCommand)
   ```

3. Create test file in `tests/commands/`:
   ```typescript
   // tests/commands/mycommand.test.ts
   import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
   import { runCli } from '../../src/cli/index.js'

   describe('mycommand', () => {
     let consoleSpy: ReturnType<typeof vi.spyOn>

     beforeEach(() => {
       consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
     })

     afterEach(() => {
       consoleSpy.mockRestore()
     })

     it('should process argument', async () => {
       await runCli(['node', 'agentctl', 'mycommand', 'test-value'])
       expect(consoleSpy).toHaveBeenCalledWith('Received: test-value')
     })
   })
   ```

4. Run tests to verify:
   ```bash
   npm test
   ```

## Project Structure

```
agentctl/
├── src/
│   ├── index.ts
│   └── cli/
│       ├── index.ts
│       └── commands/
│           ├── hello.ts
│           ├── greet.ts
│           └── echo.ts
├── tests/
│   └── commands/
│       ├── hello.test.ts
│       ├── greet.test.ts
│       └── echo.test.ts
├── vitest.config.ts
└── package.json
```

## Troubleshooting

**Tests fail with "Cannot find module"**: Ensure you've run `npm run build` first if tests import from `dist/`.

**Console output not captured**: Make sure you're mocking `console.log` in `beforeEach` and restoring in `afterEach`.

**Yargs exits on --help**: Mock `process.exit` to prevent test runner from exiting:
```typescript
vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
```
