import os from "node:os";
import path from "node:path";
import {
	normalizeCommandOutputDefinition,
	normalizeInstructionOutputDefinition,
	normalizeOutputDefinition,
	resolveCommandOutputPath,
	resolveInstructionFilename,
	resolveOutputPath,
} from "../../../src/lib/targets/output-resolver.js";

const repoRoot = path.join(os.tmpdir(), "omniagent-output-resolver");
const agentsDir = path.join(repoRoot, "agents");
const homeDir = path.join(repoRoot, "home");

const contextBase = {
	repoRoot,
	agentsDir,
	homeDir,
	targetId: "acme",
};

describe("output definition normalization", () => {
	it("normalizes short-form output definitions", () => {
		expect(normalizeOutputDefinition("{repoRoot}/out")).toEqual({
			path: "{repoRoot}/out",
		});
		expect(normalizeCommandOutputDefinition("{repoRoot}/commands")).toEqual({
			projectPath: "{repoRoot}/commands",
		});
		expect(normalizeInstructionOutputDefinition("AGENTS.md")).toEqual({
			filename: "AGENTS.md",
		});
	});

	it("preserves long-form output definitions", () => {
		const output = { path: "{repoRoot}/skills/{itemName}", writer: { id: "writer" } };
		const command = { projectPath: "{repoRoot}/commands", userPath: "{homeDir}/commands" };
		const instruction = { filename: "{targetId}.md", group: "shared" };

		expect(normalizeOutputDefinition(output)).toEqual(output);
		expect(normalizeCommandOutputDefinition(command)).toEqual(command);
		expect(normalizeInstructionOutputDefinition(instruction)).toEqual(instruction);
	});
});

describe("output path resolution", () => {
	it("resolves placeholders for skill outputs", () => {
		const resolved = resolveOutputPath({
			template: "{repoRoot}/out/{targetId}/{itemName}",
			context: {
				...contextBase,
				itemName: "alpha",
			},
			item: { name: "alpha" },
			baseDir: repoRoot,
		});

		expect(resolved).toBe(path.join(repoRoot, "out", "acme", "alpha"));
	});

	it("resolves relative output paths against the base directory", () => {
		const resolved = resolveOutputPath({
			template: "outputs/{itemName}",
			context: {
				...contextBase,
				itemName: "beta",
			},
			item: { name: "beta" },
			baseDir: repoRoot,
		});

		expect(resolved).toBe(path.join(repoRoot, "outputs", "beta"));
	});

	it("resolves command outputs with commandLocation placeholders", () => {
		const resolved = resolveCommandOutputPath({
			template: "{commandLocation}/{itemName}.md",
			context: {
				...contextBase,
				itemName: "hello",
				commandLocation: "project",
			},
			item: { name: "hello" },
			baseDir: repoRoot,
		});

		expect(resolved).toBe(path.join(repoRoot, "project", "hello.md"));
	});

	it("resolves instruction filenames with dynamic templates", () => {
		const filename = resolveInstructionFilename({
			template: "nested/{itemName}.md",
			context: {
				...contextBase,
				itemName: "team",
			},
			item: { name: "team" },
		});

		expect(filename).toBe(path.join("nested", "team.md"));
	});

	it("supports dynamic output rules via template functions", () => {
		const resolved = resolveOutputPath({
			template: (_item, context) => `${context.repoRoot}/dynamic/${context.targetId}`,
			context: {
				...contextBase,
				itemName: "gamma",
			},
			item: { name: "gamma" },
			baseDir: repoRoot,
		});

		expect(resolved).toBe(path.join(repoRoot, "dynamic", "acme"));
	});
});
