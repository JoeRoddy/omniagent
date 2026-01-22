import path from "node:path";
import {
	normalizeCommandOutputDefinition,
	normalizeInstructionOutputDefinition,
	normalizeOutputDefinition,
	resolveCommandOutputPath,
	resolveInstructionFilename,
	resolveOutputPath,
} from "../../output-resolver.js";
import { geminiTarget } from "./target.js";

function expectDefined<T>(value: T | null | undefined, label: string): T {
	expect(value, `${label} should be defined`).toBeDefined();
	if (value == null) {
		throw new Error(`${label} is undefined`);
	}
	return value;
}

describe("gemini builtin target", () => {
	const repoRoot = path.resolve("gemini-repo");
	const homeDir = path.resolve("gemini-home");
	const agentsDir = path.join(repoRoot, "agents");
	const itemName = "helper";
	const context = {
		repoRoot,
		homeDir,
		agentsDir,
		targetId: "gemini",
		itemName,
	};

	it("defines core metadata", () => {
		expect(geminiTarget.id).toBe("gemini");
		expect(geminiTarget.displayName).toBe("Gemini CLI");
	});

	it("routes skills and subagents to .gemini/skills with conversion fallback", () => {
		const skills = expectDefined(normalizeOutputDefinition(geminiTarget.outputs?.skills), "skills");
		expect(skills.path).toBe("{repoRoot}/.gemini/skills/{itemName}");
		const skillsPath = resolveOutputPath({
			template: skills.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(skillsPath).toBe(path.join(repoRoot, ".gemini", "skills", itemName));

		const subagents = expectDefined(
			normalizeOutputDefinition(geminiTarget.outputs?.subagents),
			"subagents",
		);
		expect(subagents.path).toBe("{repoRoot}/.gemini/skills/{itemName}");
		expect(subagents.fallback).toEqual({ mode: "convert", targetType: "skills" });
		const subagentPath = resolveOutputPath({
			template: subagents.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(subagentPath).toBe(path.join(repoRoot, ".gemini", "skills", itemName));
	});

	it("writes commands to project and user command folders", () => {
		const commands = expectDefined(
			normalizeCommandOutputDefinition(geminiTarget.outputs?.commands),
			"commands",
		);
		expect(commands.projectPath).toBe("{repoRoot}/.gemini/commands/{itemName}.toml");
		expect(commands.userPath).toBe("{homeDir}/.gemini/commands/{itemName}.toml");
		const projectPath = expectDefined(commands.projectPath, "commands.projectPath");

		const projectCommandPath = resolveCommandOutputPath({
			template: projectPath,
			context: { ...context, commandLocation: "project" },
			item: {},
			baseDir: repoRoot,
		});
		expect(projectCommandPath).toBe(path.join(repoRoot, ".gemini", "commands", `${itemName}.toml`));

		const userPath = expectDefined(commands.userPath, "commands.userPath");
		const userCommandPath = resolveCommandOutputPath({
			template: userPath,
			context: { ...context, commandLocation: "user" },
			item: {},
			baseDir: homeDir,
		});
		expect(userCommandPath).toBe(path.join(homeDir, ".gemini", "commands", `${itemName}.toml`));
	});

	it("writes instructions to GEMINI.md", () => {
		const instructions = expectDefined(
			normalizeInstructionOutputDefinition(geminiTarget.outputs?.instructions),
			"instructions",
		);
		expect(instructions.filename).toBe("GEMINI.md");
		expect(instructions.group).toBeUndefined();
		const filename = resolveInstructionFilename({
			template: instructions.filename,
			context,
			item: {},
		});
		expect(filename).toBe("GEMINI.md");
	});
});
