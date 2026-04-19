import {
	createProfileItemFilter,
	emptyResolvedProfile,
	type ResolvedProfile,
	targetEnabledByProfile,
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

	it("respects item defaults when no profile is active", () => {
		const filter = createProfileItemFilter(null);
		expect(
			filter.includes("skills", { canonicalName: "hidden-skill", enabledByDefault: false }),
		).toBe(false);
		expect(
			filter.includes("skills", { canonicalName: "visible-skill", enabledByDefault: true }),
		).toBe(true);
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

	it("lets profiles opt default-disabled items back in", () => {
		const filter = createProfileItemFilter(
			profile({
				enable: { skills: ["review"], subagents: [], commands: [] },
			}),
		);
		expect(filter.includes("skills", { canonicalName: "review", enabledByDefault: false })).toBe(
			true,
		);
	});

	it("still tracks bare disable matches outside the allowlist", () => {
		const filter = createProfileItemFilter(
			profile({
				enable: { skills: ["review"], subagents: [], commands: [] },
				disable: { skills: ["helper"], subagents: [], commands: [] },
			}),
		);
		filter.includes("skills", "review");
		filter.includes("skills", "helper");
		expect(filter.collectUnknownWarnings()).toEqual([]);
	});

	it("supports minimatch globs", () => {
		const filter = createProfileItemFilter(
			profile({
				enable: { skills: ["{review,debug}-*"], subagents: [], commands: [] },
			}),
		);
		expect(filter.includes("skills", "review-pr")).toBe(true);
		expect(filter.includes("skills", "debug-shell")).toBe(true);
		expect(filter.includes("skills", "other")).toBe(false);
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

	it("treats explicit enabled targets as an allowlist", () => {
		const resolved = profile({
			targets: {
				claude: { enabled: true },
			},
		});
		expect(targetEnabledByProfile(resolved, "claude")).toBe(true);
		expect(targetEnabledByProfile(resolved, "codex")).toBe(false);
	});
});
