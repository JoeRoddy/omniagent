# CLI Command Contracts

**Feature**: 002-vitest-cli-testing
**Date**: 2026-01-10

## Command: `hello`

Simple greeting command with no arguments.

### Interface

```
agentctl hello [options]
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| --help | boolean | - | Show help |

### Behavior

| Input | Output | Exit Code |
|-------|--------|-----------|
| `agentctl hello` | `Hello, World!` | 0 |
| `agentctl hello --help` | Usage information | 0 |

---

## Command: `greet`

Personalized greeting with required name argument.

### Interface

```
agentctl greet <name> [options]
```

### Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| name | string | Yes | Name to greet |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| --uppercase, -u | boolean | false | Output in uppercase |
| --help | boolean | - | Show help |

### Behavior

| Input | Output | Exit Code |
|-------|--------|-----------|
| `agentctl greet Alice` | `Hello, Alice!` | 0 |
| `agentctl greet Alice --uppercase` | `HELLO, ALICE!` | 0 |
| `agentctl greet` (missing name) | Error: missing required argument | 1 |
| `agentctl greet --help` | Usage information | 0 |

---

## Command: `echo`

Echo message with repeat and prefix options.

### Interface

```
agentctl echo [message] [options]
```

### Arguments

| Argument | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| message | string | No | "" | Message to echo |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| --times, -t | number | 1 | Number of times to repeat |
| --prefix, -p | string | "" | Prefix for each line |
| --help | boolean | - | Show help |

### Behavior

| Input | Output | Exit Code |
|-------|--------|-----------|
| `agentctl echo "test"` | `test` | 0 |
| `agentctl echo "hi" --times 3` | `hi\nhi\nhi` | 0 |
| `agentctl echo "msg" --prefix "> "` | `> msg` | 0 |
| `agentctl echo` | (empty output) | 0 |
| `agentctl echo "x" --times -1` | Error: times must be positive | 1 |
| `agentctl echo --help` | Usage information | 0 |

---

## Error Contract

All commands follow consistent error handling:

| Condition | stderr Output | Exit Code |
|-----------|---------------|-----------|
| Missing required argument | `Error: Missing required argument: <arg>` | 1 |
| Invalid option value | `Error: Invalid value for --option: <details>` | 1 |
| Unknown command | `Unknown command: <cmd>` | 1 |
| Unknown option | `Unknown option: --<opt>` | 1 |

## Help Contract

All commands support `--help` which outputs:
- Command name and description
- Usage syntax
- Available arguments with descriptions
- Available options with types and defaults
