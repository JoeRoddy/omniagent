import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import {
	createTemplateScriptRuntime,
	evaluateTemplateScripts,
	listTemplateScriptExecutions,
	TemplateScriptExecutionError,
} from "../../src/lib/template-scripts.js";

describe("template script runtime", () => {
	it("evaluates script blocks in source order", async () => {
		const runtime = createTemplateScriptRuntime();
		const rendered = await evaluateTemplateScripts({
			templatePath: "agents/commands/example.md",
			content: "Start\n<nodejs>return 'one';</nodejs>\nMiddle\n<nodejs>return 'two';</nodejs>\nEnd",
			runtime,
		});

		expect(rendered).toContain("Start\none\nMiddle\ntwo\nEnd");
		const executions = listTemplateScriptExecutions(runtime);
		expect(executions).toHaveLength(2);
		expect(executions[0]).toMatchObject({
			blockId: "agents/commands/example.md#0",
			status: "succeeded",
			reusedAcrossTargets: false,
		});
		expect(executions[1]).toMatchObject({
			blockId: "agents/commands/example.md#1",
			status: "succeeded",
			reusedAcrossTargets: false,
		});
	});

	it("normalizes return values", async () => {
		const runtime = createTemplateScriptRuntime();
		const rendered = await evaluateTemplateScripts({
			templatePath: "agents/commands/types.md",
			content: [
				"<nodejs>return { hello: 'world' };</nodejs>",
				"<nodejs>return 42;</nodejs>",
				"<nodejs>return null;</nodejs>",
			].join("\n"),
			runtime,
		});

		expect(rendered).toContain('{"hello":"world"}');
		expect(rendered).toContain("42");
		expect(rendered).not.toContain("null");

		const executions = listTemplateScriptExecutions(runtime);
		expect(executions.map((entry) => entry.resultKind)).toEqual(["json", "coerced", "empty"]);
	});

	it("uses repo state and reuses cached results across evaluations", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-template-scripts-"));
		try {
			await writeFile(path.join(root, "marker.txt"), "0", "utf8");
			const runtime = createTemplateScriptRuntime({ cwd: root });
			const templatePath = path.join(root, "agents", "commands", "stateful.md");
			const content = [
				"<nodejs>",
				'const fs = await import("node:fs/promises");',
				'const markerPath = "marker.txt";',
				'const current = Number(await fs.readFile(markerPath, "utf8"));',
				"const next = current + 1;",
				'await fs.writeFile(markerPath, String(next), "utf8");',
				"return String(next);",
				"</nodejs>",
			].join("\n");

			const first = await evaluateTemplateScripts({ templatePath, content, runtime });
			const second = await evaluateTemplateScripts({ templatePath, content, runtime });

			expect(first).toBe("1");
			expect(second).toBe("1");
			expect(await readFile(path.join(root, "marker.txt"), "utf8")).toBe("1");

			const executions = listTemplateScriptExecutions(runtime);
			expect(executions).toHaveLength(1);
			expect(executions[0]?.reusedAcrossTargets).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("uses fresh repository state across separate sync runs", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-template-scripts-state-"));
		try {
			await writeFile(path.join(root, "value.txt"), "first", "utf8");
			const content = [
				"<nodejs>",
				'const fs = await import("node:fs/promises");',
				'return (await fs.readFile("value.txt", "utf8")).trim();',
				"</nodejs>",
			].join("\n");
			const templatePath = path.join(root, "agents", "commands", "state.md");

			const firstRun = await evaluateTemplateScripts({
				templatePath,
				content,
				runtime: createTemplateScriptRuntime({ cwd: root }),
			});
			expect(firstRun).toBe("first");

			await writeFile(path.join(root, "value.txt"), "second", "utf8");
			const secondRun = await evaluateTemplateScripts({
				templatePath,
				content,
				runtime: createTemplateScriptRuntime({ cwd: root }),
			});
			expect(secondRun).toBe("second");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("stops executing later script blocks after the first failure", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-template-scripts-failfast-"));
		try {
			const runtime = createTemplateScriptRuntime({ cwd: root });
			await expect(
				evaluateTemplateScripts({
					templatePath: "agents/commands/fail-fast.md",
					content: [
						"<nodejs>",
						"throw new Error('boom');",
						"</nodejs>",
						"<nodejs>",
						'const fs = await import("node:fs/promises");',
						'await fs.writeFile("should-not-exist.txt", "ran", "utf8");',
						"return 'late';",
						"</nodejs>",
					].join("\n"),
					runtime,
				}),
			).rejects.toBeInstanceOf(TemplateScriptExecutionError);

			await expect(readFile(path.join(root, "should-not-exist.txt"), "utf8")).rejects.toMatchObject(
				{
					code: "ENOENT",
				},
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("runs each block in an isolated runtime context", async () => {
		const runtime = createTemplateScriptRuntime();
		const rendered = await evaluateTemplateScripts({
			templatePath: "agents/commands/isolation.md",
			content: [
				"<nodejs>",
				"globalThis.__omniagentShared = 'set';",
				"return 'first';",
				"</nodejs>",
				"<nodejs>",
				"return String(globalThis.__omniagentShared ?? 'unset');",
				"</nodejs>",
			].join("\n"),
			runtime,
		});

		expect(rendered).toContain("first");
		expect(rendered).toContain("unset");
	});

	it("allows filesystem, network, and subprocess access inside scripts", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-template-scripts-capabilities-"));
		const server = createServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/plain" });
			response.end("network-ok");
		});
		try {
			const templatePath = path.join(root, "agents", "commands", "capabilities.md");
			await mkdir(path.dirname(templatePath), { recursive: true });
			await writeFile(path.join(path.dirname(templatePath), "capability.txt"), "file-ok", "utf8");
			await new Promise<void>((resolve) => {
				server.listen(0, "127.0.0.1", () => resolve());
			});
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("Expected server address with a numeric port.");
			}

			const runtime = createTemplateScriptRuntime({ cwd: root });
			const rendered = await evaluateTemplateScripts({
				templatePath,
				content: [
					"<nodejs>",
					'const fs = require("node:fs/promises");',
					'const { execFile } = require("node:child_process");',
					'const { promisify } = require("node:util");',
					'const path = require("node:path");',
					"const run = promisify(execFile);",
					'const fileValue = (await fs.readFile(path.join(__dirname, "capability.txt"), "utf8")).trim();',
					"const child = await run(process.execPath, [",
					"  '-e',",
					"  \"process.stdout.write('subprocess-ok')\",",
					"]);",
					`const response = await fetch("http://127.0.0.1:${address.port}/status");`,
					"const networkValue = (await response.text()).trim();",
					"return fileValue + '-' + child.stdout + '-' + networkValue;",
					"</nodejs>",
				].join("\n"),
				runtime,
			});

			expect(rendered).toBe("file-ok-subprocess-ok-network-ok");
		} finally {
			server.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	it("completes when scripts emit heavy stdout", async () => {
		const runtime = createTemplateScriptRuntime();
		const rendered = await evaluateTemplateScripts({
			templatePath: "agents/commands/noisy.md",
			content: [
				"<nodejs>",
				"for (let index = 0; index < 200_000; index += 1) {",
				"  console.log('line-' + index);",
				"}",
				"return 'done';",
				"</nodejs>",
			].join("\n"),
			runtime,
		});

		expect(rendered).toBe("done");
	}, 15_000);

	it("throws on invalid or nested script markup", async () => {
		const runtime = createTemplateScriptRuntime();
		await expect(
			evaluateTemplateScripts({
				templatePath: "agents/commands/bad.md",
				content: "<nodejs>return 'x';<nodejs>return 'y';</nodejs>",
				runtime,
			}),
		).rejects.toBeInstanceOf(TemplateScriptExecutionError);
	});

	it("emits still-running warnings without timing out long scripts", async () => {
		const runtime = createTemplateScriptRuntime({ heartbeatIntervalMs: 20 });
		const rendered = await evaluateTemplateScripts({
			templatePath: "agents/commands/slow.md",
			content: [
				"<nodejs>",
				"await new Promise((resolve) => setTimeout(resolve, 85));",
				"return 'done';",
				"</nodejs>",
			].join("\n"),
			runtime,
		});

		expect(rendered).toBe("done");
		expect(runtime.warnings.length).toBeGreaterThan(0);
		expect(runtime.warnings[0]?.code).toBe("still_running");
	});
});
