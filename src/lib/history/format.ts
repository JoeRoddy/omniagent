import path from "node:path";
import { findRanges, type HistoryQuery } from "./query.js";
import type {
	HistoryResume,
	HistoryRole,
	SearchEnvelope,
	SearchHit,
	SearchMatch,
	SearchNote,
	SearchStats,
} from "./types.js";

const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	gray: "\x1b[90m",
} as const;

type AnsiStyle = keyof typeof ANSI;

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping real ANSI escapes is the point.
const ANSI_ESCAPE = /\u001b\[[0-9;]*[a-zA-Z]/g;
const EXCERPT_LEAD = 24;
const EXCERPT_SNAP = 12;
const DEFAULT_WIDTH = 100;
const MAX_WIDTH = 120;
const INDENT = "  ";
/** Guards the JSON envelope against one pathological pasted prompt bloating the document. */
const MAX_TEXT_BYTES = 64 * 1024;

export function shouldUseColor(): boolean {
	if (process.env.FORCE_COLOR != null && process.env.FORCE_COLOR !== "0") {
		return true;
	}
	if (process.env.NO_COLOR != null) {
		return false;
	}
	return Boolean(process.stdout.isTTY);
}

function color(value: string, style: AnsiStyle, useColor: boolean): string {
	if (!useColor) {
		return value;
	}
	return `${ANSI[style]}${value}${ANSI.reset}`;
}

/**
 * Prompts are long and multi-line, and some agents store raw terminal output verbatim. Collapsing
 * to a single logical line is what makes results scannable.
 */
export function collapseText(text: string): string {
	return text.replace(ANSI_ESCAPE, "").replace(/\s+/g, " ").trim();
}

export function buildExcerpt(
	text: string,
	ranges: Array<[number, number]>,
	width: number,
): { excerpt: string; ranges: Array<[number, number]> } {
	if (text.length <= width) {
		return { excerpt: text, ranges };
	}

	const first = ranges[0]?.[0] ?? 0;
	let start = Math.max(0, first - EXCERPT_LEAD);
	if (start > 0) {
		const space = text.lastIndexOf(" ", start);
		if (space !== -1 && start - space <= EXCERPT_SNAP) {
			start = space + 1;
		}
	}
	let end = Math.min(text.length, start + width);
	if (end < text.length) {
		const space = text.indexOf(" ", Math.max(start, end - EXCERPT_SNAP));
		if (space !== -1 && space > start && space <= end) {
			end = space;
		}
	}

	const head = start > 0 ? "… " : "";
	const tail = end < text.length ? " …" : "";
	const shifted = ranges
		.filter(([from, to]) => to > start && from < end)
		.map(
			([from, to]) =>
				[Math.max(from, start) - start + head.length, Math.min(to, end) - start + head.length] as [
					number,
					number,
				],
		);
	return { excerpt: `${head}${text.slice(start, end)}${tail}`, ranges: shifted };
}

function highlight(text: string, ranges: Array<[number, number]>, useColor: boolean): string {
	if (!useColor || ranges.length === 0) {
		return text;
	}
	let out = "";
	let cursor = 0;
	for (const [from, to] of ranges) {
		if (from >= text.length) {
			break;
		}
		out += text.slice(cursor, from);
		// Bold rather than a color: it survives both light and dark terminals.
		out += color(text.slice(from, Math.min(to, text.length)), "bold", true);
		cursor = Math.min(to, text.length);
	}
	return out + text.slice(cursor);
}

export function shortenHome(value: string, homeDir: string): string {
	if (homeDir && (value === homeDir || value.startsWith(`${homeDir}${path.sep}`))) {
		return `~${value.slice(homeDir.length)}`;
	}
	return value;
}

/**
 * The renderer never learns which agent it is printing: the target supplies the verb, and the
 * `cwd` it reports decides whether a `cd` prefix is needed.
 */
export function formatResumeCommand(
	resume: HistoryResume | null,
	currentCwd: string,
	homeDir: string,
): string | null {
	if (!resume) {
		return null;
	}
	const command = [resume.command, ...resume.args].join(" ");
	if (!resume.cwd || resume.cwd === currentCwd) {
		return command;
	}
	return `cd ${shortenHome(resume.cwd, homeDir)} && ${command}`;
}

function truncateText(text: string): { text: string; truncated: boolean } {
	if (Buffer.byteLength(text, "utf8") <= MAX_TEXT_BYTES) {
		return { text, truncated: false };
	}
	return {
		text: Buffer.from(text, "utf8").subarray(0, MAX_TEXT_BYTES).toString("utf8"),
		truncated: true,
	};
}

function terminalWidth(): number {
	const columns = process.stdout.columns ?? DEFAULT_WIDTH;
	return Math.max(40, Math.min(columns, MAX_WIDTH)) - INDENT.length;
}

/** `basename`, promoted to two segments only when two different projects would collide. */
function projectLabels(hits: SearchHit[]): Map<string, string> {
	const byBase = new Map<string, Set<string>>();
	for (const hit of hits) {
		if (!hit.record.cwd) {
			continue;
		}
		const base = path.basename(hit.record.cwd);
		const set = byBase.get(base) ?? new Set<string>();
		set.add(hit.record.cwd);
		byBase.set(base, set);
	}
	const labels = new Map<string, string>();
	for (const [base, paths] of byBase) {
		for (const cwd of paths) {
			labels.set(cwd, paths.size > 1 ? path.join(path.basename(path.dirname(cwd)), base) : base);
		}
	}
	return labels;
}

export function buildSearchEnvelope(options: {
	hits: SearchHit[];
	stats: SearchStats;
	errors: SearchNote[];
	notes: SearchNote[];
	query: HistoryQuery;
	roles: HistoryRole[];
	targets: string[];
	projectPath: string | null;
	projectMatch: string | null;
	since: Date | null;
	until: Date | null;
	cwd: string;
	homeDir: string;
	generatedAt: string;
}): SearchEnvelope {
	const labels = projectLabels(options.hits);
	const width = terminalWidth();

	const matches: SearchMatch[] = options.hits.map((hit) => {
		const collapsed = collapseText(hit.record.text);
		const ranges = findRanges(options.query, collapsed);
		const excerpt = buildExcerpt(collapsed, ranges, width);
		const text = truncateText(hit.record.text);
		return {
			agentId: hit.record.agentId,
			displayName: hit.displayName,
			role: hit.record.role,
			timestamp: hit.record.timestamp,
			sessionId: hit.record.sessionId,
			cwd: hit.record.cwd,
			project: hit.record.cwd ? (labels.get(hit.record.cwd) ?? null) : null,
			gitBranch: hit.record.gitBranch ?? null,
			sourcePath: hit.record.sourcePath,
			// Newlines are preserved here so the full prompt round-trips and stays reusable;
			// `excerpt` is the collapsed display form.
			text: text.text,
			textTruncated: text.truncated,
			excerpt: excerpt.excerpt,
			matchRanges: excerpt.ranges,
			resumeCommand: formatResumeCommand(hit.resume, options.cwd, options.homeDir),
		};
	});

	return {
		schemaVersion: 1,
		generatedAt: options.generatedAt,
		query: {
			raw: options.query.raw,
			terms: options.query.terms,
			mode: options.query.regex ? "regex" : "literal",
			caseSensitive: options.query.caseSensitive,
		},
		scope: {
			kind: options.projectPath ? "path" : options.projectMatch ? "substring" : "all",
			projectPath: options.projectPath,
			projectMatch: options.projectMatch,
			roles: options.roles,
			since: options.since ? options.since.toISOString() : null,
			until: options.until ? options.until.toISOString() : null,
			targets: options.targets,
		},
		matches,
		stats: options.stats,
		errors: options.errors,
		notes: options.notes,
	};
}

export function formatTimestamp(iso: string | null): string {
	if (!iso) {
		return "????-??-?? ??:??";
	}
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) {
		return "????-??-?? ??:??";
	}
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000_000) {
		return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	}
	if (bytes >= 1_000_000) {
		return `${Math.round(bytes / 1_000_000)} MB`;
	}
	return `${Math.round(bytes / 1_000)} KB`;
}

/** Wraps text to a width, preserving blank lines, and breaking words longer than the viewport. */
export function wrapText(text: string, width: number, maxLines: number): string[] {
	const out: string[] = [];
	const safeWidth = Math.max(8, width);
	for (const rawLine of text.split("\n")) {
		if (out.length >= maxLines) {
			break;
		}
		if (rawLine.trim().length === 0) {
			out.push("");
			continue;
		}
		let current = "";
		for (const word of rawLine.split(/\s+/).filter(Boolean)) {
			if (current.length === 0) {
				current = word;
			} else if (current.length + 1 + word.length <= safeWidth) {
				current = `${current} ${word}`;
			} else {
				out.push(current);
				if (out.length >= maxLines) {
					break;
				}
				current = word;
			}
			while (current.length > safeWidth) {
				out.push(current.slice(0, safeWidth));
				current = current.slice(safeWidth);
				if (out.length >= maxLines) {
					break;
				}
			}
		}
		if (current.length > 0 && out.length < maxLines) {
			out.push(current);
		}
	}
	return out.slice(0, maxLines);
}

export function formatSearchSummary(
	envelope: SearchEnvelope,
	jsonOutput: boolean,
	options: { full?: boolean } = {},
): string {
	if (jsonOutput) {
		return JSON.stringify(envelope, null, 2);
	}

	const useColor = shouldUseColor();
	if (envelope.matches.length === 0) {
		return `No matches for ${JSON.stringify(envelope.query.raw)}.`;
	}

	// With the default single role the column would be constant, so it is folded away.
	const showRole = envelope.scope.roles.length > 1 || envelope.scope.roles[0] !== "user";
	const agentLabels = envelope.matches.map((match) =>
		showRole ? `${match.agentId}/${match.role}` : match.agentId,
	);
	const agentWidth = Math.max(...agentLabels.map((label) => label.length));
	// Results are numbered so --copy and --print can address one without a second search.
	const numberWidth = String(envelope.matches.length).length;
	const bodyIndent = " ".repeat(numberWidth + 3);

	const lines: string[] = [];
	envelope.matches.forEach((match, index) => {
		if (index > 0) {
			lines.push("");
		}
		const label = `[${String(index + 1).padStart(numberWidth)}] `;
		const header =
			label +
			[
				color(formatTimestamp(match.timestamp), "gray", useColor),
				color((agentLabels[index] as string).padEnd(agentWidth), "bold", useColor),
				color(match.project ?? "", "gray", useColor),
			]
				.join("  ")
				.trimEnd();
		lines.push(header);
		if (options.full) {
			for (const line of wrapText(match.text, terminalWidth() - bodyIndent.length, 200)) {
				lines.push(line.length === 0 ? "" : `${bodyIndent}${line}`);
			}
		} else {
			lines.push(`${bodyIndent}${highlight(match.excerpt, match.matchRanges, useColor)}`);
		}
		if (match.resumeCommand) {
			lines.push(`${bodyIndent}${color(match.resumeCommand, "dim", useColor)}`);
		}
	});

	const { stats } = envelope;
	const shown =
		stats.returnedMatches < stats.matchedRecords
			? `Showing ${stats.returnedMatches} of ${stats.matchedRecords} matches`
			: `${stats.matchedRecords} ${stats.matchedRecords === 1 ? "match" : "matches"}`;
	lines.push("");
	lines.push(
		color(
			`${shown} (scanned ${stats.scannedFiles} files, ${formatBytes(stats.scannedBytes)}, ${(stats.elapsedMs / 1000).toFixed(1)}s)`,
			"dim",
			useColor,
		),
	);
	return lines.join("\n");
}
