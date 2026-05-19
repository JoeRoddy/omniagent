import path from "node:path";
import {
	normalizeCommandOutputDefinition,
	normalizeInstructionOutputDefinition,
	normalizeOutputDefinition,
	resolveInstructionFilename,
	resolveOutputPath,
} from "../../output-resolver.js";
import { codexTarget } from "./target.js";

function expectDefined<T>(value: T | null | undefined, label: string): T {
	expect(value, `${label} should be defined`).toBeDefined();
	if (value == null) {
		throw new Error(`${label} is undefined`);
	}
	return value;
}

describe("codex builtin target", () => {
	const repoRoot = path.resolve("codex-repo");
	const homeDir = path.resolve("codex-home");
	const agentsDir = path.join(repoRoot, "agents");
	const itemName = "helper";
	const context = {
		repoRoot,
		homeDir,
		agentsDir,
		targetId: "codex",
		itemName,
	};

	it("defines core metadata", () => {
		expect(codexTarget.id).toBe("codex");
		expect(codexTarget.displayName).toBe("OpenAI Codex");
	});

	it("routes skills and subagents to .codex/skills with conversion fallback", () => {
		const skills = expectDefined(normalizeOutputDefinition(codexTarget.outputs?.skills), "skills");
		expect(skills.path).toBe("{repoRoot}/.codex/skills/{itemName}");
		const skillsPath = resolveOutputPath({
			template: skills.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(skillsPath).toBe(path.join(repoRoot, ".codex", "skills", itemName));

		const subagents = expectDefined(
			normalizeOutputDefinition(codexTarget.outputs?.subagents),
			"subagents",
		);
		expect(subagents.path).toBe("{repoRoot}/.codex/skills/{itemName}");
		expect(subagents.fallback).toEqual({ mode: "convert", targetType: "skills" });
		const subagentPath = resolveOutputPath({
			template: subagents.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(subagentPath).toBe(path.join(repoRoot, ".codex", "skills", itemName));
	});

	it("converts commands into skills", () => {
		const commands = expectDefined(
			normalizeCommandOutputDefinition(codexTarget.outputs?.commands),
			"commands",
		);
		expect(commands.projectPath).toBeUndefined();
		expect(commands.userPath).toBeUndefined();
		expect(commands.fallback).toEqual({ mode: "convert", targetType: "skills" });
	});

	it("writes instructions to AGENTS.md in the agents group", () => {
		const instructions = expectDefined(
			normalizeInstructionOutputDefinition(codexTarget.outputs?.instructions),
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
});
