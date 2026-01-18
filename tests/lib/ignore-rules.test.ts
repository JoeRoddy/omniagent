import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	appendIgnoreRules,
	buildAgentsIgnoreRules,
	getIgnoreRuleStatus,
	LOCAL_OVERRIDE_IGNORE_RULES,
} from "../../src/lib/ignore-rules.js";

async function withTempRepo(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-ignore-rules-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("ignore rule helpers", () => {
	it("reports missing rules and appends them when requested", async () => {
		await withTempRepo(async (root) => {
			const rules = buildAgentsIgnoreRules(root);
			const status = await getIgnoreRuleStatus(root, { rules });
			expect(status.ignoreFilePath).toBe(path.join(root, ".gitignore"));
			expect(status.missingRules).toEqual([...rules]);

			await appendIgnoreRules(root, { rules });
			const contents = await readFile(path.join(root, ".gitignore"), "utf8");
			expect(contents).toContain("# omniagent local overrides");
			for (const rule of rules) {
				expect(contents).toContain(rule);
			}

			const updated = await getIgnoreRuleStatus(root, { rules });
			expect(updated.missingRules).toEqual([]);
		});
	});

	it("does not duplicate existing ignore rules", async () => {
		await withTempRepo(async (root) => {
			const ignorePath = path.join(root, ".gitignore");
			const rules = buildAgentsIgnoreRules(root);
			const initial = `${["# existing", ...rules].join("\n")}\n`;
			await writeFile(ignorePath, initial, "utf8");

			const status = await getIgnoreRuleStatus(root, { rules });
			expect(status.missingRules).toEqual([]);

			await appendIgnoreRules(root, { rules });
			const contents = await readFile(ignorePath, "utf8");
			expect(contents).toBe(initial);
		});
	});

	it("builds ignore rules from the override path inside the repo", async () => {
		await withTempRepo(async (root) => {
			const rules = buildAgentsIgnoreRules(root, "custom-agents");

			expect(rules[0]).toBe("custom-agents/.local/");
			expect(rules.slice(1)).toEqual([...LOCAL_OVERRIDE_IGNORE_RULES]);
		});
	});

	it("omits the root ignore rule when override is outside the repo", async () => {
		await withTempRepo(async (root) => {
			const outside = path.join(os.tmpdir(), "omniagent-outside-agents");
			const rules = buildAgentsIgnoreRules(root, outside);

			expect(rules).toEqual([...LOCAL_OVERRIDE_IGNORE_RULES]);
		});
	});
});
