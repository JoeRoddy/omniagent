import { createTargetNameResolver, resolveFrontmatterTargets } from "../../src/lib/sync-targets.js";

describe("frontmatter target resolution", () => {
	it("matches targets case-insensitively and ignores duplicates", () => {
		const resolver = createTargetNameResolver([
			{ id: "claude" },
			{ id: "codex" },
			{ id: "gemini" },
		]);

		const { targets, invalidTargets } = resolveFrontmatterTargets(
			[["ClAuDe", "CLAUDE"], "codex"],
			resolver.resolveTargetName,
		);

		expect(invalidTargets).toEqual([]);
		expect(targets).toEqual(["claude", "codex"]);
	});

	it("combines targets and targetAgents values into a single set", () => {
		const resolver = createTargetNameResolver([
			{ id: "claude" },
			{ id: "codex" },
			{ id: "gemini" },
		]);

		const { targets } = resolveFrontmatterTargets(
			["claude", ["gemini", "CLAUDE"]],
			resolver.resolveTargetName,
		);

		expect(targets).toEqual(["claude", "gemini"]);
	});
});
