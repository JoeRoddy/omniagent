# Contract: NPM Scripts

**Feature**: 003-biome-integration | **Date**: 2026-01-10

## Overview

This contract defines the npm script interface for Biome integration, specifying command signatures, behavior, and expected outcomes.

---

## npm run format

**Purpose**: Automatically format all source files

**Command**: `biome format --write .`

**Input**:
- All TypeScript files in `src/` and `tests/` directories
- Excludes patterns defined in `biome.json` `files.ignore`

**Output** (stdout):
```
Formatted N files in Xms
```

**Exit Codes**:
- `0`: Files formatted successfully
- `1`: Error occurred (e.g., parse error, invalid config)

**Side Effects**:
- Modifies files in place to apply formatting rules
- No Git staging changes (user must manually stage)

**Example Usage**:
```bash
npm run format
```

---

## npm run format:check

**Purpose**: Check formatting without modifying files

**Command**: `biome format .`

**Input**:
- Same as `npm run format`

**Output** (stdout):
```
# If issues found:
File path/to/file.ts needs formatting

# If no issues:
All files are formatted correctly
```

**Exit Codes**:
- `0`: All files properly formatted
- `1`: One or more files need formatting

**Side Effects**:
- None (read-only operation)

**Example Usage**:
```bash
npm run format:check
```

**Use Case**: CI/CD pipelines, pre-commit validation

---

## npm run lint

**Purpose**: Apply safe linting fixes to source files

**Command**: `biome lint --write .`

**Input**:
- All TypeScript files in `src/` and `tests/` directories

**Output** (stdout):
```
Fixed N issues in M files
```

**Exit Codes**:
- `0`: Linting completed (may have applied fixes)
- `1`: Unfixable issues remain or error occurred

**Side Effects**:
- Modifies files to apply safe auto-fixes
- Does not modify files with unsafe fixes (reports them instead)

**Example Usage**:
```bash
npm run lint
```

---

## npm run lint:check

**Purpose**: Check for linting issues without modifying files

**Command**: `biome lint .`

**Input**:
- Same as `npm run lint`

**Output** (stdout):
```
# If issues found:
path/to/file.ts:line:col - Error: description
  Suggested fix: ...

# If no issues:
No linting issues found
```

**Exit Codes**:
- `0`: No linting issues
- `1`: One or more linting issues found

**Side Effects**:
- None (read-only operation)

**Example Usage**:
```bash
npm run lint:check
```

---

## npm run check

**Purpose**: Combined format + lint check (recommended for CI)

**Command**: `biome check .`

**Input**:
- All TypeScript files in `src/` and `tests/` directories

**Output** (stdout):
```
Checked N files in Xms

# If issues found:
Formatting issues: M files
Linting issues: P files
[detailed output for each file]

# If no issues:
All checks passed
```

**Exit Codes**:
- `0`: All checks passed
- `1`: One or more checks failed

**Side Effects**:
- None (read-only operation)

**Example Usage**:
```bash
npm run check
```

**Performance**:
- Single pass through files (faster than running format:check + lint:check separately)
- Expected: <5s for typical project size (per SC-001)

---

## npm run fix

**Purpose**: Combined format + lint with auto-fix

**Command**: `biome check --write .`

**Input**:
- Same as `npm run check`

**Output** (stdout):
```
Formatted N files
Fixed M linting issues
P unfixable issues remain
```

**Exit Codes**:
- `0`: All issues fixed or no issues found
- `1`: Unfixable issues remain

**Side Effects**:
- Formats all files
- Applies safe linting fixes
- Does not apply unsafe fixes (reports them)

**Example Usage**:
```bash
npm run fix
```

---

## npm run build

**Purpose**: Run quality checks and build the project

**Command**: `npm run check && vite build`

**Input**:
- All source files for quality checks
- All source files for Vite build

**Output** (stdout):
```
# From npm run check:
Checked N files in Xms
All checks passed

# From vite build:
vite v5.x building for production...
✓ X modules transformed.
dist/cli.js  Y kB
...
✓ built in Zms
```

**Exit Codes**:
- `0`: Checks passed and build succeeded
- `1`: Checks failed OR build failed

**Side Effects**:
- None from check phase
- Generates/updates files in `dist/` directory from build phase

**Example Usage**:
```bash
npm run build
```

**Failure Behavior**:
- If `npm run check` fails (exit code 1), `vite build` never executes
- Developer sees Biome error messages and must fix issues
- Ensures code quality gate before compilation

---

## Contract Guarantees

### Performance
- All commands complete within performance budget (SC-001: <5s for typical changes)
- `check` command is faster than separate `format:check` + `lint:check`

### Determinism
- Same input files + same configuration = same output (reproducible)
- No race conditions or non-deterministic behavior

### Error Handling
- Clear error messages with file paths and line numbers
- Exit codes consistently indicate success (0) or failure (1)
- Invalid configuration results in actionable error messages

### File Safety
- Write operations are atomic where possible
- No partial file updates on error
- Backup not required (Git provides version control)

---

## Testing Contract Compliance

Integration tests MUST verify:

1. **Format Write**: Unformatted file → formatted file after `npm run format`
2. **Format Check**: Unformatted file → exit code 1 from `npm run format:check`
3. **Lint Write**: Fixable issue → fixed file after `npm run lint`
4. **Lint Check**: Linting issue → exit code 1 from `npm run lint:check`
5. **Check Combined**: Issues → exit code 1, details in output
6. **Build Integration**: Quality issues → build fails at check phase
7. **Build Success**: Clean code → build proceeds to Vite phase

---

## Version Compatibility

**Biome Version**: `^1.5.0` (as specified in package.json)

**Breaking Changes**:
- If Biome makes breaking changes to CLI interface, update commands accordingly
- Pin version to avoid unexpected breaking changes
- Document migration steps when upgrading Biome versions

---

## Summary

These npm scripts provide a clear, consistent interface for code quality enforcement:
- **Read-only checks** (`:check` variants) for CI/validation
- **Write operations** (base commands) for development workflow
- **Combined check** for efficiency
- **Build integration** for quality gate enforcement

All contracts are testable, performant, and aligned with developer workflow best practices.
