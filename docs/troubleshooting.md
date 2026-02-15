# Troubleshooting

## `sync` did not write expected files

- Confirm your canonical sources are under `agents/` (or the directory passed to `--agentsDir`).
- Use `npx omniagent@latest sync --json` to inspect run output.
- Check whether `targets` frontmatter filtered the item out.

## Local overrides are unexpectedly winning

- Local files with `.local` suffix override shared items of the same name.
- Run `npx omniagent@latest sync --list-local` to inspect active local items.
- Use `--exclude-local` when you need to validate shared-only outputs.

## Template scripts fail

- Run `npx omniagent@latest sync --verbose` for script execution diagnostics.
- Validate `<nodejs>` and `<shell>` blocks independently in your environment.
- Remember that failures abort sync before managed writes are applied.

## Shim flags are ignored

- Some shared flags are not supported by every target.
- Review capability differences in [`docs/cli-shim.md`](cli-shim.md).
