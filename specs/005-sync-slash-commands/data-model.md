# Data Model: Sync Custom Slash Commands

## CommandCatalog
- **Description**: The shared set of canonical slash commands stored in the repo
  using Claude Code's command definition format as the source of truth.
- **Fields**:
  - `repoRoot`: string (absolute path)
  - `commandsPath`: string (absolute path, `${repoRoot}/agents/commands`)
  - `canonicalStandard`: enum (`claude_code`)
  - `commands`: SlashCommandDefinition[]
- **Validation Rules**:
  - `commandsPath` must exist and be readable.
  - `canonicalStandard` must be `claude_code`.
  - `commands` must be non-empty for a sync run.

## SlashCommandDefinition
- **Description**: A single canonical slash command defined in Claude Code's
  Markdown format.
- **Fields**:
  - `name`: string (case-insensitive unique)
  - `description`: string | null
  - `prompt`: string
  - `sourcePath`: string (absolute path to markdown file)
  - `targetAgents`: TargetName[] | null (optional per-command targeting)
- **Validation Rules**:
  - `name` must be unique case-insensitively across the catalog.
  - `prompt` must be non-empty.

## AgentCapabilityProfile
- **Description**: Supported capabilities for a target agent.
- **Fields**:
  - `name`: TargetName enum (`claude` | `codex` | `gemini` | `copilot`)
  - `supportsSlashCommands`: boolean
  - `supportedScopes`: Scope[] (`project` | `global`)
  - `fileFormat`: enum (`markdown` | `toml`)
  - `supportsDescription`: boolean
  - `supportsNamespaces`: boolean
- **Validation Rules**:
  - `supportedScopes` must be empty when `supportsSlashCommands` is false.

## SyncRequest
- **Description**: A single sync invocation and its chosen options.
- **Fields**:
  - `repoRoot`: string (absolute path)
  - `selectedTargets`: TargetName[]
  - `scopeByTarget`: Record<TargetName, Scope>
  - `conflictResolution`: enum (`overwrite` | `rename` | `skip`)
  - `removeMissing`: boolean
  - `unsupportedFallback`: enum (`convert_to_skills` | `skip`)
  - `codexConversionChoice`: enum (`global` | `project` | `skip`)
  - `nonInteractive`: boolean
  - `useDefaults`: boolean
  - `requestedAt`: string (ISO timestamp)
- **Validation Rules**:
  - `selectedTargets` must be a subset of supported target names.
  - `scopeByTarget` must include all selected targets that support scopes.

## SyncPlanAction
- **Description**: A single planned action during sync.
- **Fields**:
  - `targetName`: TargetName
  - `action`: enum (`create` | `update` | `remove` | `convert` | `skip` | `fail`)
  - `commandName`: string
  - `scope`: Scope | null

## SyncPlan
- **Description**: The preview of actions to be applied.
- **Fields**:
  - `actions`: SyncPlanAction[]
  - `summary`: Record<TargetName, { create: number; update: number; remove: number; convert: number; skip: number }>

## SyncStateManifest
- **Description**: Per-target state for managed commands.
- **Fields**:
  - `targetName`: TargetName
  - `scope`: Scope
  - `managedCommands`: Array<{ name: string; hash: string; lastSyncedAt: string }>
- **Validation Rules**:
  - `managedCommands` must list unique names (case-insensitive).

## SyncResult
- **Description**: Per-target outcome produced by a sync request.
- **Fields**:
  - `targetName`: TargetName
  - `status`: enum (`synced` | `skipped` | `failed` | `partial`)
  - `message`: string
  - `error`: string | null
  - `counts`: { created: number; updated: number; removed: number; converted: number; skipped: number }

## Relationships
- `CommandCatalog` contains many `SlashCommandDefinition` entries.
- `SyncRequest` references one `CommandCatalog` and many `AgentCapabilityProfile` entries.
- `SyncPlan` is derived from one `SyncRequest` and produces many `SyncPlanAction` entries.
- `SyncResult` is emitted per target and updates one `SyncStateManifest`.

## State Transitions
- **SyncRequest**: `created` -> `validated` -> `planned` -> `applied`.
- **SyncResult**: `pending` -> `synced` | `skipped` | `failed` | `partial`.
