import type { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	ClipboardError,
	clipboardCandidates,
	copyToClipboard,
} from "../../../src/lib/history/clipboard.js";

type Behavior = "ok" | "missing" | "fail";

function fakeSpawn(behaviors: Record<string, Behavior>) {
	const attempted: string[] = [];
	const written: string[] = [];
	const spawn = ((command: string) => {
		attempted.push(command);
		const child = new EventEmitter() as EventEmitter & { stdin: EventEmitter };
		const stdin = new EventEmitter() as EventEmitter & { end: (value: string) => void };
		stdin.end = (value: string) => {
			written.push(value);
		};
		child.stdin = stdin;
		queueMicrotask(() => {
			const behavior = behaviors[command] ?? "missing";
			if (behavior === "missing") {
				child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
				return;
			}
			child.emit("close", behavior === "ok" ? 0 : 1);
		});
		return child;
	}) as unknown as typeof nodeSpawn;
	return { spawn, attempted, written };
}

describe("clipboardCandidates", () => {
	it("uses pbcopy on macOS", () => {
		expect(clipboardCandidates("darwin", {})).toEqual([{ command: "pbcopy", args: [] }]);
	});

	it("uses clip on Windows", () => {
		expect(clipboardCandidates("win32", {})).toEqual([{ command: "clip", args: [] }]);
	});

	it("prefers wl-copy under Wayland and xclip otherwise", () => {
		expect(clipboardCandidates("linux", { WAYLAND_DISPLAY: "wayland-0" })[0]?.command).toBe(
			"wl-copy",
		);
		expect(clipboardCandidates("linux", {})[0]?.command).toBe("xclip");
		// Every helper stays reachable regardless of the detected session type.
		expect(clipboardCandidates("linux", {}).map((entry) => entry.command)).toContain("wl-copy");
	});
});

describe("copyToClipboard", () => {
	it("writes the text to the first working helper", async () => {
		const { spawn, attempted, written } = fakeSpawn({ pbcopy: "ok" });

		const used = await copyToClipboard("hello clipboard", { platform: "darwin", spawn });

		expect(used.command).toBe("pbcopy");
		expect(attempted).toEqual(["pbcopy"]);
		expect(written).toEqual(["hello clipboard"]);
	});

	it("falls through to the next helper when one is missing", async () => {
		const { spawn, attempted } = fakeSpawn({ xclip: "missing", xsel: "ok" });

		const used = await copyToClipboard("text", { platform: "linux", env: {}, spawn });

		expect(used.command).toBe("xsel");
		expect(attempted).toEqual(["xclip", "xsel"]);
	});

	it("falls through when a helper exits non-zero", async () => {
		const { spawn } = fakeSpawn({ xclip: "fail", xsel: "ok" });

		expect((await copyToClipboard("text", { platform: "linux", env: {}, spawn })).command).toBe(
			"xsel",
		);
	});

	it("throws one actionable error when no helper works", async () => {
		const { spawn, attempted } = fakeSpawn({});

		await expect(copyToClipboard("text", { platform: "linux", env: {}, spawn })).rejects.toThrow(
			ClipboardError,
		);
		expect(attempted).toEqual(["xclip", "xsel", "wl-copy"]);
	});

	it("names the install options in the failure message", async () => {
		const { spawn } = fakeSpawn({});

		await expect(copyToClipboard("text", { platform: "linux", env: {}, spawn })).rejects.toThrow(
			/wl-clipboard, xclip, or xsel/,
		);
	});
});
