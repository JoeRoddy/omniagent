/** Shortest prefilter needle worth using. Below this the scan cost beats the parse it saves. */
const MIN_PREFILTER_LENGTH = 3;

/**
 * Characters JSON string-escaping rewrites, plus whitespace. A needle spanning one of these
 * cannot be tested against a raw transcript line: the prompt `say "hi"` is stored as
 * `say \"hi\"`, so the needle `"hi"` would false-negative, and a newline inside a prompt is
 * stored as the two characters `\n`. Splitting on them yields runs that survive escaping intact.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are exactly what JSON escapes.
const PREFILTER_UNSAFE = /[\u0000-\u0020"\\]+/;

export type HistoryQuery = {
	/** The query as the user typed it, for display and the JSON envelope. */
	raw: string;
	/** Literal mode only. Every term must be present. Case-normalized unless caseSensitive. */
	terms: string[];
	regex: RegExp | null;
	caseSensitive: boolean;
	/**
	 * Case-normalized substring candidate for a target-owned raw-line prefilter. The target must
	 * account for its encoding and normalization; null means every candidate line must be parsed.
	 */
	prefilter: string | null;
};

export class InvalidQueryError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "InvalidQueryError";
		this.code = code;
	}
}

function longestSafeRun(value: string): string {
	let best = "";
	for (const run of value.split(PREFILTER_UNSAFE)) {
		if (run.length > best.length) {
			best = run;
		}
	}
	return best;
}

function derivePrefilter(terms: string[]): string | null {
	let best = "";
	for (const term of terms) {
		const run = longestSafeRun(term);
		if (run.length > best.length) {
			best = run;
		}
	}
	return best.length >= MIN_PREFILTER_LENGTH ? best : null;
}

/**
 * Each positional argument is one term. That is what makes quoting the phrase operator without
 * a dedicated flag: `search merge conflict` arrives as two terms (ANDed), while
 * `search "merge conflict"` arrives as a single term containing a space (matched as a phrase).
 * Joining and re-splitting on whitespace would erase that distinction.
 */
export function compileQuery(
	input: string[],
	options: { regex?: boolean; caseSensitive?: boolean } = {},
): HistoryQuery {
	const caseSensitive = options.caseSensitive === true;
	const pieces = input.map((value) => String(value)).filter((value) => value.length > 0);
	const raw = pieces.join(" ");

	if (options.regex === true) {
		const pattern = pieces[0];
		if (pieces.length !== 1 || pattern === undefined) {
			throw new InvalidQueryError(
				"invalid_regex_query",
				"--regex requires a single quoted pattern.",
			);
		}
		let regex: RegExp;
		try {
			regex = new RegExp(pattern, caseSensitive ? "" : "i");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new InvalidQueryError("invalid_regex", `--regex pattern is invalid: ${message}`);
		}
		return { raw, terms: [], regex, caseSensitive, prefilter: null };
	}

	const terms = pieces.map((term) => (caseSensitive ? term : term.toLowerCase()));
	return { raw, terms, regex: null, caseSensitive, prefilter: derivePrefilter(terms) };
}

/**
 * Cheap literal gate for encodings guaranteed to retain the needle verbatim. Targets whose
 * records can escape or transform text must wrap this with their own conservative checks.
 */
export function prefilterLine(query: HistoryQuery, line: string): boolean {
	if (query.prefilter === null) {
		return true;
	}
	// Deliberately toLowerCase, never toLocaleLowerCase: the Turkish dotless i would otherwise
	// make search results depend on the ambient LANG.
	const haystack = query.caseSensitive ? line : line.toLowerCase();
	return haystack.includes(query.prefilter);
}

/**
 * Conservative prefilter for JSON records whose normalized text is assembled from string fields.
 * Legal JSON may escape any character as `\uXXXX` (and `/` as `\/`), so those lines must be
 * parsed. Multiple text fields are also admitted because normalization may join their values.
 */
export function prefilterJsonLine(query: HistoryQuery, line: string): boolean {
	if (line.includes("\\u") || line.includes("\\/")) {
		return true;
	}
	const firstTextField = findJsonTextField(line);
	if (firstTextField !== -1 && findJsonTextField(line, firstTextField + 6) !== -1) {
		return true;
	}
	return prefilterLine(query, line);
}

function findJsonTextField(line: string, from = 0): number {
	let index = line.indexOf('"text"', from);
	while (index !== -1) {
		let cursor = index + 6;
		while (cursor < line.length && /\s/.test(line[cursor] as string)) {
			cursor += 1;
		}
		if (line[cursor] === ":") {
			return index;
		}
		index = line.indexOf('"text"', index + 6);
	}
	return -1;
}

/** Authoritative match, run against a record's cleaned text. */
export function matchesText(query: HistoryQuery, text: string): boolean {
	if (query.regex) {
		return query.regex.test(text);
	}
	if (query.terms.length === 0) {
		return false;
	}
	const haystack = query.caseSensitive ? text : text.toLowerCase();
	return query.terms.every((term) => haystack.includes(term));
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
	if (ranges.length < 2) {
		return ranges;
	}
	const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const first = sorted[0] as [number, number];
	const merged: Array<[number, number]> = [[first[0], first[1]]];
	for (const range of sorted.slice(1)) {
		const last = merged[merged.length - 1] as [number, number];
		if (range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
		} else {
			merged.push([range[0], range[1]]);
		}
	}
	return merged;
}

/** Highlight ranges within display text. Offsets index the string passed in, not the raw record. */
export function findRanges(query: HistoryQuery, text: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];

	if (query.regex) {
		const flags = query.regex.flags.includes("g") ? query.regex.flags : `${query.regex.flags}g`;
		const global = new RegExp(query.regex.source, flags);
		for (const match of text.matchAll(global)) {
			if (match.index === undefined || match[0].length === 0) {
				continue;
			}
			ranges.push([match.index, match.index + match[0].length]);
		}
		return mergeRanges(ranges);
	}

	const haystack = query.caseSensitive ? text : text.toLowerCase();
	for (const term of query.terms) {
		let from = 0;
		for (;;) {
			const index = haystack.indexOf(term, from);
			if (index === -1) {
				break;
			}
			ranges.push([index, index + term.length]);
			from = index + term.length;
		}
	}
	return mergeRanges(ranges);
}
