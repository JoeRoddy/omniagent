import path from "node:path";
import {
	normalizeCommandOutputDefinition,
	normalizeInstructionOutputDefinition,
	normalizeOutputDefinition,
	resolveCommandOutputPath,
	resolveInstructionFilename,
	resolveOutputPath,
} from "../../output-resolver.js";
import { claudeTarget } from "./target.js";

function expectDefined<T>(value: T | null | undefined, label: string): T {
	expect(value, `${label} should be defined`).toBeDefined();
	if (value == null) {
		throw new Error(`${label} is undefined`);
	}
	return value;
}

describe("claude builtin target", () => {
	const repoRoot = path.resolve("claude-repo");
	const homeDir = path.resolve("claude-home");
	const agentsDir = path.join(repoRoot, "agents");
	const itemName = "helper";
	const context = {
		repoRoot,
		homeDir,
		agentsDir,
		targetId: "claude",
		itemName,
	};

	it("defines core metadata", () => {
		expect(claudeTarget.id).toBe("claude");
		expect(claudeTarget.displayName).toBe("Claude Code");
	});

	it("routes skills and subagents to .claude directories", () => {
		const skills = expectDefined(normalizeOutputDefinition(claudeTarget.outputs?.skills), "skills");
		expect(skills.path).toBe("{repoRoot}/.claude/skills/{itemName}");
		const skillsPath = resolveOutputPath({
			template: skills.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(skillsPath).toBe(path.join(repoRoot, ".claude", "skills", itemName));

		const subagents = expectDefined(
			normalizeOutputDefinition(claudeTarget.outputs?.subagents),
			"subagents",
		);
		expect(subagents.path).toBe("{repoRoot}/.claude/agents/{itemName}.md");
		expect(subagents.fallback).toBeUndefined();
		const subagentPath = resolveOutputPath({
			template: subagents.path,
			context,
			item: {},
			baseDir: repoRoot,
		});
		expect(subagentPath).toBe(path.join(repoRoot, ".claude", "agents", `${itemName}.md`));
	});

	it("writes commands to project and user command folders", () => {
		const commands = expectDefined(
			normalizeCommandOutputDefinition(claudeTarget.outputs?.commands),
			"commands",
		);
		expect(commands.projectPath).toBe("{repoRoot}/.claude/commands/{itemName}.md");
		expect(commands.userPath).toBe("{homeDir}/.claude/commands/{itemName}.md");
		const projectPath = expectDefined(commands.projectPath, "commands.projectPath");

		const projectCommandPath = resolveCommandOutputPath({
			template: projectPath,
			context: { ...context, commandLocation: "project" },
			item: {},
			baseDir: repoRoot,
		});
		expect(projectCommandPath).toBe(path.join(repoRoot, ".claude", "commands", `${itemName}.md`));

		const userPath = expectDefined(commands.userPath, "commands.userPath");
		const userCommandPath = resolveCommandOutputPath({
			template: userPath,
			context: { ...context, commandLocation: "user" },
			item: {},
			baseDir: homeDir,
		});
		expect(userCommandPath).toBe(path.join(homeDir, ".claude", "commands", `${itemName}.md`));
	});

	it("writes instructions to CLAUDE.md", () => {
		const instructions = expectDefined(
			normalizeInstructionOutputDefinition(claudeTarget.outputs?.instructions),
			"instructions",
		);
		expect(instructions.filename).toBe("CLAUDE.md");
		expect(instructions.group).toBeUndefined();
		const filename = resolveInstructionFilename({
			template: instructions.filename,
			context,
			item: {},
		});
		expect(filename).toBe("CLAUDE.md");
	});
});
