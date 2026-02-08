import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ENABLE_E2E_SYNC = process.env.OA_E2E_SYNC === "1";
const ROOT_DIR = process.cwd();
const CLI_PATH = path.join(ROOT_DIR, "dist", "cli.js");
export const CLI_EXISTS = existsSync(CLI_PATH);
export const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CLI_COMMANDS = ["codex", "claude", "gemini", "copilot"];

if (ENABLE_E2E_SYNC && !CLI_EXISTS) {
	console.warn("dist/cli.js not found. Run the build before E2E tests.");
}

export const SYNC_E2E_SUITE = ENABLE_E2E_SYNC && CLI_EXISTS ? describe.sequential : describe.skip;

export type E2EContext = {
	root: string;
	homeDir: string;
	env: NodeJS.ProcessEnv;
};

export type SyncProcessResult = {
	status: number;
	stdout: string;
	stderr: string;
};

export type SyncJsonSummary = {
	status?: string;
	failedTemplatePath?: string | null;
	failedBlockId?: string | null;
	partialOutputsWritten?: boolean;
	instructions?: {
		warnings?: string[];
	};
};

async function createFakeCliBin(
	root: string,
	commands: string[] = DEFAULT_CLI_COMMANDS,
	binDirName = "bin",
): Promise<string> {
	const binDir = path.join(root, binDirName);
	await mkdir(binDir, { recursive: true });
	const isWindows = process.platform === "win32";
	for (const command of commands) {
		const basePath = path.join(binDir, command);
		const contents = isWindows ? "@echo off\r\n" : "#!/usr/bin/env sh\nexit 0\n";
		await writeFile(basePath, contents, "utf8");
		await chmod(basePath, 0o755);
		if (isWindows) {
			const cmdPath = path.join(binDir, `${command}.cmd`);
			await writeFile(cmdPath, "@echo off\r\n", "utf8");
		}
	}
	return binDir;
}

export async function withTempRepo(fn: (context: E2EContext) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-sync-e2e-"));
	const homeDir = path.join(root, "home");
	const binDir = await createFakeCliBin(root);
	await mkdir(homeDir, { recursive: true });
	await writeFile(path.join(root, "package.json"), "{}\n", "utf8");

	const env: NodeJS.ProcessEnv = {
		...process.env,
		HOME: homeDir,
		USERPROFILE: homeDir,
		PATH: [binDir, process.env.PATH].filter(Boolean).join(path.delimiter),
		NO_COLOR: "1",
		TERM: "dumb",
	};

	try {
		await fn({ root, homeDir, env });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

export function runBuiltSync(context: E2EContext, args: string[]): SyncProcessResult {
	const result = spawnSync(process.execPath, [CLI_PATH, "sync", ...args], {
		cwd: context.root,
		encoding: "utf8",
		env: context.env,
		timeout: DEFAULT_TIMEOUT_MS,
	});

	if (result.error) {
		throw result.error;
	}

	return {
		status: result.status ?? 0,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

export function assertExitCode(result: SyncProcessResult, expected: number): void {
	if (result.status !== expected) {
		throw new Error(
			[
				`Expected exit code ${expected}, received ${result.status}.`,
				"stdout:",
				result.stdout,
				"stderr:",
				result.stderr,
			].join("\n"),
		);
	}
}

export function parseJsonSummary(result: SyncProcessResult): SyncJsonSummary {
	const trimmed = result.stdout.trim();
	if (trimmed.length === 0) {
		throw new Error(`Expected JSON stdout, but output was empty.\nstderr:\n${result.stderr}`);
	}
	try {
		return JSON.parse(trimmed) as SyncJsonSummary;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse JSON stdout: ${message}\nstdout:\n${result.stdout}`);
	}
}

export async function pathExists(candidate: string): Promise<boolean> {
	try {
		await stat(candidate);
		return true;
	} catch {
		return false;
	}
}

export async function writeCommandTemplate(
	root: string,
	name: string,
	contents: string,
): Promise<void> {
	const sourceDir = path.join(root, "agents", "commands");
	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(sourceDir, `${name}.md`), contents, "utf8");
}

export async function writeSkillTemplate(
	root: string,
	name: string,
	contents: string,
): Promise<void> {
	const skillDir = path.join(root, "agents", "skills", name);
	await mkdir(skillDir, { recursive: true });
	await writeFile(path.join(skillDir, "SKILL.md"), contents, "utf8");
}

export async function writeInstructionTemplate(
	root: string,
	relPath: string,
	contents: string,
): Promise<void> {
	const filePath = path.join(root, relPath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, contents, "utf8");
}

export function shellFailureScript(): string {
	if (process.platform === "win32") {
		return ["echo boom 1>&2", "exit /b 1"].join("\n");
	}
	return ["echo boom >&2", "exit 1"].join("\n");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toPortablePathPattern(pathValue: string): RegExp {
	const normalized = pathValue
		.split("/")
		.map((segment) => escapeRegExp(segment))
		.join("[\\\\/]");
	return new RegExp(normalized);
}
