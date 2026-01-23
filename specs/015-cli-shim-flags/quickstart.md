# Quickstart: CLI Shim Surface

## 1) (Optional) set a default agent

Create or update the config file in the agents directory:

- `/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/omniagent.config.ts`

Example:

```ts
const config = {
	defaultAgent: "codex",
};

export default config;
```

If `defaultAgent` is not set, you must pass `--agent` on each invocation.

## 2) Start an interactive session (default)

```bash
omniagent --agent codex --approval prompt --output text
```

With a default agent configured, you can run:

```bash
omniagent
```

## 3) Run a one-shot prompt

```bash
omniagent -p "Summarize the repo" --agent codex --output json
```

Or via piped stdin:

```bash
echo "Summarize the repo" | omniagent --agent codex
```

## 4) Use approval, sandbox, and web flags

```bash
omniagent -p "Refactor this" --agent claude --yolo --web --output stream-json
```

Notes:
- `--yolo` defaults `--sandbox` to `off` unless `--sandbox` is explicitly provided.
- `--web` enables web access but the agent may still choose not to use it.
- Unsupported shared flags for the selected agent emit a warning and are ignored (no-op).
- Agent output is always passed through unmodified, even for JSON output modes.

## 5) Pass agent-specific flags through

```bash
omniagent -p "Write tests" --agent codex -- --some-agent-flag --model gpt-5
```

Notes:
- Arguments after `--` are passed verbatim to the agent CLI.
- Unknown shim flags before `--` are rejected with invalid usage.
- Using `--` without `--agent` is invalid.
