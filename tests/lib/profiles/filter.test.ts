import {
	createProfileItemFilter,
	emptyResolvedProfile,
	targetEnabledByProfile,
	type ResolvedProfile,
} from "../../../src/lib/profiles/index.js";

function profile(partial: Partial<ResolvedProfile>): ResolvedProfile {
	return {
		...emptyResolvedProfile(),
		...partial,
		names: partial.names ?? ["test"],
	};
}

describe("createProfileItemFilter", () => {
	it("is a passthrough when no profile is active", () => {
		const filter = createProfileItemFilter(null);
		expect(filter.enabled).toBe(false);
		expect(filter.includes("skills", "anything")).toBe(true);
		expect(filter.collectUnknownWarnings()).toEqual([]);
	});

	it("includes everything when enable/disable are empty", () => {
		const filter = createProfileItemFilter(profile({}));
		expect(filter.includes("skills", "anything")).toBe(true);
	});

	it("with enable set, only matching items pass", () => {
		const filter = createProfileItemFilter(
			profile({
				enable: { skills: ["review"], subagents: [], commands: [] },
			}),
		);
		expect(filter.includes("skills", "review")).toBe(true);
		expect(filter.includes("skills", "other")).toBe(false);
	});

	it("disable wins over enable", () => {
		const filter = createProfileItemFilter(
			profile({
				enable: { skills: ["code-review", "security-review"], subagents: [], commands: [] },
				disable: { skills: ["security-review"], subagents: [], commands: [] },
			}),
		);
		expect(filter.includes("skills", "code-review")).toBe(true);
		expect(filter.includes("skills", "security-review")).toBe(false);
	});

	it("supports * and ? globs", () => {
		const filter = createProfileItemFilter(
			profile({
				enable: { skills: ["review-*"], subagents: [], commands: [] },
			}),
		);
		expect(filter.includes("skills", "review-pr")).toBe(true);
		expect(filter.includes("skills", "review")).toBe(false);
	});

	it("warns for bare unknown names, silent for zero-match globs", () => {
		const filter = createProfileItemFilter(
			profile({
				enable: { skills: ["exists", "missing", "ghost-*"], subagents: [], commands: [] },
			}),
		);
		filter.includes("skills", "exists");
		const warnings = filter.collectUnknownWarnings();
		expect(warnings.some((w) => w.includes('"missing"'))).toBe(true);
		expect(warnings.some((w) => w.includes("ghost-"))).toBe(false);
	});
});

describe("targetEnabledByProfile", () => {
	it("returns true when no profile is active", () => {
		expect(targetEnabledByProfile(null, "claude")).toBe(true);
	});

	it("returns false when the profile disables the target", () => {
		const resolved = profile({ targets: { claude: { enabled: false } } });
		expect(targetEnabledByProfile(resolved, "claude")).toBe(false);
	});

	it("matches aliases case-insensitively", () => {
		const resolved = profile({ targets: { CLAUDE: { enabled: false } } });
		expect(targetEnabledByProfile(resolved, "claude", ["claude-code"])).toBe(false);
	});
});
