# Command Reference

## Sync

```bash
npx omniagent@latest sync
npx omniagent@latest sync --only claude
npx omniagent@latest sync --skip codex
npx omniagent@latest sync --exclude-local
npx omniagent@latest sync --exclude-local=skills,commands
npx omniagent@latest sync --agentsDir ./my-custom-agents
npx omniagent@latest sync --list-local
npx omniagent@latest sync --yes
npx omniagent@latest sync --verbose
npx omniagent@latest sync --json
```

Run-level override behavior:

- `--only` replaces per-file frontmatter defaults for this run.
- `--skip` filters the active target set after `--only`.
- If both are provided, `--only` applies first and `--skip` applies second.

## Shim

```bash
omniagent --agent codex
omniagent -p "Summarize the repo" --agent codex --output json
echo "Summarize the repo" | omniagent --agent codex
```

For full shim behavior, see [`docs/cli-shim.md`](cli-shim.md).
