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
	shellFailureScript,
	withTempRepo,
	writeCommandTemplate,
	writeSkillTemplate,
} from "./template-scripts.e2e.helpers.js";

SYNC_E2E_SUITE("sync template scripts shell e2e", () => {
	if (!ENABLE_E2E_SYNC || !CLI_EXISTS) {
		return;
	}

	it(
		"renders shell script blocks via dist/cli.js",
		async () => {
			await withTempRepo(async (context) => {
				await writeSkillTemplate(
					context.root,
					"shell-scripted",
					["Before", "<shell>", "echo dynamic-shell-content", "</shell>", "After"].join("\n"),
				);

				const result = runBuiltSync(context, ["--only", "claude", "--yes"]);
				assertExitCode(result, 0);

				const outputPath = path.join(
					context.root,
					".claude",
					"skills",
					"shell-scripted",
					"SKILL.md",
				);
				expect(await pathExists(outputPath)).toBe(true);
				const output = await readFile(outputPath, "utf8");
				expect(output).toContain("Before");
				expect(output).toContain("dynamic-shell-content");
				expect(output).toContain("After");
				expect(output).not.toContain("<shell>");
			});
		},
		DEFAULT_TIMEOUT_MS,
	);

	it(
		"fails before writing managed outputs when shell script evaluation fails",
		async () => {
			await withTempRepo(async (context) => {
				await writeCommandTemplate(context.root, "static", "safe command");
				await writeSkillTemplate(
					context.root,
					"failing-shell-skill",
					["Before", "<shell>", shellFailureScript(), "</shell>", "After"].join("\n"),
				);

				const result = runBuiltSync(context, ["--only", "claude", "--json", "--yes"]);
				assertExitCode(result, 1);

				const parsed = parseJsonSummary(result);
				expect(parsed.status).toBe("failed");
				expect(typeof parsed.failedBlockId).toBe("string");
				expect((parsed.failedBlockId ?? "").length).toBeGreaterThan(0);
				expect(parsed.partialOutputsWritten).toBe(false);

				expect(await pathExists(path.join(context.root, ".claude", "commands", "static.md"))).toBe(
					false,
				);
				expect(
					await pathExists(
						path.join(context.root, ".claude", "skills", "failing-shell-skill", "SKILL.md"),
					),
				).toBe(false);
			});
		},
		DEFAULT_TIMEOUT_MS,
	);
});
