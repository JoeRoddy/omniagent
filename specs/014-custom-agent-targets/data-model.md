# Data Model: Custom Agent Targets

## Entities

### Configuration File (`/Users/joeroddy/Documents/dev/projects/open-source/omniagent/agents/omniagent.config.*`)

Represents the user-defined target configuration loaded from the agents directory.

Fields:
- `targets`: `TargetDefinition[]` (optional) - custom targets and built-in overrides.
- `disableTargets`: `string[]` (optional) - built-in target IDs to remove from active set.
- `hooks`: `SyncHooks` (optional) - global pre/post hooks for sync + conversion.

Validation rules:
- File must exist at the first matching extension in precedence order.
- Export must resolve to a plain object.
- Schema validation errors are fatal and stop all outputs.

Relationships:
- Configuration File 1 -> * TargetDefinition
- Configuration File 1 -> 0..1 SyncHooks

### TargetDefinition

A target destination definition for skills, commands, subagents, and/or instructions.

Fields:
- `id`: `string` (required, unique, lowercase recommended).
- `displayName`: `string` (optional).
- `aliases`: `string[]` (optional, unique across all targets).
- `inherits`: `string` (optional; built-in target ID to inherit defaults).
- `override`: `boolean` (optional; required when colliding with a built-in target ID).
- `outputs`: `TargetOutputs` (optional; absence disables that feature).
- `hooks`: `TargetHooks` (optional).

Validation rules:
- `id` must be unique across custom targets.
- `aliases` must not collide with any target ID or alias.
- If `id` matches a built-in target, `override` or `inherits` must be set.
- If `inherits` is set, the built-in target must exist.

Relationships:
- TargetDefinition 1 -> 0..1 TargetOutputs
- TargetDefinition 1 -> 0..1 TargetHooks

### TargetOutputs

Aggregates per-feature output definitions.

Fields:
- `skills`: `OutputDefinition` (optional).
- `commands`: `CommandOutputDefinition` (optional).
- `subagents`: `OutputDefinition` (optional).
- `instructions`: `InstructionOutputDefinition` (optional).

Validation rules:
- Omitted output = feature disabled for this target.
- Output definitions must resolve placeholders or fail validation.

### OutputDefinition (skills/subagents)

Defines how to write a single feature type.

Fields:
- Short form: `string` path template (full output path).
- Long form:
  - `path`: `string` template (full output path).
  - `writer`: `OutputWriter` (optional; default used for collisions).
  - `converter`: `ConverterRule` (optional; per-item conversion).
  - `fallback`: `FallbackRule` (optional; convert/skip if target unsupported).

Validation rules:
- Path template placeholders must be known/resolvable.

### CommandOutputDefinition

Defines per-target command outputs for both project-level and user-level locations.

Fields:
- Short form: `string` path template (full output path for project-level).
- Long form:
  - `projectPath`: `string` template (required if `userPath` omitted).
  - `userPath`: `string` template (optional user-level path).
  - `writer`: `OutputWriter` (optional).
  - `converter`: `ConverterRule` (optional).
  - `fallback`: `FallbackRule` (optional).

Validation rules:
- At least one of `projectPath` or `userPath` must be present.
- Command output collisions are invalid unless resolved by config.

### InstructionOutputDefinition

Defines instruction filename and optional grouping across targets.

Fields:
- Short form: `string` filename template.
- Long form:
  - `filename`: `string` template (supports deep nesting).
  - `group`: `string` (optional; shared output group).
  - `writer`: `OutputWriter` (optional).
  - `converter`: `ConverterRule` (optional).

Validation rules:
- Filename template placeholders must be known/resolvable.
- Missing/unknown placeholders are fatal errors.

### ConverterRule

Per-item conversion that can generate, skip, or error outputs.

Fields (conceptual):
- `convert(item, context) -> ConverterDecision`

`ConverterDecision` shapes:
- `output`: `GeneratedOutput`
- `outputs`: `GeneratedOutput[]`
- `skip`: `true` (handled, no output)
- `error`: `string`

Validation rules:
- Any `error` entry marks the item as failed; run continues with exit non-zero.

### OutputWriter

Writes a generated output to disk.

Fields (conceptual):
- `write(output, context) -> Promise<void>`

Defaults:
- Subagent writer (canonical subagent format).
- Skill directory writer.
- Instruction writer.

### SyncHooks / TargetHooks

Lifecycle hooks for pre/post processing.

Fields:
- `preSync?(context)`
- `postSync?(context)`
- `preConvert?(item, context)`
- `postConvert?(item, context)`

Validation rules:
- Hook errors fail the sync with clear errors.

### SourceItem

Parsed source input for sync.

Fields:
- `type`: `"skill" | "command" | "subagent" | "instruction"`.
- `name`: `string`.
- `content`: `string`.
- `targets`: `string[] | null` (from frontmatter).
- `outputDir`: `string | null` (instructions).
- `metadata`: `Record<string, unknown>` (optional).

Relationships:
- SourceItem * -> 1 TargetDefinition (resolved targets per item).

### ManagedOutputRecord

Tracks outputs created by sync for safe removal.

Fields:
- `targetId`: `string`.
- `outputPath`: `string`.
- `sourceType`: `string`.
- `sourceId`: `string`.
- `checksum`: `string`.
- `lastSyncedAt`: `string` (ISO timestamp).
- `writerId`: `string` (optional).

State transitions:
- `created` -> `updated` on re-sync.
- `created|updated` -> `removed` when removal is enabled and source is missing
  and checksum matches.
