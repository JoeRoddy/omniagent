# Quickstart: Biome Integration

**Feature**: 003-biome-integration | **Date**: 2026-01-10

## Overview

This guide provides a quick reference for developers working with Biome formatting and linting in the omniagent project.

---

## Installation

Biome is installed automatically when you run:

```bash
npm install
```

No additional setup required - Biome comes as a dev dependency.

---

## Common Commands

### Format Code (Auto-fix)

Fix all formatting issues in your code:

```bash
npm run format
```

**Use when**: Before committing changes, after editing multiple files

**What it does**: Applies formatting rules from `biome.json` to all TypeScript files

---

### Check Formatting (Read-only)

Verify formatting without modifying files:

```bash
npm run format:check
```

**Use when**: Validating code in CI, checking before committing

**Exit codes**:
- `0` = All files properly formatted
- `1` = Some files need formatting

---

### Lint and Fix (Auto-fix)

Apply safe linting fixes:

```bash
npm run lint
```

**Use when**: After writing new code, to apply safe auto-fixes

**What it does**: Fixes issues like unused variables, missing imports, etc.

---

### Check Linting (Read-only)

Verify linting without modifying files:

```bash
npm run lint:check
```

**Use when**: Validating code in CI, checking for issues

---

### Combined Check (Recommended)

Run both formatting and linting checks:

```bash
npm run check
```

**Use when**: Before committing, in CI pipelines

**What it does**: Fast single-pass check of both formatting and linting

---

### Combined Fix (Auto-fix All)

Fix both formatting and linting issues:

```bash
npm run check:write
```

**Use when**: Quick cleanup before committing

---

### Build with Quality Checks

Build the project (includes automatic quality checks):

```bash
npm run build
```

**What it does**:
1. Runs `npm run check` first
2. If checks pass, runs `vite build`
3. If checks fail, build stops immediately

---

## Typical Workflows

### Development Workflow

1. **Write code** in your editor
2. **Format periodically**: `npm run format`
3. **Before committing**: `npm run check`
4. **Fix any issues**: `npm run check:write` (if needed)
5. **Commit** your changes

### Pre-commit Checklist

```bash
# Check for issues
npm run check

# If issues found, fix them
npm run check:write

# Verify fixes
npm run check

# Commit
git add .
git commit -m "Your message"
```

### CI/CD Workflow

```bash
# In CI pipeline
npm ci                  # Install dependencies
npm run check           # Verify code quality (fails if issues)
npm run build           # Build (includes check again)
npm test                # Run tests
```

---

## Understanding Biome Output

### Formatting Issue Example

```
File src/cli/index.ts needs formatting
  Line 15: Expected double quotes, found single quotes
  Line 23: Line exceeds 100 characters
```

**Fix**: Run `npm run format` to auto-fix

### Linting Issue Example

```
src/cli/index.ts:42:7 - Error: 'unused' is declared but never used
  > 42 | const unused = 123;
       |       ^^^^^^
  Suggestion: Remove unused variable or prefix with underscore

src/services/validator.ts:15:3 - Warning: Explicit 'any' type
  > 15 | param: any
       |        ^^^
```

**Fix**:
- Remove unused variables
- Or run `npm run lint` for auto-fixes
- Warnings don't fail checks, but should be addressed

---

## Configuration

### Configuration File

Biome configuration is in `/biome.json` at the repository root.

**Key settings**:
- Line width: 100 characters
- Indentation: Tabs (2-space width)
- Quotes: Double quotes
- Semicolons: Always

**To modify**: Edit `biome.json` and commit changes (team discussion recommended)

### Ignored Files

Biome automatically ignores:
- `node_modules/`
- `dist/`
- `coverage/`
- `.specify/`
- Lock files (`*.lock`)

**To add ignores**: Edit `files.ignore` in `biome.json`

---

## IDE Integration

### VS Code

Biome provides syntax highlighting and autocomplete for `biome.json` via the `$schema` field.

**Optional**: Install Biome extension for inline formatting/linting

1. Open VS Code Extensions
2. Search for "Biome"
3. Install official Biome extension
4. Reload VS Code

**Extension benefits**:
- Format on save
- Inline error highlighting
- Quick fixes via Code Actions

### Other IDEs

Most modern IDEs support running npm scripts:
- IntelliJ/WebStorm: Run configurations for npm scripts
- Vim/Neovim: `:!npm run format`
- Emacs: `M-x shell-command npm run format`

---

## Troubleshooting

### "Biome command not found"

**Issue**: Biome binary not in PATH

**Fix**:
```bash
npm install      # Ensure dependencies are installed
```

Biome is in `node_modules/.bin/biome` and accessed via npm scripts.

### Build fails with "Code quality issues"

**Issue**: Formatting or linting errors

**Fix**:
```bash
npm run check:write   # Auto-fix issues
npm run check         # Verify fixes
npm run build         # Try build again
```

### "Parse error" in Biome

**Issue**: Syntax error in TypeScript file

**Fix**:
1. Check Biome output for file and line number
2. Fix syntax error (e.g., unclosed bracket, typo)
3. Run `npm run check` again

### Changes not being formatted

**Issue**: File may be ignored or Biome config issue

**Fix**:
1. Verify file is TypeScript (`.ts` extension)
2. Check `files.ignore` in `biome.json`
3. Ensure file is in `src/` or `tests/` directory
4. Try: `npx biome format path/to/file.ts --write`

---

## Performance

Biome is extremely fast:
- **Small projects** (<100 files): <100ms
- **Medium projects** (100-1000 files): <500ms
- **This project**: Typically <1s for full check

No performance concerns for development workflow.

---

## FAQ

**Q: Do I need to run format before every commit?**
A: Recommended, but not strictly required. The build script runs checks automatically.

**Q: Can I disable specific linting rules?**
A: Yes, edit `biome.json` linter rules section. Discuss with team first.

**Q: What if I disagree with a formatting rule?**
A: Formatting is intentionally opinionated for consistency. If you have a strong case, propose a config change with rationale.

**Q: Does Biome work offline?**
A: Yes, Biome is a local binary with no network dependencies.

**Q: How do I update Biome?**
A: Update package.json dependency version and run `npm install`. Review changelog for breaking changes.

**Q: Can I use Biome with other tools (ESLint, Prettier)?**
A: Biome replaces both. Running multiple tools may cause conflicts. Stick with Biome for consistency.

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────┐
│ BIOME QUICK REFERENCE                               │
├─────────────────────────────────────────────────────┤
│ Format code:              npm run format            │
│ Check formatting:         npm run format:check      │
│ Lint and fix:             npm run lint              │
│ Check linting:            npm run lint:check        │
│ Combined check:           npm run check             │
│ Combined fix:             npm run check:write       │
│ Build with checks:        npm run build             │
├─────────────────────────────────────────────────────┤
│ Config file:              biome.json                │
│ Ignored dirs:             node_modules, dist, etc.  │
│ Line width:               100 chars                 │
│ Style:                    Tabs, double quotes       │
└─────────────────────────────────────────────────────┘
```

---

## Next Steps

1. **Run initial format**: `npm run format` to baseline existing code
2. **Verify checks pass**: `npm run check`
3. **Set up IDE integration** (optional but recommended)
4. **Add to workflow**: Make `npm run check` part of your pre-commit routine

---

## Support

- **Biome Documentation**: https://biomejs.dev
- **Project Issues**: Check `CLAUDE.md` or `AGENTS.md` for project-specific guidelines
- **Configuration**: See `contracts/biome-config.md` for detailed config documentation

---

**Last Updated**: 2026-01-10 | **Feature**: 003-biome-integration
