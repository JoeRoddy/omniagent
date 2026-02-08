# Feature Specification: Dynamic Template Scripts

**Feature Branch**: `017-dynamic-template-scripts`  
**Created**: 2026-02-08  
**Status**: Draft  
**Input**: User description: "support dynamic scripts inside templates to generate synced content such as docs page lists"

## Clarifications

### Session 2026-02-08

- Q: What should be the allowed execution boundary for dynamic template scripts during sync? → A: No restrictions; users should be able to execute any valid JavaScript in userspace.
- Q: Should dynamic scripts be allowed to perform side effects (for example modifying files) during sync? → A: No restrictions; scripts must not be blocked or prevented from doing anything.
- Q: When one dynamic script fails, how should the sync run handle remaining templates? → A: Stop immediately and fail the sync run on the first script error.
- Q: For a sync run targeting multiple outputs, how often should each dynamic script block execute? → A: Execute once per template per sync run and reuse the result for all targets.
- Q: If a dynamic script writes to a sync-managed output file during the same run, which result should win? → A: Renderer output wins; do not add side-effect detection logic.
- Q: What should the script return-value contract be for rendered template content? → A: Strings render as-is; objects/arrays are JSON-serialized; all other values are string-coerced.
- Q: If a script hangs forever, what should sync do? → A: Wait indefinitely and emit periodic "still running" warnings.
- Q: What execution telemetry should be shown by default? → A: No telemetry by default; show telemetry when a root CLI `--verbose` mode is enabled.
- Q: Should script blocks share runtime state? → A: No; each script block runs in an isolated execution context.
- Q: What script block syntax and module access should be supported? → A: Scripts use `<nodejs>...</nodejs>` tags and support CommonJS helpers (`require`, `__dirname`, `__filename`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate content from template scripts (Priority: P1)

As a template author, I want to place dynamic script blocks inside template files so synced outputs can include generated content based on the current repository state.

**Why this priority**: This is the core user value and the primary reason to add script-enabled templates.

**Independent Test**: Can be fully tested by adding a script block to one template, running sync, and confirming the output contains generated content instead of raw script markup.

**Acceptance Scenarios**:

1. **Given** a template contains a dynamic script block that generates a list of documentation files, **When** the user runs sync, **Then** the generated output includes a rendered list of those files in place of the script block.
2. **Given** a documentation file is added or removed after a previous sync, **When** the user runs sync again, **Then** the generated list in output reflects the updated repository state.
3. **Given** a script block uses `require` and `__dirname` to load local files, **When** sync evaluates the block, **Then** the script executes successfully and renders the loaded content.

---

### User Story 2 - Keep static template behavior intact (Priority: P2)

As a user of existing templates, I want static template content to continue working as before so enabling dynamic scripts does not break current sync behavior.

**Why this priority**: Backward compatibility is required for adoption and safe rollout.

**Independent Test**: Can be fully tested by syncing templates without script blocks before and after this feature and verifying there are no output differences.

**Acceptance Scenarios**:

1. **Given** a template contains no dynamic script blocks, **When** the user runs sync, **Then** output content is unchanged compared to previous behavior.
2. **Given** a template contains both static text and dynamic script blocks, **When** the user runs sync, **Then** static text is preserved exactly and only script block regions are replaced with generated text.
3. **Given** a dynamic script directly writes a sync-managed output file that is also rendered by sync, **When** sync writes rendered output for that file, **Then** the rendered output is authoritative.

---

### User Story 3 - Fail safely on script errors (Priority: P3)

As a template author, I want clear failure feedback when a script block cannot be evaluated so I can correct the template without producing partial or misleading outputs.

**Why this priority**: Dynamic scripts increase author flexibility but must remain safe and debuggable.

**Independent Test**: Can be fully tested by introducing a script error and confirming sync reports the failing template and does not write partial results.

**Acceptance Scenarios**:

1. **Given** a template includes a script block with invalid logic, **When** the user runs sync, **Then** sync fails with an actionable error identifying the failing template and script block.
2. **Given** any script block fails during a sync run, **When** the first failure occurs, **Then** sync stops immediately and no additional templates are processed.
3. **Given** a script block fails during a sync run, **When** sync terminates, **Then** no partially rendered output is written for that run.
4. **Given** a script block runs without completing, **When** sync continues waiting, **Then** periodic "still running" warnings are emitted.
5. **Given** sync runs in default mode, **When** scripts execute successfully, **Then** no per-script execution telemetry is shown unless verbose mode is enabled.

---

### Edge Cases

- A script block returns an empty result.
- A script block references a path that does not exist in the repository.
- Multiple script blocks in one template depend on different parts of the repository.
- Generated text includes characters that could be interpreted as template markup.
- A script block runs for an unbounded duration and delays sync completion.
- Different templates include scripts that read overlapping repository content.
- A script writes directly to a sync-managed output path before normal renderer writes occur.

## Scope & Non-Goals

**In scope**:
- Dynamic script blocks embedded in syncable templates that produce rendered text during sync.
- Consistent behavior for all current syncable surfaces (agents, skills, slash commands).
- Safe failure behavior and actionable error reporting for script evaluation problems.
- Documentation updates that explain authoring and expected behavior.

**Out of scope**:
- Building a general-purpose plugin marketplace or remote script registry.
- Automatic migration of existing templates to dynamic scripts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow template authors to embed dynamic script blocks within syncable template files.
- **FR-001a**: Dynamic script blocks MUST be delimited by `<nodejs>` and `</nodejs>` tags.
- **FR-002**: During sync, the system MUST evaluate each dynamic script block and replace it with generated text in the rendered output.
- **FR-003**: Script evaluation MUST use the current state of repository content at sync time so generated output stays current.
- **FR-004**: Template content outside dynamic script blocks MUST be preserved exactly in rendered output.
- **FR-005**: The system MUST support multiple dynamic script blocks in a single template and process them deterministically in source order.
- **FR-005a**: For a sync run that produces multiple targets, each dynamic script block MUST execute once per template per run, and the produced result MUST be reused for all targets rendered from that template.
- **FR-006**: If any dynamic script block fails to evaluate, the sync run MUST fail immediately, stop further template processing, and provide an actionable error message that identifies the source template.
- **FR-007**: When script evaluation fails, the system MUST avoid writing partial sync-managed rendered outputs for the failed run.
- **FR-008**: If a script block generates an empty result, the rendered output MUST omit that block without inserting placeholder text.
- **FR-009**: Dynamic script templating MUST be supported across all current syncable features (agents, skills, slash commands) and treated as a requirement for future syncable features.
- **FR-010**: Project documentation MUST include author guidance and at least one end-to-end example showing dynamic generation of a docs-page list from repository contents.
- **FR-011**: The system MUST allow dynamic scripts to execute with unrestricted userspace capabilities available to the runtime environment, including filesystem, network, and subprocess access.
- **FR-012**: The system MUST NOT enforce sandboxing, permission gating, execution timeouts, or side-effect restrictions on user-authored dynamic scripts.
- **FR-013**: If a script directly modifies a sync-managed output path that the renderer writes in the same run, the renderer write result MUST be the final content for that output.
- **FR-014**: The system MUST NOT attempt to detect, block, reconcile, or roll back script-authored side effects outside normal renderer-managed writes.
- **FR-015**: Script return values MUST be rendered as follows: strings unchanged, objects/arrays as JSON text, and all other values using string coercion.
- **FR-016**: If a script does not complete, the system MUST continue waiting without timeout and MUST emit periodic "still running" warnings until completion or external interruption.
- **FR-017**: In default mode, the system MUST suppress routine per-script execution telemetry; when root CLI `--verbose` is enabled, the system MUST emit script execution telemetry.
- **FR-018**: Each dynamic script block MUST execute in an isolated runtime context and MUST NOT share in-memory execution state with other script blocks.
- **FR-019**: Script execution context MUST expose `require`, `__dirname`, and `__filename` so template code can load Node.js modules and resolve local paths.

### Acceptance Coverage

- **FR-001, FR-001a, FR-002, FR-003**: Covered by User Story 1 acceptance scenarios.
- **FR-004, FR-005, FR-005a, FR-008, FR-013, FR-015**: Covered by User Story 2 acceptance scenarios.
- **FR-006, FR-007, FR-011, FR-012, FR-014, FR-016, FR-017, FR-018**: Covered by User Story 3 acceptance scenarios.
- **FR-019**: Covered by User Story 1 acceptance scenario 3.
- **FR-009, FR-010**: Covered by cross-feature validation and documentation review.

### Key Entities *(include if feature involves data)*

- **Template Source File**: A syncable input file that can contain static text and dynamic script blocks.
- **Dynamic Script Block**: A marked region in a template that produces text at sync time.
- **Rendered Output File**: The final synced file written for a target after script and template processing.
- **Sync Run**: A single execution that processes one or more templates and writes rendered outputs.
- **Script Evaluation Result**: The generated text or failure details produced when a dynamic script block is processed.

## Assumptions

- Template authors are trusted project contributors and can review script logic in version control.
- Dynamic script output can vary based on runtime conditions and script-authored side effects.
- Existing sync triggers and workflows remain unchanged; this feature only extends template rendering behavior.

## Dependencies

- The sync engine can access repository files needed by script blocks at runtime.
- Current syncable feature definitions (agents, skills, slash commands) can adopt a shared script-enabled template parsing rule.
- Documentation updates can be shipped alongside feature delivery.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance tests covering agents, skills, and slash commands, 100% of dynamic script blocks render expected generated text in synced outputs.
- **SC-002**: In regression tests for templates without dynamic script blocks, output differences remain at 0% compared to baseline behavior.
- **SC-003**: In test scenarios where repository docs files change between sync runs, 100% of generated docs-list outputs reflect the updated file set after the next sync.
- **SC-004**: In failure-path tests, 100% of script evaluation errors produce actionable messages and zero partial sync-managed output writes.
- **SC-005**: In maintainer usability validation, at least 90% of participants can add a dynamic docs-list template block and generate correct output on their first attempt.
