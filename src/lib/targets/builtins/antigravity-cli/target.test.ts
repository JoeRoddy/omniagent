import path from "node:path";
import {
	normalizeCommandOutputDefinition,
	normalizeInstructionOutputDefinition,
	normalizeOutputDefinition,
	resolveInstructionFilename,
	resolveOutputPath,
} from "../../output-resolver.js";
import { agyTarget } from "./target.js";

function expectDefined<T>(value: T | null | undefined, label: string): T {
	expect(value, `${label} should be defined`).toBeDefined();
	if (value == null) {
		throw new Error(`${label} is undefined`);
	}
	return value;
}

describe("agy builtin target", () => {
	const repoRoot = path.resolve("agy-repo");
	const homeDir = path.resolve("agy-home");
	const agentsDir = path.join(repoRoot, "agents");
	const itemName = "helper";
	const context = {
		repoRoot,
		homeDir,
		agentsDir,
		targetId: "agy",
		itemName,
	};

	it("defines core metadata with a gemini alias", () => {
		expect(agyTarget.id).toBe("agy");
		expect(agyTarget.displayName).toBe("Antigravity CLI");
		expect(agyTarget.aliases).toEqual(["gemini"]);
	});

	it("invokes the agy binary in both modes with a -p prompt flag", () => {
		expect(agyTarget.cli?.modes).toEqual({
			interactive: { command: "agy" },
			oneShot: { command: "agy" },
		});
		expect(agyTarget.cli?.prompt).toEqual({ type: "flag", flag: ["-p"] });
	});

	it("maps approval and sandbox flags to agy equivalents", () => {
		expect(agyTarget.cli?.flags?.approval).toEqual({
			values: {
				prompt: [],
				"auto-edit": null,
				yolo: ["--dangerously-skip-permissions"],
			},
		});
		expect(agyTarget.cli?.flags?.sandbox).toEqual({
			values: {
				"workspace-write": ["--sandbox"],
				off: [],
			},
		});
	});

	it("supports only text output and no web flag", () => {
		expect(agyTarget.cli?.flags?.output).toEqual({
			byMode: {
				"one-shot": {
					text: [],
					json: null,
					"stream-json": null,
				},
			},
		});
		expect(agyTarget.cli?.flags?.web).toBeUndefined();
	});

	it("does not declare structured output support", () => {
		expect(agyTarget.cli?.flags?.structuredOutput).toBeUndefined();
	});

	it("declares a plain-text structured output fallback", () => {
		expect(agyTarget.cli?.flags?.structuredOutputFallback).toEqual({
			extraction: { type: "text" },
		});
	});

	it("routes skills and subagents to .agents/skills with conversion fallback", () => {
		const skills = expectDefined(normalizeOutputDefinition(agyTarget.outputs?.skills), "skills");
		expect(skills.path).toBe("{repoRoot}/.agents/skills/{itemName}");
		const skillsPath = resolveOutputPath({
			template: skills.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(skillsPath).toBe(path.join(repoRoot, ".agents", "skills", itemName));

		const subagents = expectDefined(
			normalizeOutputDefinition(agyTarget.outputs?.subagents),
			"subagents",
		);
		expect(subagents.path).toBe("{repoRoot}/.agents/skills/{itemName}");
		expect(subagents.fallback).toEqual({ mode: "convert", targetType: "skills" });
		const subagentPath = resolveOutputPath({
			template: subagents.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(subagentPath).toBe(path.join(repoRoot, ".agents", "skills", itemName));
	});

	it("converts commands to skills instead of writing command files", () => {
		const commands = expectDefined(
			normalizeCommandOutputDefinition(agyTarget.outputs?.commands),
			"commands",
		);
		expect(commands.projectPath).toBeUndefined();
		expect(commands.userPath).toBeUndefined();
		expect(commands.fallback).toEqual({ mode: "convert", targetType: "skills" });
	});

	it("writes instructions to the shared AGENTS.md group", () => {
		const instructions = expectDefined(
			normalizeInstructionOutputDefinition(agyTarget.outputs?.instructions),
			"instructions",
		);
		expect(instructions.filename).toBe("AGENTS.md");
		expect(instructions.group).toBe("agents");
		const filename = resolveInstructionFilename({
			template: instructions.filename,
			context,
			item: {},
		});
		expect(filename).toBe("AGENTS.md");
	});

	it("declares weekly quota usage extraction", () => {
		expect(agyTarget.usage?.windows).toEqual(["weekly"]);
		expect(agyTarget.usage?.launch).toEqual({ command: "agy", timeoutMs: 70_000 });
		expect(typeof agyTarget.usage?.extract).toBe("function");
	});
});
