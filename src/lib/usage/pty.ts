import os from "node:os";
import { Terminal } from "@xterm/headless";
import pty from "node-pty";
import type { NormalizedUsageDebugArtifact } from "./types.js";

export type PtyStep = {
	waitMs?: number;
	write?: string;
	capture?: string;
	captureWaitMs?: number;
};

export type PtyScenarioOptions = {
	command: string;
	args?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	cols?: number;
	rows?: number;
	steps: PtyStep[];
	finalWaitMs?: number;
	timeoutMs?: number;
	debug?: {
		enabled?: boolean;
		includeRawOutput?: boolean;
		includeScreenSnapshots?: boolean;
	};
};

export type PtySnapshot = {
	raw: string;
	screen: string;
};

export type PtyScenarioResult = {
	command: string;
	args: string[];
	exitCode: number | null;
	timedOut: boolean;
	raw: string;
	screen: string;
	snapshots: Record<string, PtySnapshot>;
	debug: NormalizedUsageDebugArtifact[];
};

export function enterKey(): string {
	return os.platform() === "win32" ? "\r" : "\r";
}

export function escapeKey(): string {
	return "\x1b";
}

export function typeTextSteps(text: string, delayMs: number): PtyStep[] {
	return [...text].map((char) => ({ write: char, waitMs: delayMs }));
}

export function createHeadlessTerminal(cols = 100, rows = 40): Terminal {
	return new Terminal({
		allowProposedApi: true,
		cols,
		rows,
		scrollback: 1000,
	});
}

export async function runPtyScenario(options: PtyScenarioOptions): Promise<PtyScenarioResult> {
	const args = options.args ?? [];
	const cols = options.cols ?? 100;
	const rows = options.rows ?? 40;
	const terminal = createHeadlessTerminal(cols, rows);
	const snapshots: Record<string, PtySnapshot> = {};
	const debug: NormalizedUsageDebugArtifact[] = [];
	let raw = "";
	let exited = false;
	let exitCode: number | null = null;
	let timedOut = false;

	const child = pty.spawn(options.command, args, {
		name: "xterm-256color",
		cols,
		rows,
		cwd: options.cwd ?? process.cwd(),
		env: {
			...process.env,
			TERM: "xterm-256color",
			...options.env,
		},
	});

	const terminalDataDisposable = terminal.onData((data) => {
		if (!exited) {
			child.write(data);
		}
	});
	const terminalBinaryDisposable = terminal.onBinary((data) => {
		if (!exited) {
			child.write(data);
		}
	});

	child.onData((chunk) => {
		raw += chunk;
		terminal.write(chunk);
	});

	child.onExit((event) => {
		exited = true;
		exitCode = event.exitCode;
	});

	const timeout = setTimeout(() => {
		if (!exited) {
			timedOut = true;
			safeKillPty(child);
		}
	}, options.timeoutMs ?? 45_000);

	try {
		for (const step of options.steps) {
			if (step.waitMs != null) {
				await sleep(step.waitMs);
			}
			if (step.write != null) {
				child.write(step.write);
			}
			if (step.capture != null) {
				await sleep(step.captureWaitMs ?? 250);
				snapshots[step.capture] = {
					raw,
					screen: readScreen(terminal),
				};
			}
		}

		await sleep(options.finalWaitMs ?? 250);

		const screen = readScreen(terminal);
		if (options.debug?.enabled) {
			if (options.debug.includeRawOutput) {
				debug.push({
					type: "raw-output",
					label: "pty.raw",
					content: raw,
					command: formatCommand(options.command, args),
				});
			}
			if (options.debug.includeScreenSnapshots) {
				for (const [label, snapshot] of Object.entries(snapshots)) {
					debug.push({
						type: "screen-snapshot",
						label,
						content: snapshot.screen,
						mimeType: "text/plain",
					});
				}
				debug.push({
					type: "screen-snapshot",
					label: "final",
					content: screen,
					mimeType: "text/plain",
				});
			}
		}

		return {
			command: options.command,
			args,
			exitCode,
			timedOut,
			raw,
			screen,
			snapshots,
			debug,
		};
	} finally {
		clearTimeout(timeout);
		terminalDataDisposable.dispose();
		terminalBinaryDisposable.dispose();
		if (!exited) {
			safeKillPty(child);
		}
		terminal.dispose();
	}
}

export function readScreen(terminal: Terminal): string {
	const buffer = terminal.buffer.active;
	const lines: string[] = [];

	for (let i = 0; i < buffer.length; i += 1) {
		const line = buffer.getLine(i);
		if (line == null) {
			continue;
		}
		lines.push(line.translateToString(true));
	}

	return lines.join("\n");
}

export function safeKillPty(child: { kill: () => void }): void {
	try {
		child.kill();
	} catch {
		// Best-effort cleanup only; extraction callers report timeout/output context.
	}
}

function formatCommand(command: string, args: string[]): string {
	return [command, ...args].join(" ");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
