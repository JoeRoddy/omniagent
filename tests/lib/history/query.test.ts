import {
	compileQuery,
	findRanges,
	InvalidQueryError,
	matchesText,
	prefilterLine,
} from "../../../src/lib/history/query.js";

describe("compileQuery", () => {
	it("treats each positional as its own term, ANDed", () => {
		const query = compileQuery(["merge", "conflict"]);

		expect(query.terms).toEqual(["merge", "conflict"]);
		// Order-independent: this is the whole point of AND over phrase.
		expect(matchesText(query, "hit a conflict during the merge")).toBe(true);
		expect(matchesText(query, "just a merge")).toBe(false);
	});

	it("treats a quoted positional as a phrase", () => {
		const query = compileQuery(["merge conflict"]);

		expect(query.terms).toEqual(["merge conflict"]);
		expect(matchesText(query, "resolve the merge conflict now")).toBe(true);
		expect(matchesText(query, "hit a conflict during the merge")).toBe(false);
	});

	it("is case-insensitive by default and exact under caseSensitive", () => {
		expect(matchesText(compileQuery(["MeRgE"]), "a merge happened")).toBe(true);
		expect(matchesText(compileQuery(["MeRgE"], { caseSensitive: true }), "a merge happened")).toBe(
			false,
		);
		expect(matchesText(compileQuery(["merge"], { caseSensitive: true }), "a merge happened")).toBe(
			true,
		);
	});

	it("coerces non-string positionals without throwing", () => {
		// yargs hands back numbers for a bare `search 123` unless the positional is typed.
		const query = compileQuery([123 as unknown as string]);

		expect(matchesText(query, "error code 123 returned")).toBe(true);
	});

	it("rejects a multi-positional regex query", () => {
		expect(() => compileQuery(["a", "b"], { regex: true })).toThrow(InvalidQueryError);
		try {
			compileQuery(["a", "b"], { regex: true });
		} catch (error) {
			expect((error as InvalidQueryError).code).toBe("invalid_regex_query");
		}
	});

	it("rejects an invalid regex pattern", () => {
		try {
			compileQuery(["("], { regex: true });
			expect.unreachable("should have thrown");
		} catch (error) {
			expect((error as InvalidQueryError).code).toBe("invalid_regex");
		}
	});

	it("matches in regex mode", () => {
		const query = compileQuery(["merge\\s+conflicts?"], { regex: true });

		expect(matchesText(query, "the merge   conflict is bad")).toBe(true);
		expect(matchesText(query, "mergeconflict")).toBe(false);
	});

	it("uses no prefilter in regex mode", () => {
		expect(compileQuery(["anything"], { regex: true }).prefilter).toBeNull();
	});
});

describe("prefilter", () => {
	it("derives a needle from the longest escape-safe run", () => {
		expect(compileQuery(['"hello"']).prefilter).toBe("hello");
		expect(compileQuery(["merge conflict"]).prefilter).toBe("conflict");
		expect(compileQuery(["ab", "conflict"]).prefilter).toBe("conflict");
	});

	it("declines a needle when no safe run is long enough", () => {
		expect(compileQuery(['a"b']).prefilter).toBeNull();
		expect(compileQuery(["a b"]).prefilter).toBeNull();
	});

	it("passes every line when there is no needle", () => {
		const query = compileQuery(['a"b']);

		expect(query.prefilter).toBeNull();
		expect(prefilterLine(query, "totally unrelated line")).toBe(true);
	});

	// The invariant the whole fast path rests on: the prefilter may over-admit lines, but it must
	// never reject a line whose record would have matched. Anything that breaks this silently
	// drops real results.
	it("never produces a false negative against a JSON-encoded line", () => {
		const texts = [
			'say "hello" to the parser',
			'a backslash \\ and a quote " together',
			"multi\nline\nprompt about merge conflicts",
			"tabs\tand\tspaces",
			"unicode: café — naïve — 日本語 — 🎉",
			"control  char",
			"plain simple prompt",
			'nested "quotes \\"deeper\\"" here',
			"trailing backslash \\",
		];
		const needles = [
			'"hello"',
			"hello",
			"backslash",
			"merge conflicts",
			"conflicts",
			"tabs",
			"café",
			"日本語",
			"🎉",
			"control",
			"simple",
			'"quotes',
			"deeper",
			"trailing",
			"\\",
		];

		for (const text of texts) {
			// Mirrors how both agents actually persist a record: JSON on one line.
			const line = JSON.stringify({ type: "user", message: { content: text } });
			for (const needle of needles) {
				for (const caseSensitive of [false, true]) {
					const query = compileQuery([needle], { caseSensitive });
					if (!matchesText(query, text)) {
						continue;
					}
					expect(
						prefilterLine(query, line),
						`prefilter dropped a real match: needle=${JSON.stringify(needle)} text=${JSON.stringify(text)} prefilter=${JSON.stringify(query.prefilter)}`,
					).toBe(true);
				}
			}
		}
	});

	it("still admits lines when the needle only appears escaped", () => {
		const text = 'say "hello" to the parser';
		const line = JSON.stringify({ message: { content: text } });
		const query = compileQuery(['"hello"']);

		expect(line).toContain('\\"hello\\"');
		expect(matchesText(query, text)).toBe(true);
		expect(prefilterLine(query, line)).toBe(true);
	});
});

describe("findRanges", () => {
	it("returns merged, sorted ranges for literal terms", () => {
		const query = compileQuery(["merge", "conflict"]);

		expect(findRanges(query, "merge conflict")).toEqual([
			[0, 5],
			[6, 14],
		]);
	});

	it("finds every occurrence of a term", () => {
		expect(findRanges(compileQuery(["ab"]), "ab-ab-ab")).toEqual([
			[0, 2],
			[3, 5],
			[6, 8],
		]);
	});

	it("merges overlapping ranges from different terms", () => {
		expect(findRanges(compileQuery(["abc", "bcd"]), "abcd")).toEqual([[0, 4]]);
	});

	it("returns regex match ranges without hanging on zero-width matches", () => {
		expect(findRanges(compileQuery(["a*"], { regex: true }), "aa b")).toEqual([[0, 2]]);
	});
});
