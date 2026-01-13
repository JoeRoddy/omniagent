# Research: CLI Foundation

**Date**: 2026-01-10
**Feature**: 001-cli-foundation

## Vite for Node.js CLI Bundling

**Decision**: Use Vite in library mode with `ssr: true` for Node.js target.

**Rationale**:
- Vite's library mode supports Node.js targets via `build.ssr` option
- Fast development with HMR during development
- Tree-shaking removes unused code
- Native TypeScript support without separate tsc step

**Alternatives considered**:
- **esbuild directly**: Faster but less ecosystem integration; Vite uses esbuild under the hood anyway
- **tsup**: Good CLI bundler but adds another tool; Vite already handles this
- **tsc + manual bundling**: More setup, slower builds

**Configuration approach**:
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    ssr: true,
    lib: {
      entry: 'src/cli/index.ts',
      formats: ['es'],
      fileName: 'cli'
    },
    rollupOptions: {
      external: ['yargs', 'yargs/helpers']
    }
  }
})
```

## yargs Setup for TypeScript

**Decision**: Use yargs with `@types/yargs` for type-safe CLI parsing.

**Rationale**:
- yargs is the most popular Node.js CLI framework
- Excellent TypeScript support via DefinitelyTyped
- Built-in `--help` and `--version` support
- Minimal API surface for hello world

**Pattern**:
```typescript
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

yargs(hideBin(process.argv))
  .scriptName('omniagent')
  .version()
  .help()
  .command('$0', 'omniagent CLI', () => {}, () => {
    console.log('Hello from omniagent!')
  })
  .parse()
```

## Package.json bin Configuration

**Decision**: Use `bin` field pointing to built output with shebang.

**Rationale**:
- Standard npm pattern for CLI distribution
- Allows `npx omniagent` and global install

**Configuration**:
```json
{
  "name": "omniagent",
  "bin": {
    "omniagent": "./dist/cli.js"
  },
  "type": "module"
}
```

## Shebang Handling

**Decision**: Use Vite plugin or manual prepend for Node.js shebang.

**Rationale**:
- CLI executables need `#!/usr/bin/env node` at top
- Vite doesn't add this by default

**Options**:
1. `vite-plugin-banner` - adds banner to output
2. Post-build script to prepend shebang
3. Use rollup `banner` option in Vite config

**Selected**: Rollup `banner` option (simplest, no extra dependency)

## Dev Dependencies

**Decision**: Minimal dev dependencies for build toolchain.

| Package | Purpose |
|---------|---------|
| typescript | Type checking |
| vite | Bundling |
| vitest | Testing (optional for foundation) |
| @types/yargs | yargs TypeScript types |
| @types/node | Node.js TypeScript types |

## Runtime Dependencies

**Decision**: yargs only.

| Package | Purpose |
|---------|---------|
| yargs | CLI argument parsing |

This satisfies SC-003: "Total runtime dependencies limited to yargs only."
