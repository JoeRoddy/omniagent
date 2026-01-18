# Research: Biome Integration

**Feature**: 003-biome-integration | **Date**: 2026-01-10

## Overview

This document consolidates research findings for integrating Biome as the formatting and linting tool for omniagent, replacing or complementing existing tooling with a unified, fast solution.

## Decision: Biome vs ESLint/Prettier

**Decision**: Use Biome as the primary formatting and linting tool

**Rationale**:
- **Performance**: Biome is written in Rust and significantly faster than ESLint/Prettier combination (10-100x faster in benchmarks)
- **Unified Tool**: Single tool handles both formatting and linting, reducing dependency count and configuration complexity
- **TypeScript Native**: First-class TypeScript support without additional plugins
- **Zero Config**: Sensible defaults work out of the box for TypeScript projects
- **Active Development**: Backed by significant community support and regular updates
- **Migration Path**: Biome provides compatibility with ESLint/Prettier configurations for gradual migration

**Alternatives Considered**:
1. **ESLint + Prettier**: Industry standard but slower, requires two tools and coordination between them
2. **Deno fmt/lint**: Fast but requires Deno runtime, adds complexity to Node.js project
3. **Rome** (Biome's predecessor): Project was forked into Biome; community moved to Biome

## Biome Configuration Best Practices

**Research**: TypeScript projects with Biome typically use the following patterns:

### Configuration Structure (biome.json)

```json
{
  "$schema": "https://biomejs.dev/schemas/1.5.3/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  }
}
```

**Key Decisions**:
- **indentStyle**: Tab vs Space - Project uses tabs (2-space equivalent) based on TypeScript conventions
- **lineWidth**: 100 characters balances readability and modern display widths
- **quoteStyle**: Double quotes for consistency with TypeScript/JavaScript conventions
- **semicolons**: Always use semicolons for explicit statement termination
- **organizeImports**: Enabled to automatically sort and remove unused imports

### Files to Ignore

Biome should ignore:
- `node_modules/` (handled by default)
- `dist/` or build output directories
- Coverage reports (`coverage/`)
- `.specify/` directory (project-specific templates/tooling)
- Lock files (`package-lock.json`, `pnpm-lock.yaml`)

This is configured via the `files.ignore` field in biome.json.

## NPM Script Integration Patterns

**Research**: Standard npm script patterns for Biome integration:

### Script Naming Conventions

```json
{
  "scripts": {
    "format": "biome format --write .",
    "format:check": "biome format .",
    "lint": "biome lint --write .",
    "lint:check": "biome lint .",
    "check": "biome check .",
    "fix": "biome check --write .",
    "build": "biome check && vite build"
  }
}
```

**Pattern Analysis**:
1. **format**: Applies formatting changes (--write flag)
2. **format:check**: Checks formatting without modifying files
3. **lint**: Applies safe linting fixes (--write flag)
4. **lint:check**: Checks linting without modifying files
5. **check**: Combines format + lint checking (recommended for CI)
6. **fix**: Combines format + lint with auto-fix
7. **build**: Runs checks before building to catch issues early

**Decision**: Use `biome check` in the build script as it combines both formatting and linting checks in a single fast pass.

## Build Integration Strategy

**Decision**: Add Biome check as a pre-build step

**Rationale**:
- Catches code quality issues before compilation
- Fast execution (<1s for typical projects) doesn't significantly impact build time
- Fails fast if code doesn't meet quality standards
- Encourages developers to run format/lint during development

**Implementation**:
```json
{
  "scripts": {
    "build": "npm run check && vite build",
    "check": "biome check .",
    "format": "biome format --write .",
    "lint": "biome lint --write ."
  }
}
```

**Alternative Rejected**: Git pre-commit hooks
- **Why Rejected**: Adds setup complexity and may be bypassed with --no-verify
- **Better Approach**: Build-time checks ensure code quality is enforced at integration points

## Testing Strategy

**Research**: Biome integration testing patterns

### Integration Test Approach

1. **Test Biome Installation**: Verify `biome` binary is available
2. **Test Format Check**: Create test file with formatting issues, verify detection
3. **Test Lint Check**: Create test file with linting issues, verify detection
4. **Test Fix Application**: Verify --write flag applies fixes correctly
5. **Test Build Integration**: Verify build script fails on quality issues

**Implementation Pattern**:
```typescript
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'

describe('Biome Integration', () => {
  it('should detect formatting issues', () => {
    const result = execSync('npm run format:check', { encoding: 'utf-8' })
    // Verify output or exit code
  })

  it('should fail build on code quality issues', () => {
    expect(() => {
      execSync('npm run build', { encoding: 'utf-8' })
    }).toThrow()
  })
})
```

## Performance Benchmarks

**Research**: Expected performance characteristics

- **Small projects (<100 files)**: <100ms for full check
- **Medium projects (100-1000 files)**: <500ms for full check
- **Large projects (1000+ files)**: <2s for full check

**Validation**: Meets SC-001 requirement of <5s feedback for typical changes and aligns with constitution's performance standards.

## Migration Considerations

**Current State**: Project has basic TypeScript setup with Vite build

**Migration Steps**:
1. Install Biome as devDependency
2. Create biome.json configuration
3. Run initial format/lint to establish baseline
4. Fix or suppress existing issues
5. Update npm scripts
6. Add integration tests
7. Update documentation

**Risk**: Existing code may have formatting inconsistencies
**Mitigation**: Run `biome check --write` initially to auto-fix, review changes before committing

## Documentation Requirements

**User-Facing Documentation Needed**:
1. README update: Mention Biome for code quality
2. Contributing guide: Explain format/lint commands
3. Development setup: Include `npm install` (Biome comes with it)

**Developer Notes**:
- Biome config is in `biome.json` at repository root
- Run `npm run format` before committing
- CI will enforce checks via build script

## Dependencies

**New Dependency**:
- `@biomejs/biome` (devDependency)

**Version Selection**:
- Use latest stable version (currently 1.5.x as of 2026-01)
- Pin to specific version to ensure consistent behavior across environments
- Update periodically to get new rules and improvements

## Conclusion

Biome integration is straightforward, performant, and aligns with project goals:
- ✅ Fast execution meets performance requirements
- ✅ Single tool reduces complexity
- ✅ TypeScript-native support matches project stack
- ✅ Build integration enforces quality gates
- ✅ Standard npm scripts provide good developer experience

**Ready for Phase 1**: Design artifacts (data model, contracts, quickstart)
