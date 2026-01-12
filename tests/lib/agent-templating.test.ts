import { applyAgentTemplating, validateAgentTemplating } from "../../src/lib/agent-templating.js";

describe("agent templating", () => {
	const validAgents = ["claude", "codex", "gemini"];

	it("includes scoped blocks for matching agents", () => {
		const content = "Hello{claude world}!";
		const output = applyAgentTemplating({
			content,
			target: "claude",
			validAgents,
		});

		expect(output).toBe("Hello world!");
	});

	it("excludes scoped blocks for non-matching agents", () => {
		const content = "Hello{claude world}!";
		const output = applyAgentTemplating({
			content,
			target: "codex",
			validAgents,
		});

		expect(output).toBe("Hello!");
	});

	it("supports not: exclusions and case-insensitive matching", () => {
		const content = "A{not:claude,gemini skip}B{ClAuDe keep}C";
		const claudeOutput = applyAgentTemplating({
			content,
			target: "claude",
			validAgents,
		});
		const codexOutput = applyAgentTemplating({
			content,
			target: "codex",
			validAgents,
		});

		expect(claudeOutput).toBe("AB keepC");
		expect(codexOutput).toBe("A skipBC");
	});

	it("supports escaped closing braces and multi-line content", () => {
		const content = "Start{claude line1\nline2 \\} tail}End";
		const output = applyAgentTemplating({
			content,
			target: "claude",
			validAgents,
		});

		expect(output).toBe("Start line1\nline2 } tailEnd");
	});

	it("preserves content without templating markers", () => {
		const content = "Plain text stays the same.";
		const output = applyAgentTemplating({
			content,
			target: "claude",
			validAgents,
		});

		expect(output).toBe(content);
	});

	it("validates selectors without mutating content", () => {
		expect(() =>
			validateAgentTemplating({
				content: "Hello{claude world}!",
				validAgents,
			}),
		).not.toThrow();
	});

	it("lists valid agents for unknown selectors", () => {
		expect(() =>
			applyAgentTemplating({
				content: "Hello{bogus world}!",
				target: "claude",
				validAgents,
			}),
		).toThrow(/Valid agents: claude, codex, gemini\./);
	});

	it.each([
		["empty selector list", "Hi{ x}there", /Selector list cannot be empty/],
		["empty selector entry", "Hi{claude,,codex x}there", /empty entry/],
		["empty not entry", "Hi{not: x}there", /empty not: entry/],
		["nested selector", "Hi{claude nested {codex x} }there", /Nested selector block/],
		["unterminated block", "Hi{claude x", /Unterminated selector block/],
		["missing content", "Hi{claude}", /missing content/],
		[
			"include/exclude conflict",
			"Hi{claude,not:claude x}there",
			/includes and excludes/,
		],
	])("throws for %s", (_label, content, pattern) => {
		expect(() =>
			applyAgentTemplating({
				content,
				target: "claude",
				validAgents,
			}),
		).toThrow(pattern);
	});
});
