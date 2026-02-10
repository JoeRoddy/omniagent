import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	assertExitCode,
	CLI_EXISTS,
	DEFAULT_TIMEOUT_MS,
	ENABLE_E2E_SYNC,
	parseJsonSummary,
	pathExists,
	runBuiltSync,
	SYNC_E2E_SUITE,
	toPortablePathPattern,
	withTempRepo,
	writeCommandTemplate,
	writeInstructionTemplate,
} from "./template-scripts.e2e.helpers.js";

SYNC_E2E_SUITE("sync template scripts nodejs e2e", () => {
	if (!ENABLE_E2E_SYNC || !CLI_EXISTS) {
		return;
	}

	it(
		"renders nodejs script blocks via dist/cli.js",
		async () => {
			await withTempRepo(async (context) => {
				await writeCommandTemplate(
					context.root,
					"nodejs-scripted",
					["Before", "<nodejs>", "return 'dynamic-nodejs-content';", "</nodejs>", "After"].join(
						"\n",
					),
				);

				const result = runBuiltSync(context, ["--only", "claude", "--yes"]);
				assertExitCode(result, 0);

				const outputPath = path.join(context.root, ".claude", "commands", "nodejs-scripted.md");
				expect(await pathExists(outputPath)).toBe(true);
				const output = await readFile(outputPath, "utf8");
				expect(output).toContain("Before");
				expect(output).toContain("dynamic-nodejs-content");
				expect(output).toContain("After");
				expect(output).not.toContain("<nodejs>");
			});
		},
		DEFAULT_TIMEOUT_MS,
	);

	it(
		"fails before writing managed outputs when nodejs script evaluation fails",
		async () => {
			await withTempRepo(async (context) => {
				await writeCommandTemplate(context.root, "static", "safe command");
				await writeCommandTemplate(
					context.root,
					"failing-nodejs",
					["Before", "<nodejs>", "throw new Error('boom');", "</nodejs>", "After"].join("\n"),
				);

				const result = runBuiltSync(context, ["--only", "claude", "--json", "--yes"]);
				assertExitCode(result, 1);

				const parsed = parseJsonSummary(result);
				expect(parsed.status).toBe("failed");
				expect(typeof parsed.failedBlockId).toBe("string");
				expect((parsed.failedBlockId ?? "").length).toBeGreaterThan(0);
				expect(parsed.failedTemplatePath ?? "").toMatch(
					toPortablePathPattern("agents/commands/failing-nodejs.md"),
				);
				expect(parsed.partialOutputsWritten).toBe(false);

				expect(await pathExists(path.join(context.root, ".claude", "commands", "static.md"))).toBe(
					false,
				);
				expect(
					await pathExists(path.join(context.root, ".claude", "commands", "failing-nodejs.md")),
				).toBe(false);
			});
		},
		DEFAULT_TIMEOUT_MS,
	);

	it(
		"does not warn about missing outPutPath for instruction templates in managed source dirs",
		async () => {
			await withTempRepo(async (context) => {
				await writeInstructionTemplate(
					context.root,
					path.join("agents", "skills", "embedded", "AGENTS.md"),
					"Managed directory template marker",
				);
				await writeCommandTemplate(context.root, "static", "safe command");

				const result = runBuiltSync(context, ["--only", "claude", "--yes"]);
				assertExitCode(result, 0);

				const combinedOutput = `${result.stdout}\n${result.stderr}`;
				expect(combinedOutput).not.toContain("Instruction template missing outPutPath");
				expect(combinedOutput).not.toMatch(
					toPortablePathPattern("agents/skills/embedded/AGENTS.md"),
				);
			});
		},
		DEFAULT_TIMEOUT_MS,
	);

	it(
		"retains missing outPutPath warnings for unsupported nested instruction dirs",
		async () => {
			await withTempRepo(async (context) => {
				await writeInstructionTemplate(
					context.root,
					path.join("agents", "custom", "missing.AGENTS.md"),
					"Missing output path",
				);

				const result = runBuiltSync(context, ["--only", "claude", "--yes"]);
				assertExitCode(result, 0);

				const combinedOutput = `${result.stdout}\n${result.stderr}`;
				expect(combinedOutput).toContain("Instruction template missing outPutPath");
				expect(combinedOutput).toMatch(toPortablePathPattern("agents/custom/missing.AGENTS.md"));
			});
		},
		DEFAULT_TIMEOUT_MS,
	);
});
