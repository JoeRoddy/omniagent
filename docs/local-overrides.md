# Local Overrides

Local overrides let each developer customize behavior without changing shared canonical files.

## Naming

Examples:

```text
agents/
  commands/
    deploy.local.md
  skills/
    review-helper.local/
      SKILL.md
  agents/
    release-helper.local.md
```

Directory-style local overrides are also supported:

```text
agents/
  .local/
    commands/
      deploy.md
    skills/
      review-helper/
        SKILL.md
    agents/
      release-helper.md
```

## Behavior

- Local items override shared items with the same logical name.
- Generated outputs do not keep `.local` in output names.
- Local sources are intended for personal use and should not be published as team defaults.

## Control flags

- `--exclude-local` ignores all local overrides.
- `--exclude-local=skills,commands` ignores local overrides only for listed categories.
- `--list-local` prints detected local items and exits.
