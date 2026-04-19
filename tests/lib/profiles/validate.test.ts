import { validateProfile } from "../../../src/lib/profiles/validate.js";

describe("validateProfile", () => {
	it("accepts an empty object", () => {
		const result = validateProfile({});
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("accepts a full v1 profile", () => {
		const result = validateProfile({
			$schema: "./profile.v1.json",
			description: "Focused",
			extends: "base",
			targets: { claude: { enabled: true }, codex: { enabled: false } },
			enable: { skills: ["review"], subagents: ["reviewer"], commands: ["diff-*"] },
			disable: { skills: ["ppt"] },
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("rejects unknown top-level keys", () => {
		const result = validateProfile({ variables: { A: "b" } });
		expect(result.valid).toBe(false);
		expect(result.errors.some((issue) => issue.path === "variables")).toBe(true);
	});

	it("rejects non-object profile", () => {
		const result = validateProfile("not a profile");
		expect(result.valid).toBe(false);
	});

	it("rejects non-string extends", () => {
		const result = validateProfile({ extends: 42 });
		expect(result.valid).toBe(false);
		expect(result.errors.some((issue) => issue.path === "extends")).toBe(true);
	});

	it("rejects empty strings in pattern lists", () => {
		const result = validateProfile({ enable: { skills: ["ok", "  "] } });
		expect(result.valid).toBe(false);
		expect(result.errors.some((issue) => issue.path === "enable.skills[1]")).toBe(true);
	});

	it("rejects non-boolean target.enabled", () => {
		const result = validateProfile({ targets: { claude: { enabled: "yes" } } });
		expect(result.valid).toBe(false);
		expect(result.errors.some((issue) => issue.path === "targets.claude.enabled")).toBe(true);
	});

	it("rejects unsupported category key under enable", () => {
		const result = validateProfile({ enable: { mcpServers: ["foo"] } });
		expect(result.valid).toBe(false);
	});
});
