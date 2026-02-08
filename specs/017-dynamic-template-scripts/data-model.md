# Data Model: Dynamic Template Scripts

## Entities

### TemplateSourceFile

**Represents**: A syncable source template (`agents`, `skills`, `commands`, instruction templates)
that may include static text, agent-scoped blocks, and dynamic script blocks.

**Fields**:
- `sourcePath` (string, required, absolute path)
- `surface` (enum: `agents`, `skills`, `commands`, `instructions`)
- `rawContent` (string, required)
- `targetSelection` (array of target identifiers, optional)

**Validation rules**:
- `sourcePath` must resolve within repo or configured agents directory.
- `rawContent` must be valid UTF-8 text for script evaluation.

---

### DynamicScriptBlock

**Represents**: One executable script region inside a `TemplateSourceFile`.

**Fields**:
- `blockId` (string, required; deterministic `${sourcePath}#${index}`)
- `sourcePath` (string, required; references `TemplateSourceFile.sourcePath`)
- `index` (integer, required; source-order position)
- `scriptBody` (string, required)
- `startOffset` (integer, required)
- `endOffset` (integer, required)

**Validation rules**:
- Block delimiters must be balanced and non-nested.
- Blocks are executed in ascending `index` order.
- `scriptBody` may be empty, but empty result normalizes to removed block output.

---

### ScriptExecutionRecord

**Represents**: Runtime state and result for one `DynamicScriptBlock` execution in a sync run.

**Fields**:
- `blockId` (string, required; references `DynamicScriptBlock.blockId`)
- `runId` (string, required)
- `status` (enum: `pending`, `running`, `succeeded`, `failed`)
- `resultKind` (enum: `string`, `json`, `coerced`, `empty`, optional until success)
- `renderedText` (string, optional)
- `errorMessage` (string, optional)
- `startedAt` (datetime string, required)
- `finishedAt` (datetime string, optional)
- `warningCount` (integer, required)

**Validation rules**:
- Exactly one terminal state (`succeeded` or `failed`) per record.
- `failed` records must include `errorMessage`.
- `succeeded` records must include `renderedText` and `resultKind`.

---

### TemplateRenderCache

**Represents**: Per-run cache of script results reused across targets for the same template.

**Fields**:
- `runId` (string, required)
- `templateKey` (string, required; normalized template source path)
- `scriptResults` (map of `blockId -> ScriptExecutionRecord`, required)

**Validation rules**:
- Each block is executed at most once per `runId`.
- Cached success values are reused for every target render of the same template.

---

### SyncRun

**Represents**: One invocation of `sync` across selected targets.

**Fields**:
- `runId` (string, required)
- `targets` (array of target identifiers, required)
- `verbose` (boolean, required)
- `status` (enum: `running`, `failed`, `completed`)
- `failedBlockId` (string, optional)
- `partialOutputsWritten` (boolean, required)

**Validation rules**:
- If `status = failed` due to script execution, `partialOutputsWritten` must be `false`.
- `failedBlockId` must be present when failure source is a script block.

## Relationships

- `DynamicScriptBlock.sourcePath` -> `TemplateSourceFile.sourcePath`
- `ScriptExecutionRecord.blockId` -> `DynamicScriptBlock.blockId`
- `TemplateRenderCache.scriptResults[*]` -> `ScriptExecutionRecord`
- `ScriptExecutionRecord.runId` -> `SyncRun.runId`

## State Transitions

### ScriptExecutionRecord

`pending` -> `running` -> `succeeded`  
`pending` -> `running` -> `failed`

During `running`, heartbeat warnings (`still running`) may be emitted repeatedly with no timeout.

### SyncRun

`running` -> `completed` when all script blocks succeed and writes finish  
`running` -> `failed` immediately on first script-block failure before sync-managed writes
