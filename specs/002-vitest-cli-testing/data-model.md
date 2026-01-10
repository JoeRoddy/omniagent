# Data Model: Vitest CLI Testing

**Feature**: 002-vitest-cli-testing
**Date**: 2026-01-10

## Overview

This feature has minimal data modeling requirements. The primary entities are structural (commands, tests) rather than persistent data.

## Entities

### CLI Command

A discrete operation invokable via the command line.

| Attribute | Type | Description |
|-----------|------|-------------|
| command | string | Command name (e.g., "hello", "greet") |
| describe | string | Help text description |
| builder | function | Yargs builder for options/arguments |
| handler | function | Execution logic |

**Relationships**: None (commands are independent)

**State Transitions**: N/A (stateless operations)

### Test Case

An individual verification of command behavior.

| Attribute | Type | Description |
|-----------|------|-------------|
| name | string | Test description |
| setup | function | beforeEach/setup logic |
| assertion | function | expect() statements |
| teardown | function | afterEach/cleanup logic |

**Relationships**: Test Case → CLI Command (tests one command)

## Example Commands Defined

| Command | Pattern | Arguments | Options |
|---------|---------|-----------|---------|
| hello | Simple output | None | None |
| greet | Positional arg | `<name>` (required) | `--uppercase` |
| echo | Options/flags | `[message]` (optional) | `--times`, `--prefix` |

## Validation Rules

| Rule | Applies To | Description |
|------|------------|-------------|
| Required positional | greet | `name` argument must be provided |
| Type coercion | echo --times | Must be positive integer |
| Default values | echo | message defaults to empty string |

## No Persistent Storage

This feature does not involve data persistence. All entities exist only at runtime during CLI execution or test execution.
