import { applyAgentTemplating, validateAgentTemplating } from "../../src/lib/agent-templating.js";

describe("agent templating", () => {
	const validAgents = ["claude", "codex", "gemini"];

	it("includes scoped blocks for matching agents", () => {
		const content = "Hello<agents claude> world</agents>!";
		const output = applyAgentTemplating({
			content,
			target: "claude",
			validAgents,
		});

		expect(output).toBe("Hello world!");
	});

	it("excludes scoped blocks for non-matching agents", () => {
		const content = "Hello<agents claude> world</agents>!";
		const output = applyAgentTemplating({
			content,
			target: "codex",
			validAgents,
		});

		expect(output).toBe("Hello!");
	});

	it("supports multiple scoped blocks in a single document", () => {
		const content =
			"A<agents claude>1</agents>B<agents codex>2</agents>C<agents claude>3</agents>D";
		const output = applyAgentTemplating({
			content,
			target: "claude",
			validAgents,
		});

		expect(output).toBe("A1BC3D");
	});

	it("supports not: exclusions and case-insensitive matching", () => {
		const content = "A<agents not:claude,gemini> skip</agents>B<agents ClAuDe> keep</agents>C";
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

	it("supports escaped closing tags and multi-line content", () => {
		const content = "Start<agents claude>line1\nline2 \\</agents> tail</agents>End";
		const output = applyAgentTemplating({
			content,
			target: "claude",
			validAgents,
		});

		expect(output).toBe("Startline1\nline2 </agents> tailEnd");
	});

	it("allows standard HTML markup inside templated blocks", () => {
		const content = "<agents claude><div> hello </div></agents>";
		const output = applyAgentTemplating({
			content,
			target: "claude",
			validAgents,
		});

		expect(output).toBe("<div> hello </div>");
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

	it("ignores non-templating braces", () => {
		const content = "function demo() { return 1; }";
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
				content: "Hello<agents claude> world</agents>!",
				validAgents,
			}),
		).not.toThrow();
	});

	it("lists valid agents for unknown selectors", () => {
		expect(() =>
			applyAgentTemplating({
				content: "Hello<agents bogus> world</agents>!",
				target: "claude",
				validAgents,
			}),
		).toThrow(/Valid agents: claude, codex, gemini\./);
	});

	it.each([
		["empty selector list", "Hi<agents  >x</agents>there", /Selector list cannot be empty/],
		["empty selector entry", "Hi<agents claude,,codex> x</agents>there", /empty entry/],
		["empty not entry", "Hi<agents not: >x</agents>there", /empty not: entry/],
		[
			"nested selector",
			"Hi<agents claude> nested <agents codex> x</agents> </agents>there",
			/Nested selector block/,
		],
		["unterminated tag", "Hi<agents claude x there", /Unterminated selector block/],
		["unterminated block", "Hi<agents claude> x", /Unterminated selector block/],
		["missing content", "Hi<agents claude></agents>", /missing content/],
		[
			"include/exclude conflict",
			"Hi<agents claude,not:claude> x</agents>there",
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
