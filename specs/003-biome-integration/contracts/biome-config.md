# Contract: Biome Configuration

**Feature**: 003-biome-integration | **Date**: 2026-01-10

## Overview

This contract defines the structure and behavior of `biome.json`, the configuration file that controls Biome's formatting and linting behavior.

---

## File Location

**Path**: `/biome.json` (repository root)

**Discovery**: Biome automatically discovers this file when running from any subdirectory

---

## Configuration Schema

### Root Structure

```json
{
  "$schema": "https://biomejs.dev/schemas/1.5.3/schema.json",
  "organizeImports": { },
  "formatter": { },
  "linter": { },
  "javascript": { },
  "files": { }
}
```

### Schema Reference

**Field**: `$schema`
- **Type**: `string`
- **Required**: No (but recommended for IDE autocomplete)
- **Value**: `"https://biomejs.dev/schemas/1.5.3/schema.json"`
- **Purpose**: Enables IDE validation and autocomplete

---

## Organize Imports Section

**Purpose**: Configure automatic import sorting and cleanup

```json
{
  "organizeImports": {
    "enabled": true
  }
}
```

**Contract**:
- **enabled: true**: Biome will sort imports alphabetically and remove unused imports
- **enabled: false**: Import organization disabled

**Behavior**:
- Groups imports: built-ins → external packages → internal modules
- Sorts alphabetically within each group
- Removes completely unused imports
- Does not remove imports used only in types (preserves type imports)

---

## Formatter Section

**Purpose**: Configure code formatting rules

```json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "indentWidth": 2,
    "lineWidth": 100
  }
}
```

### Fields

**enabled**
- **Type**: `boolean`
- **Default**: `true`
- **Contract**: When `false`, all formatting is disabled

**indentStyle**
- **Type**: `"tab" | "space"`
- **Default**: `"tab"`
- **Contract**:
  - `"tab"`: Use tab characters for indentation
  - `"space"`: Use space characters for indentation
- **Project Decision**: `"tab"` (standard for TypeScript projects)

**indentWidth**
- **Type**: `number`
- **Default**: `2`
- **Range**: 1-10 (practical limits)
- **Contract**: Number of spaces per indent level (or visual width of tabs)
- **Project Decision**: `2` (matches TypeScript/ESLint conventions)

**lineWidth**
- **Type**: `number`
- **Default**: `80`
- **Range**: 1-320 (Biome limits)
- **Contract**: Maximum line length before wrapping
- **Project Decision**: `100` (balances readability and modern screens)

### Formatting Behavior

**Wrapping Strategy**:
- Long lines are wrapped at logical breakpoints (after commas, operators)
- Preserves semantic structure (e.g., object properties stay together when possible)
- Prefers consistent wrapping (all arguments wrapped if one is)

**Whitespace**:
- Single space after commas in arrays/objects
- Single space around operators
- No trailing whitespace at line ends
- Single newline at end of file

---

## Linter Section

**Purpose**: Configure linting rules

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "warn"
      },
      "correctness": {
        "noUnusedVariables": "error"
      }
    }
  }
}
```

### Fields

**enabled**
- **Type**: `boolean`
- **Default**: `true`
- **Contract**: When `false`, all linting is disabled

**rules.recommended**
- **Type**: `boolean`
- **Default**: `false`
- **Contract**: Enables Biome's recommended rule set
- **Project Decision**: `true` (use opinionated defaults)

**Rule Categories**:
- `correctness`: Catch likely bugs
- `suspicious`: Flag suspicious patterns
- `style`: Enforce code style consistency
- `complexity`: Limit code complexity
- `performance`: Identify performance issues
- `a11y`: Accessibility rules (for JSX)
- `security`: Security best practices

**Rule Severity Levels**:
- `"off"`: Rule disabled
- `"warn"`: Issue reported but doesn't fail checks
- `"error"`: Issue reported and fails checks

### Default Rule Overrides

```json
{
  "rules": {
    "recommended": true,
    "suspicious": {
      "noExplicitAny": "warn"
    }
  }
}
```

**Rationale**:
- `noExplicitAny: "warn"`: Allow explicit `any` during development, warn but don't block
- Can be tightened to `"error"` once codebase matures

---

## JavaScript/TypeScript Section

**Purpose**: Language-specific formatting rules

```json
{
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingComma": "all",
      "arrowParentheses": "always"
    }
  }
}
```

### Fields

**quoteStyle**
- **Type**: `"single" | "double"`
- **Default**: `"double"`
- **Contract**:
  - `"single"`: Use single quotes for strings
  - `"double"`: Use double quotes for strings
- **Project Decision**: `"double"` (TypeScript convention)

**semicolons**
- **Type**: `"always" | "asNeeded"`
- **Default**: `"always"`
- **Contract**:
  - `"always"`: Require semicolons at statement ends
  - `"asNeeded"`: Only insert semicolons when required by ASI rules
- **Project Decision**: `"always"` (explicit, prevents ASI bugs)

**trailingComma**
- **Type**: `"none" | "all"`
- **Default**: `"all"`
- **Contract**:
  - `"all"`: Add trailing commas in arrays, objects, parameters
  - `"none"`: No trailing commas
- **Project Decision**: `"all"` (better Git diffs)

**arrowParentheses**
- **Type**: `"always" | "asNeeded"`
- **Default**: `"always"`
- **Contract**:
  - `"always"`: Always use parentheses around arrow function parameters
  - `"asNeeded"`: Only use when multiple parameters or needed
- **Project Decision**: `"always"` (consistency)

---

## Files Section

**Purpose**: Configure which files Biome processes

```json
{
  "files": {
    "ignore": [
      "node_modules",
      "dist",
      "coverage",
      ".specify",
      "*.lock"
    ],
    "include": [
      "src/**/*.ts",
      "tests/**/*.ts"
    ]
  }
}
```

### Fields

**ignore**
- **Type**: `string[]` (glob patterns)
- **Contract**: Files/directories matching these patterns are excluded
- **Default Ignores**: `node_modules` (always ignored even if not specified)

**include**
- **Type**: `string[]` (glob patterns)
- **Optional**: If omitted, all files except ignored are processed
- **Contract**: Only files matching these patterns are processed

### Ignore Patterns

**Project Configuration**:
```json
{
  "ignore": [
    "node_modules",      // Dependencies (default)
    "dist",              // Build output
    "coverage",          // Test coverage reports
    ".specify",          // Spec framework
    "*.lock",            // Lock files
    "**/*.config.js",    // Config files (if needed)
    ".git"               // Git metadata
  ]
}
```

**Glob Syntax**:
- `*`: Match any characters except `/`
- `**`: Match any characters including `/` (recursive)
- `?`: Match single character
- `[abc]`: Match any character in set
- `{a,b}`: Match either pattern

---

## Configuration Validation

### Required Fields (Minimal Config)
```json
{
  "$schema": "https://biomejs.dev/schemas/1.5.3/schema.json"
}
```

**Everything else is optional** and falls back to defaults.

### Invalid Configurations

**Error Conditions**:
1. **Invalid JSON syntax**: Biome reports parse error with line number
2. **Unknown field**: Biome reports warning about unrecognized configuration
3. **Invalid value type**: Biome reports type error (e.g., string where boolean expected)
4. **Out of range value**: Biome reports constraint violation (e.g., lineWidth > 320)

**Error Handling**:
- Configuration errors prevent Biome from running
- Error messages include file path and specific issue
- Exit code 1 returned

---

## Configuration Precedence

1. **Command-line flags** (highest priority)
   - Example: `biome format --line-width 80`
2. **biome.json in project root**
3. **Built-in defaults** (lowest priority)

**Project Contract**:
- No command-line overrides in npm scripts
- All configuration centralized in `biome.json`
- Ensures consistent behavior across all developers

---

## Migration and Updates

### Adding New Rules
1. Update `biome.json` with new rule configuration
2. Run `npm run fix` to auto-fix existing violations
3. Review changes before committing
4. Update this contract document if behavior changes

### Upgrading Biome Version
1. Review Biome changelog for breaking changes
2. Update `$schema` URL to new version
3. Test configuration: `npm run check`
4. Update contracts if new features used

---

## Testing Configuration

**Validation Tests**:
1. **Valid config loads**: No errors when running `biome check`
2. **Formatting rules apply**: Create test file, verify formatting matches config
3. **Linting rules apply**: Create test file with violations, verify detection
4. **Ignore patterns work**: Create file in `dist/`, verify it's skipped

**Example Test**:
```typescript
describe('Biome Configuration', () => {
  it('should respect lineWidth setting', () => {
    // Create file with >100 char line
    // Run format
    // Verify line is wrapped
  })

  it('should ignore dist/ directory', () => {
    // Create invalid file in dist/
    // Run check
    // Verify exit code 0 (file ignored)
  })
})
```

---

## Summary

The `biome.json` contract ensures:
- ✅ Deterministic formatting across all environments
- ✅ Consistent linting rules for code quality
- ✅ Clear ignore patterns to skip non-source files
- ✅ TypeScript-specific conventions (quotes, semicolons)
- ✅ IDE integration via JSON schema
- ✅ Explicit configuration (no hidden behavior)

All configuration is version-controlled, enabling team-wide consistency and reproducible builds.
