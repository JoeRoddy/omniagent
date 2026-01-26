# CLI Shim: Missing Functionality Summary

## What the 015 branch actually implemented

- Added a shim entrypoint at the root CLI that parses shared flags and spawns a selected agent CLI.
- Added a shared-flag parser, invocation resolver (interactive vs one-shot), and passthrough handling.
- Added a hard-coded capability matrix and a static flag mapper that re-emits shim flags.
- Added default-agent resolution from `agents/omniagent.config.*`.
- Added tests that validate parsing, mode resolution, passthrough ordering, and warning behavior.

In short: we now **parse shared flags into a normalized in-memory shape**, but we **do not translate them into agent-specific CLI equivalents**. The mapper mostly forwards the shim flags themselves.

## What is missing

### 1) Real per-agent CLI translation
The current `agent-capabilities.ts` uses shared flag strings for every agent:

- `--approval`, `--sandbox`, `--output`, `--web`, and `-p/--prompt` are passed verbatim to the agent.
- This is wrong for multiple agents (e.g. Codex expects `codex exec` + positional prompt, `--ask-for-approval`, `--search`, and `--json`).

We need to replace the static flag map with **agent-specific translations** (and possibly different command shapes per mode).

### 2) Configurable translation hooks in the config API
There is no config surface today that lets users define or override translations.

Current config types only support:
- `defaultAgent`
- `targets` (output paths only)
- `disableTargets`
- sync hooks (for outputs)

Missing: a config-level CLI translation surface that can customize per-agent invocation.

### 3) A clean data model for translation
We already parse shared flags into a normalized object:

- `ParsedShimFlags` → `ResolvedInvocation` (mode, prompt, session, requests, passthrough)

But the translation layer currently **does not consume that object**; it just rehydrates shim flags.

Missing: a formal translation input/output model that can be passed through a translation layer and drive the final argv for the agent.

### 4) Mode-specific command shapes
Some agents require different commands/flags in one-shot vs interactive mode:

- Codex: `codex exec <prompt>` for one-shot; `codex` for interactive
- Claude/Gemini: `-p` vs interactive, plus output flags that are different per agent

The translation API must be able to branch based on `mode` and `prompt`.

### 5) Tests that validate real translations
Current tests only verify that shim flags are parsed and forwarded, and they stub spawn.

We need tests that assert the **actual argv** for each agent, and ideally a small set of integration tests (or snapshot tests) that verify translation outputs for:

- `--output json` per agent
- `--web on` per agent
- `--approval`/`--sandbox` per agent
- one-shot vs interactive command shapes

## Summary of what remains

To achieve per-agent configuration via the config API, we still need:

- A config surface that can define per-agent CLI translation behavior.
- A translation layer that consumes the normalized shim invocation instead of reusing shim flags.
- Mode-aware translation (interactive vs one-shot) for agents with different command shapes.
- Tests that assert the translated argv per agent (not just the parsed shim flags).

## Proposed CLI translation API (per-target)

### Understanding
- The shim already resolves `ResolvedInvocation`, but the translation still re-emits shim flags.
- Real CLIs require mode-aware command shapes and per-agent flags (ex: Codex uses
  `codex exec <prompt>` with `--ask-for-approval`, `--search`, `--json`).

### Config surface
Add `cli` to `TargetDefinition` and `ResolvedTarget` so built-ins and overrides can define
translation rules in the same config API.

```ts
export type InvocationMode = "interactive" | "one-shot";
export type ApprovalPolicy = "prompt" | "auto-edit" | "yolo";
export type SandboxMode = "workspace-write" | "off";
export type OutputFormat = "text" | "json" | "stream-json";

export type ModeCommand = {
	command: string;
	args?: string[];
};

export type PromptSpec =
	| { type: "flag"; flag: string[] }
	| { type: "positional"; position?: "last" | "first" };

export type FlagMap<T extends string> = {
	values?: Partial<Record<T, string[] | null>>;
	byMode?: Partial<Record<InvocationMode, Partial<Record<T, string[] | null>>>>;
};

export type TargetCliDefinition = {
	modes: {
		interactive: ModeCommand;
		oneShot: ModeCommand;
	};
	prompt?: PromptSpec;
	flags?: {
		approval?: FlagMap<ApprovalPolicy>;
		sandbox?: FlagMap<SandboxMode>;
		output?: FlagMap<OutputFormat>;
		model?: { flag: string[]; modes?: InvocationMode[] };
		web?: { on?: string[] | null; off?: string[] | null; modes?: InvocationMode[] };
	};
	passthrough?: { position?: "after" | "before-prompt" };
	translate?: (invocation: ResolvedInvocation) => TranslationResult;
};

export type TranslationResult = {
	command: string;
	args: string[];
	warnings: string[];
};
```

### Translation rules
- Select `modes[invocation.mode]` for base command/args.
- Apply shared flag requests in a fixed order (approval, sandbox, output, model, web).
- If a requested value maps to `null` or is missing, emit the existing
  "does not support ..." warning.
- Place one-shot prompts via `prompt`:
  - `flag`: add `flag` + prompt value.
  - `positional`: append prompt; keep passthrough args before prompt if needed.
- Append passthrough args based on `passthrough.position`.

### Example: Codex target

```ts
export const codexTarget: TargetDefinition = {
	id: "codex",
	displayName: "OpenAI Codex",
	outputs: { /* existing outputs */ },
	cli: {
		modes: {
			interactive: { command: "codex" },
			oneShot: { command: "codex", args: ["exec"] },
		},
		prompt: { type: "positional", position: "last" },
		passthrough: { position: "before-prompt" },
		flags: {
			approval: {
				values: {
					prompt: ["--ask-for-approval", "on-request"],
					"auto-edit": ["--full-auto"],
					yolo: ["--yolo"],
				},
			},
			sandbox: {
				values: {
					"workspace-write": ["--sandbox", "workspace-write"],
					off: ["--sandbox", "off"],
				},
			},
			output: {
				values: {
					text: [],
					json: ["--json"],
					"stream-json": ["--json"],
				},
			},
			model: { flag: ["-m"] },
			web: { on: ["--search"], off: [] },
		},
	},
};
```

### Notes for other agents (high-level)
- Claude: `claude` interactive; one-shot uses `-p`; output uses `--output-format`;
  no native web (warn on `--web`).
- Gemini: `gemini` interactive; one-shot uses `-p` (or exec flag);
  output via `--output-format`; web supported.
- Copilot: one-shot `-p`; no model/web; map `yolo` to `--allow-all-tools` and warn for others.
