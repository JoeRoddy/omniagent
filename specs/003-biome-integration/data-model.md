# Data Model: Biome Integration

**Feature**: 003-biome-integration | **Date**: 2026-01-10

## Overview

This feature is a tooling integration and does not introduce traditional data entities. However, it does involve configuration structures and command execution models.

## Configuration Entities

### Biome Configuration (biome.json)

**Purpose**: Defines formatting and linting rules for the project

**Structure**:
```typescript
interface BiomeConfiguration {
  $schema: string                    // JSON schema URL for IDE support
  organizeImports: {
    enabled: boolean                 // Auto-sort and remove unused imports
  }
  formatter: {
    enabled: boolean                 // Enable formatting
    indentStyle: 'tab' | 'space'    // Indentation style
    indentWidth: number              // Indent size (spaces or tab width)
    lineWidth: number                // Max characters per line
  }
  linter: {
    enabled: boolean                 // Enable linting
    rules: {
      recommended: boolean           // Use recommended rule set
      // Additional specific rules can be configured
    }
  }
  javascript: {
    formatter: {
      quoteStyle: 'single' | 'double' // Quote style for strings
      semicolons: 'always' | 'asNeeded' // Semicolon usage
    }
  }
  files: {
    ignore: string[]                 // Glob patterns to exclude
  }
}
```

**Validation Rules**:
- `$schema` must be a valid Biome schema URL
- `indentWidth` must be positive integer
- `lineWidth` typically between 80-120 for readability
- `files.ignore` must be valid glob patterns

**State**: Static configuration file, loaded at runtime by Biome CLI

### NPM Scripts Configuration

**Purpose**: Define available Biome commands for developers

**Structure** (within package.json):
```typescript
interface PackageScripts {
  format: string           // "biome format --write ."
  "format:check": string   // "biome format ."
  lint: string            // "biome lint --write ."
  "lint:check": string    // "biome lint ."
  check: string           // "biome check ."
  "fix": string   // "biome check --write ."
  build: string           // "npm run check && vite build"
  // ... existing scripts
}
```

**Relationships**:
- `build` script depends on `check` script
- `check` encompasses both `format:check` and `lint:check` functionality
- `*:check` variants are read-only versions of their write counterparts

## Command Execution Model

### Biome Check Command

**Input**: Source file paths (glob patterns)
**Output**: List of formatting/linting issues or success status
**Exit Code**:
- 0 = No issues found
- 1 = Issues found

**Execution Flow**:
1. Biome loads configuration from `biome.json`
2. Resolves file patterns against `files.ignore`
3. Parses each TypeScript file
4. Applies formatting rules → generates diff
5. Applies linting rules → generates diagnostics
6. Outputs results to stdout/stderr
7. Returns exit code

### Biome Format/Lint with Write

**Input**: Source file paths + `--write` flag
**Output**: Modified files + summary of changes
**Side Effects**: Modifies files in place

**Execution Flow**:
1-5. Same as check command
6. Writes formatted/fixed content back to files
7. Outputs summary of changes
8. Returns exit code

## Integration Points

### Build Script Integration

**Dependency Graph**:
```
npm run build
  ├── npm run check (new)
  │     └── biome check .
  │           ├── Reads biome.json
  │           ├── Scans src/**/*.ts
  │           ├── Scans tests/**/*.ts
  │           └── Returns exit code
  └── vite build (existing)
        └── TypeScript compilation
```

**Failure Handling**:
- If `biome check` exits with code 1, build stops immediately
- Error messages from Biome are displayed to developer
- Developer must fix issues or run `npm run format` before build succeeds

### Developer Workflow

**State Transitions**:
```
Code Written (unformatted)
  ├──> npm run format ──> Code Formatted (auto-fixed)
  │                          └──> npm run build ──> Build Success
  └──> npm run build ──> Build Failure (quality issues)
                            └──> npm run fix ──> Build Success
```

## File System Structure

**Modified Files**:
- `/biome.json` (new) - Configuration file
- `/package.json` (modified) - Updated scripts and devDependencies

**Generated Files**:
- None (Biome operates on existing source files in place)

**Ignored Paths** (configured in biome.json):
- `node_modules/`
- `dist/`
- `coverage/`
- `.specify/`
- `*.lock` files

## Testing Data Model

**Test Scenarios**:
1. **Valid formatted code** → Biome check passes
2. **Unformatted code** → Biome check fails with formatting errors
3. **Linting violations** → Biome check fails with linting errors
4. **Auto-fix application** → Files modified with correct formatting

**Test Artifacts**:
- Fixture files with intentional quality issues
- Expected output assertions
- Exit code validations

## Configuration Precedence

Biome follows standard configuration precedence:
1. Command-line flags (highest priority)
2. `biome.json` in project root
3. Built-in defaults (lowest priority)

For this integration, we rely on `biome.json` with no CLI flag overrides to ensure consistency.

## Summary

While this feature doesn't introduce traditional data entities, it establishes:
- **Configuration model** for formatting/linting rules
- **Command execution model** for build integration
- **File system relationships** between source code and quality checks
- **State transitions** in the developer workflow

The data model is primarily configuration-driven with deterministic transformation (source code → formatted/linted code) based on the rules in `biome.json`.
