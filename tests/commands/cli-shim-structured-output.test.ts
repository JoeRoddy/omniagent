import type { StdioOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InvalidUsageError } from "../../src/cli/shim/errors.js";
import {
	cleanupStructuredOutput,
	planStructuredOutput,
	resolveOutputSchema,
	runShim,
} from "../../src/cli/shim/index.js";
import { claudeTarget } from "../../src/lib/targets/builtins/claude-code/target.js";
import { codexTarget } from "../../src/lib/targets/builtins/codex/target.js";

const SCHEMA = {
	type: "object",
	properties: { answer: { type: "string" } },
	required: ["answer"],
	additionalProperties: false,
};
const SCHEMA_JSON = JSON.stringify(SCHEMA);

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(path.join(os.tmpdir(), "oa-schema-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("resolveOutputSchema", () => {
	it("accepts inline JSON objects and canonicalizes them", async () => {
		const resolved = await resolveOutputSchema(`  {"type": "object",\n "properties": {}}  `);
		expect(resolved).toBe(JSON.stringify({ type: "object", properties: {} }));
	});

	it("reads schemas from a file path", async () => {
		const schemaPath = path.join(tempDir, "schema.json");
		await writeFile(schemaPath, JSON.stringify(SCHEMA, null, 2), "utf8");
		const resolved = await resolveOutputSchema(schemaPath);
		expect(resolved).toBe(SCHEMA_JSON);
	});

	it("rejects inline JSON arrays", async () => {
		await expect(resolveOutputSchema('["not", "an", "object"]')).rejects.toThrow(
			"schema must be a JSON object",
		);
	});

	it("rejects invalid inline JSON", async () => {
		await expect(resolveOutputSchema("{not json")).rejects.toThrow(
			"Invalid value for --output-schema",
		);
	});

	it("rejects unreadable schema files", async () => {
		const missing = path.join(tempDir, "missing.json");
		await expect(resolveOutputSchema(missing)).rejects.toThrow(
			`cannot read schema file ${missing}`,
		);
	});

	it("rejects schema files that are not JSON objects", async () => {
		const schemaPath = path.join(tempDir, "scalar.json");
		await writeFile(schemaPath, '"just a string"', "utf8");
		await expect(resolveOutputSchema(schemaPath)).rejects.toThrow("schema must be a JSON object");
	});

	it("throws InvalidUsageError for all failures", async () => {
		await expect(resolveOutputSchema("{oops")).rejects.toBeInstanceOf(InvalidUsageError);
	});
});

describe("planStructuredOutput", () => {
	it("returns null when no schema was requested", async () => {
		const plan = await planStructuredOutput({
			rawSchema: null,
			mode: "one-shot",
			agentId: "claude",
			spec: claudeTarget.cli?.flags?.structuredOutput,
		});
		expect(plan).toBeNull();
	});

	it("falls back to a prompt-based plan for agents without a native spec", async () => {
		const plan = await planStructuredOutput({
			rawSchema: SCHEMA_JSON,
			mode: "one-shot",
			agentId: "agy",
			spec: undefined,
		});
		expect(plan?.capture.type).toBe("fallback");
		expect(plan?.tempPaths).toEqual([]);
	});

	it("rejects interactive mode", async () => {
		await expect(
			planStructuredOutput({
				rawSchema: SCHEMA_JSON,
				mode: "interactive",
				agentId: "claude",
				spec: claudeTarget.cli?.flags?.structuredOutput,
			}),
		).rejects.toThrow("--output-schema requires one-shot mode");
	});

	it("builds inline delivery args for claude without temp files", async () => {
		const plan = await planStructuredOutput({
			rawSchema: SCHEMA_JSON,
			mode: "one-shot",
			agentId: "claude",
			spec: claudeTarget.cli?.flags?.structuredOutput,
			tempDir,
		});

		expect(plan?.args).toEqual(["--json-schema", SCHEMA_JSON, "--output-format", "json"]);
		expect(plan?.capture).toEqual({ type: "json-envelope", field: "structured_output" });
		expect(plan?.tempPaths).toEqual([]);
	});

	it("materializes a schema file and last-message path for codex", async () => {
		const plan = await planStructuredOutput({
			rawSchema: SCHEMA_JSON,
			mode: "one-shot",
			agentId: "codex",
			spec: codexTarget.cli?.flags?.structuredOutput,
			tempDir,
		});

		expect(plan?.args).toHaveLength(4);
		expect(plan?.args[0]).toBe("--output-schema");
		expect(plan?.args[1]).toMatch(/omniagent-schema-.*schema\.json$/);
		expect(plan?.args[2]).toBe("--output-last-message");
		expect(plan?.args[3]).toMatch(/omniagent-schema-.*last-message\.txt$/);
		expect(plan?.tempPaths).toHaveLength(1);

		const written = await stat(plan?.args[1] ?? "");
		expect(written.isFile()).toBe(true);
		expect(plan?.capture).toEqual({ type: "last-message-file", path: plan?.args[3] });
	});

	it("cleans up temp directories idempotently", async () => {
		const plan = await planStructuredOutput({
			rawSchema: SCHEMA_JSON,
			mode: "one-shot",
			agentId: "codex",
			spec: codexTarget.cli?.flags?.structuredOutput,
			tempDir,
		});

		await cleanupStructuredOutput(plan);
		await cleanupStructuredOutput(plan);
		await cleanupStructuredOutput(null);

		expect(await readdir(tempDir)).toEqual([]);
	});
});

describe("runShim with --output-schema", () => {
	function createSpawnStub(exitCode = 0) {
		return vi.fn((_command: string, _args: string[], _options: { stdio: StdioOptions }) => {
			const emitter = new EventEmitter();
			process.nextTick(() => {
				emitter.emit("exit", exitCode);
				emitter.emit("close", exitCode);
			});
			return emitter;
		});
	}

	function collectStderr() {
		const writes: string[] = [];
		const stderr = {
			write: (chunk: string | Uint8Array) => {
				writes.push(String(chunk));
				return true;
			},
		} as NodeJS.WriteStream;
		return { writes, stderr };
	}

	it.each([
		["agy", '{"answer":"hi"}'],
		["copilot", '{"answer":"hi"}'],
	])("runs the prompt fallback for %s", async (agent, response) => {
		const { writes, stderr } = collectStderr();
		const stdoutWrites: string[] = [];
		const stdout = {
			write: (chunk: string | Uint8Array) => {
				stdoutWrites.push(String(chunk));
				return true;
			},
		} as NodeJS.WriteStream;
		const spawn = vi.fn((_command: string, _args: string[], _options: { stdio: StdioOptions }) => {
			const childStdout = new EventEmitter();
			const child = Object.assign(new EventEmitter(), { stdout: childStdout });
			process.nextTick(() => {
				childStdout.emit("data", Buffer.from(response));
				child.emit("close", 0);
			});
			return child;
		});

		const exitCode = await runShim(
			["--agent", agent, "-p", "Hello", "--output-schema", SCHEMA_JSON],
			{ stdinIsTTY: true, stderr, stdout, spawn, repoRoot: process.cwd(), tempDir },
		);

		expect(exitCode).toBe(0);
		expect(stdoutWrites).toEqual(['{"answer":"hi"}\n']);
		expect(writes.join("")).toContain(
			`Notice: ${agent} lacks native --output-schema support; using prompt-based fallback with client-side validation.`,
		);
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("fails with exit 2 in interactive mode", async () => {
		const { writes, stderr } = collectStderr();
		const spawn = createSpawnStub(0);

		const exitCode = await runShim(["--agent", "claude", "--output-schema", SCHEMA_JSON], {
			stdinIsTTY: true,
			stderr,
			spawn,
			repoRoot: process.cwd(),
			tempDir,
		});

		expect(exitCode).toBe(2);
		expect(writes.join("")).toContain("--output-schema requires one-shot mode");
		expect(spawn).not.toHaveBeenCalled();
	});

	it("fails with exit 2 when combined with explicit output flags", async () => {
		for (const conflicting of [
			["--output", "json"],
			["--output", "text"],
			["--json"],
			["--stream-json"],
		]) {
			const { writes, stderr } = collectStderr();
			const exitCode = await runShim(
				["--agent", "claude", "-p", "Hello", "--output-schema", SCHEMA_JSON, ...conflicting],
				{ stdinIsTTY: true, stderr, repoRoot: process.cwd(), tempDir },
			);

			expect(exitCode).toBe(2);
			expect(writes.join("")).toContain(
				"--output-schema cannot be combined with --output, --json, or --stream-json.",
			);
		}
	});

	it("removes temp directories after a codex run", async () => {
		const { stderr } = collectStderr();
		const spawn = createSpawnStub(0);

		const exitCode = await runShim(
			["--agent", "codex", "-p", "Hello", "--output-schema", SCHEMA_JSON],
			{ stdinIsTTY: true, stderr, spawn, repoRoot: process.cwd(), tempDir },
		);

		expect(exitCode).toBe(1);
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(await readdir(tempDir)).toEqual([]);
	});
});
