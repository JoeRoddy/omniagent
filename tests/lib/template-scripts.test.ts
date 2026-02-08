import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
			content:
				"Start\n<oa-script>return 'one';</oa-script>\nMiddle\n<oa-script>return 'two';</oa-script>\nEnd",
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
				"<oa-script>return { hello: 'world' };</oa-script>",
				"<oa-script>return 42;</oa-script>",
				"<oa-script>return null;</oa-script>",
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
				"<oa-script>",
				'const fs = await import("node:fs/promises");',
				'const markerPath = "marker.txt";',
				'const current = Number(await fs.readFile(markerPath, "utf8"));',
				"const next = current + 1;",
				'await fs.writeFile(markerPath, String(next), "utf8");',
				"return String(next);",
				"</oa-script>",
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

	it("throws on invalid or nested script markup", async () => {
		const runtime = createTemplateScriptRuntime();
		await expect(
			evaluateTemplateScripts({
				templatePath: "agents/commands/bad.md",
				content: "<oa-script>return 'x';<oa-script>return 'y';</oa-script>",
				runtime,
			}),
		).rejects.toBeInstanceOf(TemplateScriptExecutionError);
	});

	it("emits still-running warnings without timing out long scripts", async () => {
		const runtime = createTemplateScriptRuntime({ heartbeatIntervalMs: 20 });
		const rendered = await evaluateTemplateScripts({
			templatePath: "agents/commands/slow.md",
			content: [
				"<oa-script>",
				"await new Promise((resolve) => setTimeout(resolve, 85));",
				"return 'done';",
				"</oa-script>",
			].join("\n"),
			runtime,
		});

		expect(rendered).toBe("done");
		expect(runtime.warnings.length).toBeGreaterThan(0);
		expect(runtime.warnings[0]?.code).toBe("still_running");
	});
});
