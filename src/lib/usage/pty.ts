import { constants } from "node:fs";
import { access, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import headless from "@xterm/headless";
import pty from "node-pty";
import type { NormalizedUsageDebugArtifact } from "./types.js";

const { Terminal } = headless;
type HeadlessTerminal = InstanceType<typeof Terminal>;
const require = createRequire(import.meta.url);

export type PtyStep = {
	skipIf?: PtyWaitFor;
	skipIfSource?: "raw" | "screen";
	waitMs?: number;
	write?: string;
	waitFor?: PtyWaitFor;
	waitForSource?: "raw" | "screen";
	waitForTimeoutMs?: number;
	optional?: boolean;
	capture?: string;
	captureWaitMs?: number;
};

export type PtyWaitSnapshot = {
	raw: string;
	screen: string;
};

export type PtyWaitFor = string | RegExp | ((snapshot: PtyWaitSnapshot) => boolean);

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
	signal?: AbortSignal;
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

type Disposable = {
	dispose: () => void;
};

type PtyChild = {
	write: (data: string) => void;
	kill: () => void;
	onData: (handler: (chunk: string) => void) => void;
	onExit: (handler: (event: { exitCode: number }) => void) => void;
};

export class PtyScenarioError extends Error {
	readonly command: string;
	readonly args: string[];
	readonly timedOut: boolean;
	readonly raw: string;
	readonly screen: string;
	readonly snapshots: Record<string, PtySnapshot>;
	readonly debug: NormalizedUsageDebugArtifact[];

	constructor(
		message: string,
		options: {
			command: string;
			args: string[];
			timedOut: boolean;
			raw: string;
			screen: string;
			snapshots: Record<string, PtySnapshot>;
			debug: NormalizedUsageDebugArtifact[];
		},
	) {
		super(message);
		this.name = "PtyScenarioError";
		this.command = options.command;
		this.args = options.args;
		this.timedOut = options.timedOut;
		this.raw = options.raw;
		this.screen = options.screen;
		this.snapshots = options.snapshots;
		this.debug = options.debug;
	}
}

export function enterKey(): string {
	return os.platform() === "win32" ? "\r" : "\r";
}

export function escapeKey(): string {
	return "\x1b";
}

export function typeTextSteps(text: string, delayMs: number): PtyStep[] {
	return [...text].map((char) => ({ write: char, waitMs: delayMs }));
}

export function createHeadlessTerminal(cols = 100, rows = 40): HeadlessTerminal {
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
	let raw = "";
	let exited = false;
	let exitCode: number | null = null;
	let timedOut = false;
	let child: PtyChild | null = null;
	let terminalDataDisposable: Disposable | null = null;
	let terminalBinaryDisposable: Disposable | null = null;
	let timeout: NodeJS.Timeout | null = null;
	let removeAbortListener: (() => void) | null = null;
	let cancelScenario: ((message: string) => void) | null = null;
	const timeoutMs = options.timeoutMs ?? 45_000;

	const buildScenarioError = (message: string): PtyScenarioError =>
		new PtyScenarioError(message, {
			command: options.command,
			args,
			timedOut,
			raw,
			screen: readScreen(terminal),
			snapshots: { ...snapshots },
			debug: buildDebugArtifacts({
				options,
				args,
				raw,
				screen: readScreen(terminal),
				snapshots,
			}),
		});
	const cancellationPromise = new Promise<never>((_, reject) => {
		cancelScenario = (message: string) => {
			if (!exited) {
				timedOut = true;
				if (child) {
					safeKillPty(child);
				}
			}
			reject(buildScenarioError(message));
		};
	});
	cancellationPromise.catch(() => {});
	if (options.signal) {
		const abortHandler = () => {
			cancelScenario?.(formatAbortReason(options.signal, timeoutMs));
		};
		if (options.signal.aborted) {
			abortHandler();
		} else {
			options.signal.addEventListener("abort", abortHandler, { once: true });
			removeAbortListener = () => options.signal?.removeEventListener("abort", abortHandler);
		}
	} else {
		timeout = setTimeout(() => {
			cancelScenario?.(`PTY scenario timed out after ${formatDuration(timeoutMs)}.`);
		}, timeoutMs);
	}
	const withScenarioTimeout = async <T>(promise: Promise<T>): Promise<T> =>
		Promise.race([promise, cancellationPromise]);
	const throwIfTimedOut = (): void => {
		if (timedOut) {
			throw buildScenarioError(`PTY scenario timed out after ${formatDuration(timeoutMs)}.`);
		}
	};

	try {
		await withScenarioTimeout(ensureNodePtySpawnHelperExecutable());

		child = pty.spawn(options.command, args, {
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

		terminalDataDisposable = terminal.onData((data) => {
			if (!exited && child) {
				child.write(data);
			}
		});
		terminalBinaryDisposable = terminal.onBinary((data) => {
			if (!exited && child) {
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

		if (!exited) {
			throwIfTimedOut();
		}

		for (const step of options.steps) {
			throwIfTimedOut();
			if (
				step.skipIf != null &&
				matchesWaitFor(
					step.skipIf,
					step.skipIfSource ?? "raw",
					() => raw,
					() => readScreen(terminal),
				)
			) {
				continue;
			}
			if (step.waitMs != null) {
				await withScenarioTimeout(sleep(step.waitMs));
				throwIfTimedOut();
			}
			if (step.write != null) {
				throwIfTimedOut();
				child.write(step.write);
			}
			if (step.waitFor != null) {
				const matched = await withScenarioTimeout(
					waitForOutput({
						match: step.waitFor,
						source: step.waitForSource ?? "raw",
						timeoutMs: step.waitForTimeoutMs ?? options.timeoutMs ?? 45_000,
						getRaw: () => raw,
						getScreen: () => readScreen(terminal),
					}),
				);
				throwIfTimedOut();
				if (!matched && !step.optional) {
					throw buildScenarioError(
						`Timed out waiting for ${step.capture ?? "expected TUI output"}.`,
					);
				}
			}
			if (step.capture != null) {
				await withScenarioTimeout(sleep(step.captureWaitMs ?? 250));
				throwIfTimedOut();
				snapshots[step.capture] = {
					raw,
					screen: readScreen(terminal),
				};
			}
		}

		await withScenarioTimeout(sleep(options.finalWaitMs ?? 250));
		throwIfTimedOut();

		const screen = readScreen(terminal);
		const debug = buildDebugArtifacts({ options, args, raw, screen, snapshots });

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
	} catch (error) {
		if (error instanceof PtyScenarioError) {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw buildScenarioError(message);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
		removeAbortListener?.();
		terminalDataDisposable?.dispose();
		terminalBinaryDisposable?.dispose();
		if (!exited && child) {
			safeKillPty(child);
		}
		terminal.dispose();
	}
}

function formatAbortReason(signal: AbortSignal | undefined, timeoutMs: number): string {
	const reason = signal?.reason;
	if (reason instanceof Error) {
		return reason.message;
	}
	if (typeof reason === "string" && reason.trim().length > 0) {
		return reason;
	}
	return `PTY scenario timed out after ${formatDuration(timeoutMs)}.`;
}

export function readScreen(terminal: HeadlessTerminal): string {
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

function buildDebugArtifacts(options: {
	options: PtyScenarioOptions;
	args: string[];
	raw: string;
	screen: string;
	snapshots: Record<string, PtySnapshot>;
}): NormalizedUsageDebugArtifact[] {
	if (!options.options.debug?.enabled) {
		return [];
	}

	const debug: NormalizedUsageDebugArtifact[] = [];
	if (options.options.debug.includeRawOutput) {
		debug.push({
			type: "raw-output",
			label: "pty.raw",
			content: options.raw,
			command: formatCommand(options.options.command, options.args),
		});
	}
	if (options.options.debug.includeScreenSnapshots) {
		for (const [label, snapshot] of Object.entries(options.snapshots)) {
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
			content: options.screen,
			mimeType: "text/plain",
		});
	}
	return debug;
}

function formatDuration(timeoutMs: number): string {
	if (timeoutMs % 60_000 === 0) {
		return `${timeoutMs / 60_000}m`;
	}
	if (timeoutMs % 1_000 === 0) {
		return `${timeoutMs / 1_000}s`;
	}
	return `${timeoutMs}ms`;
}

async function waitForOutput(options: {
	match: PtyWaitFor;
	source: "raw" | "screen";
	timeoutMs: number;
	getRaw: () => string;
	getScreen: () => string;
}): Promise<boolean> {
	const intervalMs = 50;
	const deadline = Date.now() + options.timeoutMs;

	while (Date.now() <= deadline) {
		if (matchesWaitFor(options.match, options.source, options.getRaw, options.getScreen)) {
			return true;
		}

		const remainingMs = deadline - Date.now();
		if (remainingMs <= 0) {
			break;
		}
		await sleep(Math.min(intervalMs, remainingMs));
	}

	return matchesWaitFor(options.match, options.source, options.getRaw, options.getScreen);
}

function matchesWaitFor(
	match: PtyWaitFor,
	source: "raw" | "screen",
	getRaw: () => string,
	getScreen: () => string,
): boolean {
	if (typeof match === "function") {
		return match({ raw: getRaw(), screen: getScreen() });
	}

	const value = source === "screen" ? getScreen() : getRaw();
	if (typeof match === "string") {
		return value.includes(match);
	}

	match.lastIndex = 0;
	return match.test(value);
}

async function ensureNodePtySpawnHelperExecutable(): Promise<void> {
	if (process.platform === "win32") {
		return;
	}

	// node-pty prebuilds can lose the executable bit; restore it before spawning when possible.
	const packageRoot = path.dirname(require.resolve("node-pty/package.json"));
	const candidates = [
		path.join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
		path.join(packageRoot, "build", "Release", "spawn-helper"),
	];

	for (const candidate of candidates) {
		if (!(await fileExists(candidate))) {
			continue;
		}
		try {
			await access(candidate, constants.X_OK);
			return;
		} catch {
			try {
				await chmod(candidate, 0o755);
				return;
			} catch {}
		}
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
