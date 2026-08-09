import { EventEmitter } from "node:events";
import {
	buildEntries,
	createPickerState,
	handleKey,
	layout,
	type PickerKey,
	type PickerState,
	renderPicker,
	runPicker,
	selectedMatch,
} from "../../../src/lib/history/picker.js";
import type { SearchMatch } from "../../../src/lib/history/types.js";
import { createHeadlessTerminal, readScreen } from "../../../src/lib/usage/pty.js";

function match(overrides: Partial<SearchMatch> = {}): SearchMatch {
	return {
		agentId: "claude",
		displayName: "Claude Code",
		role: "user",
		timestamp: "2026-08-05T10:00:00.000Z",
		sessionId: "sess",
		cwd: "/repo/alpha",
		project: "alpha",
		gitBranch: null,
		sourcePath: "/t.jsonl",
		text: "resolve the merge conflict",
		textTruncated: false,
		excerpt: "resolve the merge conflict",
		matchRanges: [],
		resumeCommand: "claude --resume sess",
		...overrides,
	};
}

const MATCHES: SearchMatch[] = [
	match({ text: "alpha prompt about migrations", project: "alpha", sessionId: "s1" }),
	match({ text: "beta prompt about deploys", agentId: "codex", project: "beta", sessionId: "s2" }),
	match({ text: "gamma prompt about migrations", project: "gamma", sessionId: "s3" }),
	match({ text: "delta prompt about tests", agentId: "codex", project: "delta", sessionId: "s4" }),
];

function state(matches: SearchMatch[] = MATCHES): PickerState {
	return createPickerState(buildEntries(matches));
}

function key(name: string, extra: Partial<PickerKey> = {}): PickerKey {
	return { name, ...extra };
}

function typed(character: string): PickerKey {
	return { sequence: character };
}

function press(initial: PickerState, keys: PickerKey[], listRows = 4): PickerState {
	return keys.reduce((current, next) => handleKey(current, next, listRows), initial);
}

describe("picker navigation", () => {
	it("starts on the newest result", () => {
		expect(selectedMatch(state())?.sessionId).toBe("s1");
	});

	it("moves with arrows and with ctrl-n / ctrl-p", () => {
		expect(selectedMatch(press(state(), [key("down")]))?.sessionId).toBe("s2");
		expect(selectedMatch(press(state(), [key("n", { ctrl: true })]))?.sessionId).toBe("s2");
		expect(
			selectedMatch(press(state(), [key("down"), key("down"), key("p", { ctrl: true })]))
				?.sessionId,
		).toBe("s2");
	});

	it("clamps at both ends instead of wrapping", () => {
		expect(selectedMatch(press(state(), [key("up"), key("up")]))?.sessionId).toBe("s1");
		expect(
			selectedMatch(press(state(), [key("down"), key("down"), key("down"), key("down")]))
				?.sessionId,
		).toBe("s4");
	});

	it("jumps with home, end, and page keys", () => {
		expect(selectedMatch(press(state(), [key("end")]))?.sessionId).toBe("s4");
		expect(selectedMatch(press(state(), [key("end"), key("home")]))?.sessionId).toBe("s1");
		expect(selectedMatch(press(state(), [key("pagedown")], 2))?.sessionId).toBe("s3");
	});

	it("scrolls the viewport to keep the selection visible", () => {
		const scrolled = press(state(), [key("down"), key("down"), key("down")], 2);

		expect(scrolled.offset).toBe(2);
		expect(selectedMatch(scrolled)?.sessionId).toBe("s4");
	});
});

describe("picker filtering", () => {
	it("narrows as characters are typed", () => {
		const filtered = press(state(), [typed("m"), typed("i"), typed("g")]);

		expect(filtered.filter).toBe("mig");
		expect(filtered.visible).toHaveLength(2);
		expect(selectedMatch(filtered)?.sessionId).toBe("s1");
	});

	it("ANDs filter terms", () => {
		const filtered = press(state(), [..."gamma mig".split("").map(typed)]);

		expect(filtered.visible).toHaveLength(1);
		expect(selectedMatch(filtered)?.sessionId).toBe("s3");
	});

	it("matches on agent id and project as well as text", () => {
		expect(press(state(), [..."codex".split("").map(typed)]).visible).toHaveLength(2);
		expect(press(state(), [..."delta".split("").map(typed)]).visible).toHaveLength(1);
	});

	it("removes characters on backspace", () => {
		const filtered = press(state(), [typed("m"), typed("i"), typed("g"), key("backspace")]);

		expect(filtered.filter).toBe("mi");
	});

	it("resets the selection when the filter changes", () => {
		const filtered = press(state(), [key("down"), key("down"), typed("m")]);

		expect(filtered.selected).toBe(0);
	});

	it("survives a filter that matches nothing", () => {
		const filtered = press(state(), [..."zzzz".split("").map(typed)]);

		expect(filtered.visible).toEqual([]);
		expect(selectedMatch(filtered)).toBeNull();
		expect(filtered.outcome.type).toBe("active");
	});

	it("ignores control sequences as filter input", () => {
		expect(press(state(), [{ sequence: "r", ctrl: true, name: "r" }]).filter).toBe("");
	});
});

describe("picker actions", () => {
	it("copies the selected message on enter", () => {
		const outcome = press(state(), [key("down"), key("return")]).outcome;

		expect(outcome.type).toBe("copy-text");
		expect(outcome.type === "copy-text" && outcome.match.sessionId).toBe("s2");
	});

	it("copies the resume command on ctrl-r", () => {
		const outcome = press(state(), [key("r", { ctrl: true })]).outcome;

		expect(outcome.type).toBe("copy-resume");
	});

	it("quits on ctrl-c and ctrl-d", () => {
		expect(press(state(), [key("c", { ctrl: true })]).outcome.type).toBe("quit");
		expect(press(state(), [key("d", { ctrl: true })]).outcome.type).toBe("quit");
	});

	// Escape is overloaded on purpose: it should undo the filter before it abandons the search.
	it("clears the filter on escape, and quits only once it is empty", () => {
		const filtered = press(state(), [typed("m"), typed("i")]);
		const cleared = handleKey(filtered, key("escape"), 4);

		expect(cleared.filter).toBe("");
		expect(cleared.outcome.type).toBe("active");
		expect(handleKey(cleared, key("escape"), 4).outcome.type).toBe("quit");
	});

	it("does nothing on enter when the filter matches nothing", () => {
		const empty = press(state(), [..."zzzz".split("").map(typed)]);

		expect(handleKey(empty, key("return"), 4).outcome.type).toBe("active");
	});
});

describe("picker rendering", () => {
	const dimensions = { rows: 24, columns: 80 };

	it("renders a frame that fits the terminal", () => {
		const frame = renderPicker(state(), dimensions, { query: "prompt", useColor: false });

		expect(frame.length).toBeLessThanOrEqual(dimensions.rows);
		for (const line of frame) {
			expect(line.length).toBeLessThanOrEqual(dimensions.columns);
		}
	});

	it("shows the query, the count, and every result number", () => {
		const frame = renderPicker(state(), dimensions, { query: "prompt", useColor: false }).join(
			"\n",
		);

		expect(frame).toContain("prompt · 4 matches");
		expect(frame).toContain("[1]");
		expect(frame).toContain("[4]");
	});

	it("marks the selected row and previews its full text", () => {
		const moved = press(state(), [key("down")]);
		const frame = renderPicker(moved, dimensions, { query: "prompt", useColor: false }).join("\n");

		expect(frame).toContain("▸ [2]");
		expect(frame).toContain("beta prompt about deploys");
	});

	it("keeps original result numbers stable while filtering", () => {
		const filtered = press(state(), [..."gamma".split("").map(typed)]);
		const frame = renderPicker(filtered, dimensions, { query: "prompt", useColor: false }).join(
			"\n",
		);

		// gamma is the third result overall, so it stays [3] even as the only visible row.
		expect(frame).toContain("[3]");
		expect(frame).toContain("1 of 4");
	});

	it("reports an empty filter result without crashing", () => {
		const empty = press(state(), [..."zzzz".split("").map(typed)]);
		const frame = renderPicker(empty, dimensions, { query: "prompt", useColor: false }).join("\n");

		expect(frame).toContain("no matches for this filter");
	});

	it("emits no ANSI when color is disabled", () => {
		const frame = renderPicker(state(), dimensions, { query: "prompt", useColor: false }).join(
			"\n",
		);

		expect(frame.includes(String.fromCharCode(27))).toBe(false);
	});

	it("sanitizes terminal controls embedded in transcript text", () => {
		const unsafe = state([
			match({ text: "before\x1b]52;c;YXR0YWNr\x07after", sessionId: "unsafe" }),
		]);
		const frame = renderPicker(unsafe, dimensions, { query: "before", useColor: false }).join("\n");

		expect(frame).not.toContain("\x1b");
		expect(frame).not.toContain("\x07");
	});
});

describe("picker terminal repaint", () => {
	it("preserves the terminal line before the picker across repaint and cleanup", async () => {
		const input = new EventEmitter() as EventEmitter &
			Pick<NodeJS.ReadStream, "isTTY" | "pause" | "resume" | "setRawMode">;
		input.isTTY = false;
		input.pause = vi.fn(() => input as NodeJS.ReadStream);
		input.resume = vi.fn(() => input as NodeJS.ReadStream);
		input.setRawMode = vi.fn(() => input as NodeJS.ReadStream);

		const writes: string[] = [];
		const output = new EventEmitter() as EventEmitter &
			Pick<NodeJS.WriteStream, "columns" | "rows" | "write">;
		output.columns = 80;
		output.rows = 12;
		output.write = vi.fn((value: string | Uint8Array) => {
			writes.push(String(value));
			return true;
		});

		const outcome = runPicker(
			MATCHES,
			{
				input: input as NodeJS.ReadStream,
				output: output as NodeJS.WriteStream,
				useColor: false,
			},
			{ query: "prompt" },
		);
		input.emit("keypress", undefined, key("down"));
		input.emit("keypress", undefined, key("escape"));

		await expect(outcome).resolves.toEqual({ type: "quit" });
		const terminal = createHeadlessTerminal(80, 24);
		try {
			await new Promise<void>((resolve) => {
				// A real TTY's output processing expands LF to CRLF. Headless xterm consumes raw
				// bytes, so mirror that line discipline before replaying the captured writes.
				const ttyOutput = writes.join("").replaceAll("\n", "\r\n");
				terminal.write(`sentinel before picker\r\n${ttyOutput}`, resolve);
			});
			const nonEmptyLines = readScreen(terminal)
				.split("\n")
				.filter((line) => line.length > 0);

			expect(nonEmptyLines).toEqual(["sentinel before picker"]);
		} finally {
			terminal.dispose();
		}
	});
});

describe("picker layout", () => {
	it("splits the viewport between list and preview", () => {
		const { listRows, previewRows } = layout({ rows: 24, columns: 80 }, 20);

		expect(listRows).toBeGreaterThan(0);
		expect(previewRows).toBeGreaterThan(0);
		expect(listRows + previewRows).toBeLessThanOrEqual(24);
	});

	it("stays usable in a very short terminal", () => {
		const dimensions = { rows: 6, columns: 40 };
		const { listRows, previewRows } = layout(dimensions, 20);
		const frame = renderPicker(state(), dimensions, { query: "prompt", useColor: false });

		expect(listRows).toBeGreaterThanOrEqual(1);
		expect(previewRows).toBeGreaterThanOrEqual(0);
		expect(frame.length).toBeLessThanOrEqual(dimensions.rows);
	});

	it("never reserves more list rows than there are results", () => {
		expect(layout({ rows: 40, columns: 80 }, 2).listRows).toBe(2);
	});
});
