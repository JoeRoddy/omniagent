import { spawn as nodeSpawn } from "node:child_process";

export type ClipboardCommand = {
	command: string;
	args: string[];
};

export class ClipboardError extends Error {
	readonly code = "clipboard_unavailable";

	constructor(message: string) {
		super(message);
		this.name = "ClipboardError";
	}
}

/**
 * Ordered candidates per platform. On Linux the session type decides which helper is likely to
 * exist, but every candidate is still attempted so an unusual setup keeps working.
 */
export function clipboardCandidates(
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): ClipboardCommand[] {
	if (platform === "darwin") {
		return [{ command: "pbcopy", args: [] }];
	}
	if (platform === "win32") {
		return [{ command: "clip", args: [] }];
	}
	const wayland: ClipboardCommand = { command: "wl-copy", args: [] };
	const x11: ClipboardCommand[] = [
		{ command: "xclip", args: ["-selection", "clipboard"] },
		{ command: "xsel", args: ["--clipboard", "--input"] },
	];
	return env.WAYLAND_DISPLAY ? [wayland, ...x11] : [...x11, wayland];
}

export function clipboardHint(platform: NodeJS.Platform = process.platform): string {
	if (platform === "darwin") {
		return "pbcopy was not found on PATH.";
	}
	if (platform === "win32") {
		return "clip was not found on PATH.";
	}
	return "No clipboard helper found. Install wl-clipboard, xclip, or xsel.";
}

type SpawnLike = typeof nodeSpawn;

function tryCopy(candidate: ClipboardCommand, text: string, spawn: SpawnLike): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const child = spawn(candidate.command, candidate.args, {
			stdio: ["pipe", "ignore", "ignore"],
		});
		const fail = (error: Error) => {
			if (!settled) {
				settled = true;
				reject(error);
			}
		};
		child.on("error", fail);
		child.on("close", (code) => {
			if (settled) {
				return;
			}
			settled = true;
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${candidate.command} exited with code ${code}`));
			}
		});
		child.stdin?.on("error", fail);
		child.stdin?.end(text);
	});
}

/**
 * Copies text to the system clipboard, returning the helper that succeeded.
 * Throws ClipboardError only when every candidate fails, so a missing helper produces one clear
 * message rather than a stack trace.
 */
export async function copyToClipboard(
	text: string,
	options: {
		platform?: NodeJS.Platform;
		env?: NodeJS.ProcessEnv;
		spawn?: SpawnLike;
	} = {},
): Promise<ClipboardCommand> {
	const platform = options.platform ?? process.platform;
	const spawn = options.spawn ?? nodeSpawn;
	const candidates = clipboardCandidates(platform, options.env ?? process.env);

	const failures: string[] = [];
	for (const candidate of candidates) {
		try {
			await tryCopy(candidate, text, spawn);
			return candidate;
		} catch (error) {
			failures.push(`${candidate.command}: ${error instanceof Error ? error.message : error}`);
		}
	}
	throw new ClipboardError(`${clipboardHint(platform)} (tried ${failures.join("; ")})`);
}
