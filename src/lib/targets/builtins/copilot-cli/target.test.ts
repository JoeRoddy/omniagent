import path from "node:path";
import {
	normalizeCommandOutputDefinition,
	normalizeInstructionOutputDefinition,
	normalizeOutputDefinition,
	resolveCommandOutputPath,
	resolveInstructionFilename,
	resolveOutputPath,
} from "../../output-resolver.js";
import { copilotTarget } from "./target.js";

function expectDefined<T>(value: T | null | undefined, label: string): T {
	expect(value, `${label} should be defined`).toBeDefined();
	if (value == null) {
		throw new Error(`${label} is undefined`);
	}
	return value;
}

describe("copilot builtin target", () => {
	const repoRoot = path.resolve("copilot-repo");
	const homeDir = path.resolve("copilot-home");
	const agentsDir = path.join(repoRoot, "agents");
	const itemName = "helper";
	const context = {
		repoRoot,
		homeDir,
		agentsDir,
		targetId: "copilot",
		itemName,
	};

	it("defines core metadata", () => {
		expect(copilotTarget.id).toBe("copilot");
		expect(copilotTarget.displayName).toBe("GitHub Copilot CLI");
	});

	it("routes skills to .github/skills", () => {
		const skills = expectDefined(
			normalizeOutputDefinition(copilotTarget.outputs?.skills),
			"skills",
		);
		expect(skills.path).toBe("{repoRoot}/.github/skills/{itemName}");
		const skillsPath = resolveOutputPath({
			template: skills.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(skillsPath).toBe(path.join(repoRoot, ".github", "skills", itemName));
	});

	it("writes subagents to project agents directory", () => {
		const subagents = expectDefined(
			normalizeOutputDefinition(copilotTarget.outputs?.subagents),
			"subagents",
		);
		expect(subagents.path).toBe("{repoRoot}/.github/agents/{itemName}.agent.md");
		expect(subagents.fallback).toBeUndefined();
		const subagentPath = resolveOutputPath({
			template: subagents.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(subagentPath).toBe(path.join(repoRoot, ".github", "agents", `${itemName}.agent.md`));
	});

	it("maps commands to project agent files", () => {
		const commands = expectDefined(
			normalizeCommandOutputDefinition(copilotTarget.outputs?.commands),
			"commands",
		);
		expect(commands.projectPath).toBe("{repoRoot}/.github/agents/{itemName}.agent.md");
		expect(commands.userPath).toBeUndefined();
		expect(commands.fallback).toBeUndefined();
		const projectPath = expectDefined(commands.projectPath, "commands.projectPath");

		const projectCommandPath = resolveCommandOutputPath({
			template: projectPath,
			context: { ...context, commandLocation: "project" },
			item: {},
			baseDir: repoRoot,
		});
		expect(projectCommandPath).toBe(
			path.join(repoRoot, ".github", "agents", `${itemName}.agent.md`),
		);
	});

	it("writes instructions to AGENTS.md in the agents group", () => {
		const instructions = expectDefined(
			normalizeInstructionOutputDefinition(copilotTarget.outputs?.instructions),
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
