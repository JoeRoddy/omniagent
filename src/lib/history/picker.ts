import readline from "node:readline";
import { collapseText, formatTimestamp, sanitizeTerminalText, wrapText } from "./format.js";
import type { SearchMatch } from "./types.js";

const MAX_LIST_ROWS = 10;
/** title, blank, separator, blank, hint */
const CHROME_ROWS = 5;

const ANSI = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	reverse: "\x1b[7m",
	hideCursor: "\x1b[?25l",
	showCursor: "\x1b[?25h",
	clearDown: "\x1b[0J",
} as const;

export type PickerKey = {
	name?: string;
	ctrl?: boolean;
	meta?: boolean;
	sequence?: string;
};

export type PickerOutcome =
	| { type: "active" }
	| { type: "quit" }
	| { type: "copy-text"; match: SearchMatch }
	| { type: "copy-resume"; match: SearchMatch };

export type PickerEntry = {
	match: SearchMatch;
	/** 1-based position in the unfiltered result list, so numbers stay stable while filtering. */
	number: number;
	haystack: string;
};

export type PickerState = {
	entries: PickerEntry[];
	filter: string;
	visible: number[];
	selected: number;
	offset: number;
	outcome: PickerOutcome;
};

export type PickerDimensions = {
	rows: number;
	columns: number;
};

export function buildEntries(matches: SearchMatch[]): PickerEntry[] {
	return matches.map((match, index) => ({
		match,
		number: index + 1,
		// Filtering also spans agent and project so `codex` or a repo name narrows the list.
		haystack: `${match.text}\n${match.agentId}\n${match.project ?? ""}`.toLowerCase(),
	}));
}

function computeVisible(entries: PickerEntry[], filter: string): number[] {
	const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) {
		return entries.map((_, index) => index);
	}
	// Same AND-across-terms rule as the command-line query, so the filter behaves predictably.
	const visible: number[] = [];
	entries.forEach((entry, index) => {
		if (terms.every((term) => entry.haystack.includes(term))) {
			visible.push(index);
		}
	});
	return visible;
}

export function createPickerState(entries: PickerEntry[]): PickerState {
	return {
		entries,
		filter: "",
		visible: computeVisible(entries, ""),
		selected: 0,
		offset: 0,
		outcome: { type: "active" },
	};
}

function clampSelection(state: PickerState, listRows: number): PickerState {
	const maxIndex = Math.max(0, state.visible.length - 1);
	const selected = Math.min(Math.max(state.selected, 0), maxIndex);
	let offset = state.offset;
	if (selected < offset) {
		offset = selected;
	} else if (selected >= offset + listRows) {
		offset = selected - listRows + 1;
	}
	offset = Math.max(0, Math.min(offset, Math.max(0, state.visible.length - listRows)));
	return { ...state, selected, offset };
}

export function selectedMatch(state: PickerState): SearchMatch | null {
	const entryIndex = state.visible[state.selected];
	if (entryIndex === undefined) {
		return null;
	}
	return state.entries[entryIndex]?.match ?? null;
}

function withFilter(state: PickerState, filter: string): PickerState {
	const visible = computeVisible(state.entries, filter);
	return { ...state, filter, visible, selected: 0, offset: 0 };
}

function isPrintable(key: PickerKey): boolean {
	const sequence = key.sequence;
	if (!sequence || key.ctrl || key.meta) {
		return false;
	}
	return sequence.length === 1 && sequence >= " " && sequence !== "\x7f";
}

export function handleKey(state: PickerState, key: PickerKey, listRows: number): PickerState {
	if (key.ctrl && (key.name === "c" || key.name === "d")) {
		return { ...state, outcome: { type: "quit" } };
	}
	if (key.ctrl && key.name === "r") {
		const match = selectedMatch(state);
		return match ? { ...state, outcome: { type: "copy-resume", match } } : state;
	}
	if (key.name === "return" || key.name === "enter") {
		const match = selectedMatch(state);
		return match ? { ...state, outcome: { type: "copy-text", match } } : state;
	}
	if (key.name === "escape") {
		// Escape peels off the filter first; only an already-empty filter exits.
		return state.filter.length > 0
			? clampSelection(withFilter(state, ""), listRows)
			: { ...state, outcome: { type: "quit" } };
	}
	if (key.name === "up" || (key.ctrl && key.name === "p")) {
		return clampSelection({ ...state, selected: state.selected - 1 }, listRows);
	}
	if (key.name === "down" || (key.ctrl && key.name === "n")) {
		return clampSelection({ ...state, selected: state.selected + 1 }, listRows);
	}
	if (key.name === "pageup") {
		return clampSelection({ ...state, selected: state.selected - listRows }, listRows);
	}
	if (key.name === "pagedown") {
		return clampSelection({ ...state, selected: state.selected + listRows }, listRows);
	}
	if (key.name === "home") {
		return clampSelection({ ...state, selected: 0 }, listRows);
	}
	if (key.name === "end") {
		return clampSelection({ ...state, selected: state.visible.length - 1 }, listRows);
	}
	if (key.name === "backspace") {
		return state.filter.length === 0
			? state
			: clampSelection(withFilter(state, state.filter.slice(0, -1)), listRows);
	}
	if (isPrintable(key)) {
		return clampSelection(withFilter(state, state.filter + key.sequence), listRows);
	}
	return state;
}

export function layout(
	dimensions: PickerDimensions,
	entryCount: number,
): { listRows: number; previewRows: number } {
	const body = Math.max(1, dimensions.rows - CHROME_ROWS);
	const listRows = Math.max(1, Math.min(entryCount || 1, MAX_LIST_ROWS, Math.ceil(body * 0.6)));
	const previewRows = Math.max(0, body - listRows);
	return { listRows, previewRows };
}

function truncate(value: string, width: number): string {
	if (value.length <= width) {
		return value;
	}
	return width <= 1 ? value.slice(0, width) : `${value.slice(0, width - 1)}…`;
}

export function renderPicker(
	state: PickerState,
	dimensions: PickerDimensions,
	options: { query: string; useColor: boolean },
): string[] {
	const width = Math.max(20, dimensions.columns - 1);
	const { listRows, previewRows } = layout(dimensions, state.entries.length);
	const positioned = clampSelection(state, listRows);
	const style = (value: string, code: string) =>
		options.useColor ? `${code}${value}${ANSI.reset}` : value;

	const total = state.entries.length;
	const shown = positioned.visible.length;
	const counter = shown === total ? `${total} matches` : `${shown} of ${total}`;
	const header = collapseText(
		positioned.filter.length > 0
			? `${options.query} › ${positioned.filter}▏  ${counter}`
			: `${options.query} · ${counter}`,
	);

	const lines: string[] = [style(truncate(header, width), ANSI.dim), ""];

	if (shown === 0) {
		lines.push(style(truncate("  no matches for this filter", width), ANSI.dim));
		for (let index = 1; index < listRows; index += 1) {
			lines.push("");
		}
	} else {
		const numberWidth = String(total).length;
		// Pad the agent column so the project column lines up across agents of differing name length.
		const agentWidth = Math.max(...positioned.entries.map((entry) => entry.match.agentId.length));
		for (let row = 0; row < listRows; row += 1) {
			const visibleIndex = positioned.offset + row;
			if (visibleIndex >= shown) {
				lines.push("");
				continue;
			}
			const entry = positioned.entries[positioned.visible[visibleIndex] as number] as PickerEntry;
			const marker = visibleIndex === positioned.selected ? "▸" : " ";
			const label = collapseText(
				`${marker} [${String(entry.number).padStart(numberWidth)}] ${formatTimestamp(
					entry.match.timestamp,
				)}  ${entry.match.agentId.padEnd(agentWidth)}  ${entry.match.project ?? ""}`,
			);
			const clamped = truncate(label.trimEnd(), width);
			lines.push(
				visibleIndex === positioned.selected ? style(clamped.padEnd(width), ANSI.reverse) : clamped,
			);
		}
	}

	lines.push(style("─".repeat(width), ANSI.dim));

	const match = selectedMatch(positioned);
	const preview = match ? wrapText(sanitizeTerminalText(match.text), width, previewRows) : [];
	for (let row = 0; row < previewRows; row += 1) {
		lines.push(preview[row] ?? "");
	}

	lines.push("");
	lines.push(
		style(
			truncate(
				"↑↓ move · type to filter · enter copy · ctrl-r resume cmd · esc/ctrl-c quit",
				width,
			),
			ANSI.dim,
		),
	);
	return lines.slice(0, Math.max(1, dimensions.rows));
}

export type PickerIo = {
	input: NodeJS.ReadStream;
	output: NodeJS.WriteStream;
	useColor: boolean;
};

function rewindFrame(lineCount: number): string {
	return lineCount > 1 ? `\r\x1b[${lineCount - 1}A` : "\r";
}

/**
 * Thin IO shell. All decisions live in the pure helpers above; this only paints frames and feeds
 * keystrokes in, so the picker's behavior is testable without a terminal.
 */
export function runPicker(
	matches: SearchMatch[],
	io: PickerIo,
	options: { query: string },
): Promise<PickerOutcome> {
	return new Promise((resolve) => {
		let state = createPickerState(buildEntries(matches));
		let painted = 0;
		let settled = false;

		const dimensions = (): PickerDimensions => ({
			rows: io.output.rows ?? 24,
			columns: io.output.columns ?? 80,
		});

		const paint = () => {
			const frame = renderPicker(state, dimensions(), {
				query: options.query,
				useColor: io.useColor,
			});
			let out = rewindFrame(painted);
			out += ANSI.clearDown;
			out += frame.join("\n");
			io.output.write(out);
			painted = frame.length;
		};

		const finish = (outcome: PickerOutcome) => {
			if (settled) {
				return;
			}
			settled = true;
			io.input.removeListener("keypress", onKeypress);
			io.input.removeListener("end", onClosed);
			io.input.removeListener("close", onClosed);
			io.output.removeListener("resize", paint);
			if (io.input.isTTY) {
				io.input.setRawMode(false);
			}
			io.input.pause();
			// Erase the picker so the terminal is left exactly as it was found.
			io.output.write(`${rewindFrame(painted)}${ANSI.clearDown}${ANSI.showCursor}`);
			resolve(outcome);
		};

		// Without this, a stdin that reaches EOF (a closed pipe, a detached terminal) leaves the
		// picker waiting for a keystroke that can never arrive.
		function onClosed() {
			finish({ type: "quit" });
		}

		function onKeypress(_: string | undefined, key: PickerKey | undefined) {
			if (!key) {
				return;
			}
			const { listRows } = layout(dimensions(), state.entries.length);
			state = handleKey(state, key, listRows);
			if (state.outcome.type !== "active") {
				finish(state.outcome);
				return;
			}
			paint();
		}

		readline.emitKeypressEvents(io.input);
		if (io.input.isTTY) {
			io.input.setRawMode(true);
		}
		io.input.resume();
		io.input.on("keypress", onKeypress);
		io.input.on("end", onClosed);
		io.input.on("close", onClosed);
		io.output.on("resize", paint);
		io.output.write(ANSI.hideCursor);
		paint();
	});
}
