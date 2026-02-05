import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENT_MODULES } from "./agents.js";
import { SHARED_CASES } from "./cases.js";
import { type ExpectedInvocation, getExpectedInvocation } from "./expected-invocations.js";

type TracePayload = {
	agent: string;
	mode: string;
	command: string;
	args: string[];
	shimArgs: string[];
	passthroughArgs: string[];
	warnings: string[];
	requests: Record<string, unknown>;
};

const RECORD_BASELINE =
	process.env.OA_E2E_RECORD_BASELINE === "1" ||
	process.env.OA_E2E_RECORD === "baseline" ||
	process.env.OA_E2E_RECORD === "1";
const ENABLE_E2E = process.env.OA_E2E === "1" || RECORD_BASELINE || false;
const AGENT_FILTER = process.env.OA_E2E_AGENT?.split(",")
	.map((value) => value.trim().toLowerCase())
	.filter(Boolean);

const ROOT_DIR = process.cwd();
const CLI_PATH = path.join(ROOT_DIR, "dist", "cli.js");
const CLI_EXISTS = existsSync(CLI_PATH);
const SUITE = ENABLE_E2E && CLI_EXISTS ? describe : describe.skip;
const DEFAULT_TIMEOUT_MS = 120_000;
const TRACE_PREFIX = "OA_TRANSLATION=";
const JSON_CASES = new Set(["output-json", "output-flag-json", "output-stream-json"]);

if (ENABLE_E2E && !CLI_EXISTS) {
	console.warn("dist/cli.js not found. Run the build before E2E tests.");
}

function resolveExpectedDir(expectedDir: string | URL): string {
	if (typeof expectedDir === "string") {
		return expectedDir;
	}
	return fileURLToPath(expectedDir);
}

function resolveExpectedPaths(baseDir: string, caseId: string) {
	return {
		stdout: path.join(baseDir, `${caseId}.stdout.txt`),
		stderr: path.join(baseDir, `${caseId}.stderr.txt`),
		trace: path.join(baseDir, `${caseId}.trace.json`),
	};
}

function extractTrace(stderr: string): { trace: TracePayload | null; cleaned: string } {
	let trace: TracePayload | null = null;
	const lines = stderr.split(/\r?\n/);
	const hadTrailingNewline = lines.length > 0 && lines[lines.length - 1] === "";
	if (hadTrailingNewline) {
		lines.pop();
	}
	const kept: string[] = [];

	for (const line of lines) {
		if (!trace && line.startsWith(TRACE_PREFIX)) {
			const payload = line.slice(TRACE_PREFIX.length).trim();
			trace = JSON.parse(payload) as TracePayload;
			continue;
		}
		kept.push(line);
	}

	let cleaned = kept.join("\n");
	if (hadTrailingNewline && cleaned.length > 0) {
		cleaned += "\n";
	}

	return { trace, cleaned };
}

function commandAvailable(command: string): boolean {
	const result = spawnSync(command, ["--version"], { stdio: "ignore" });
	if (result.error) {
		return false;
	}
	return true;
}

function missingEnvVars(requiredEnv: string[] | undefined): string[] {
	if (!requiredEnv || requiredEnv.length === 0) {
		return [];
	}
	return requiredEnv.filter((name) => !process.env[name]);
}

async function writeExpectedFiles(
	paths: ReturnType<typeof resolveExpectedPaths>,
	stdout: string,
	stderr: string,
	invocation: ExpectedInvocation,
) {
	await mkdir(path.dirname(paths.stdout), { recursive: true });
	await writeFile(paths.stdout, stdout, "utf8");
	await writeFile(paths.stderr, stderr, "utf8");
	await writeFile(paths.trace, `${JSON.stringify(invocation, null, 2)}\n`, "utf8");
}

async function readExpectedFiles(paths: ReturnType<typeof resolveExpectedPaths>) {
	const [stdout, stderr, traceRaw] = await Promise.all([
		readFile(paths.stdout, "utf8"),
		readFile(paths.stderr, "utf8"),
		readFile(paths.trace, "utf8"),
	]);

	return {
		stdout,
		stderr,
		invocation: JSON.parse(traceRaw) as ExpectedInvocation,
	};
}

function stripWarnings(stderr: string, warnings: string[]): string {
	if (warnings.length === 0) {
		return stderr;
	}
	const lines = stderr.split(/\r?\n/);
	const hadTrailingNewline = lines.length > 0 && lines[lines.length - 1] === "";
	if (hadTrailingNewline) {
		lines.pop();
	}
	const warningSet = new Set(warnings);
	const kept = lines.filter((line) => !warningSet.has(line));

	const cleaned = kept.join("\n");
	return cleaned.trimEnd();
}

function canonicalizeAnswer(text: string): string {
	if (/\bpolo\b/i.test(text)) {
		return "polo";
	}
	const trimmed = text.trim();
	if (!trimmed) {
		return "";
	}
	const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
	const lastLine = lines.length > 0 ? lines[lines.length - 1] : trimmed;
	const words = lastLine.trim().split(/\s+/);
	const lastWord = words.length > 0 ? words[words.length - 1] : lastLine;
	const normalized = lastWord.replace(/[^a-z0-9]+/gi, "").toLowerCase();
	return normalized || lastLine.toLowerCase();
}

function parseJsonAgentMessages(output: string): { messages: string[]; parseErrors: number } {
	const lines = output.split(/\r?\n/);
	const messages: string[] = [];
	let parseErrors = 0;

	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}

		try {
			const parsed = JSON.parse(line) as {
				type?: string;
				item?: { type?: string; text?: string };
			};
			if (
				parsed?.type === "item.completed" &&
				parsed.item?.type === "agent_message" &&
				typeof parsed.item.text === "string"
			) {
				messages.push(parsed.item.text);
			}
		} catch {
			parseErrors += 1;
		}
	}

	return { messages, parseErrors };
}

function normalizeStdout(agentId: string, caseId: string, stdout: string): string {
	if (JSON_CASES.has(caseId)) {
		const { messages, parseErrors } = parseJsonAgentMessages(stdout);
		if (parseErrors > 0 || messages.length === 0) {
			return "__INVALID_JSON__";
		}
		return canonicalizeAnswer(messages[messages.length - 1]);
	}

	if (agentId === "gemini") {
		return stdout.trim().length > 0 ? "__NONEMPTY__" : "";
	}

	return canonicalizeAnswer(stdout);
}

function normalizeCodexStderr(stderr: string): string {
	const hadTrailingNewline = stderr.endsWith("\n");
	let lines = stderr.split(/\r?\n/);
	if (hadTrailingNewline) {
		lines.pop();
	}

	lines = lines.filter((line) => {
		if (line.trim().length === 0) {
			return false;
		}
		return !line.toLowerCase().startsWith("session id:");
	});

	const cutMarkers = new Set(["thinking", "tokens used", "codex"]);
	const cutIndex = lines.findIndex((line) => cutMarkers.has(line.trim().toLowerCase()));
	const kept = cutIndex >= 0 ? lines.slice(0, cutIndex) : lines;

	let cleaned = kept.join("\n");
	if (hadTrailingNewline && cleaned.length > 0) {
		cleaned += "\n";
	}
	return cleaned;
}

function normalizeStderr(agentId: string, stderr: string): string {
	if (agentId === "codex") {
		return normalizeCodexStderr(stderr);
	}
	if (agentId === "gemini") {
		const lines = stderr.split(/\r?\n/);
		const filtered = lines.filter((line) => {
			if (line.trim().length === 0) {
				return false;
			}
			if (line.startsWith("Attempt ")) {
				return false;
			}
			if (line.startsWith("Error executing tool ")) {
				return false;
			}
			return true;
		});
		return filtered.join("\n").trimEnd();
	}
	return stderr;
}

SUITE("CLI shim e2e", () => {
	if (!ENABLE_E2E || !CLI_EXISTS) {
		return;
	}

	for (const module of AGENT_MODULES) {
		const agent = module.agentConfig;
		const expectedDir = resolveExpectedDir(module.expectedDir);

		const filtered = AGENT_FILTER && !AGENT_FILTER.includes(agent.agentId);
		const missingEnv = filtered ? [] : missingEnvVars(agent.requiredEnv);
		const missingBinary =
			filtered || missingEnv.length > 0 ? false : !commandAvailable(agent.cliCommand);
		const suiteForAgent =
			filtered || missingEnv.length > 0 || missingBinary ? describe.skip : describe;

		suiteForAgent(agent.agentId, () => {
			if (filtered || missingEnv.length > 0 || missingBinary) {
				const reason = filtered
					? `Filtered by OA_E2E_AGENT (${agent.agentId}).`
					: missingEnv.length > 0
						? `Missing env: ${missingEnv.join(", ")}`
						: `Missing CLI command: ${agent.cliCommand}`;
				console.warn(reason);
				return;
			}

			for (const testCase of SHARED_CASES) {
				const skipReason = testCase.skipWhen?.(agent) ?? null;
				if (skipReason) {
					it.skip(`${agent.agentId} ${testCase.id} (${skipReason})`, () => {});
					continue;
				}

				const expectedInvocation = getExpectedInvocation(testCase.id, agent);
				if (!expectedInvocation) {
					it.skip(`${agent.agentId} ${testCase.id} (unsupported)`, () => {});
					continue;
				}

				const testTimeout = (agent.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 10_000;

				it(
					`${agent.agentId} ${testCase.id}`,
					async () => {
						const env = { ...process.env, ...agent.extraEnv };
						if (!env.NO_COLOR) {
							env.NO_COLOR = "1";
						}
						if (!env.TERM) {
							env.TERM = "dumb";
						}

						const expectedPaths = resolveExpectedPaths(expectedDir, testCase.id);

						if (RECORD_BASELINE) {
							const result = spawnSync(expectedInvocation.command, expectedInvocation.args, {
								cwd: ROOT_DIR,
								encoding: "utf8",
								env,
								timeout: agent.timeoutMs ?? DEFAULT_TIMEOUT_MS,
							});

							if (result.error) {
								throw result.error;
							}

							const stdout = result.stdout ?? "";
							const stderr = result.stderr ?? "";
							const exitCode = result.status ?? 0;

							expect(exitCode).toBe(0);
							await writeExpectedFiles(expectedPaths, stdout, stderr, expectedInvocation);
							return;
						}

						const args = testCase.buildArgs(agent);
						const passthrough = [
							...(agent.passthroughDefaults ?? []),
							...(testCase.buildPassthrough?.(agent) ?? []),
						];
						const fullArgs = ["--agent", agent.agentId, "--trace-translate", ...args];
						if (passthrough.length > 0) {
							fullArgs.push("--", ...passthrough);
						}

						const result = spawnSync(process.execPath, [CLI_PATH, ...fullArgs], {
							cwd: ROOT_DIR,
							encoding: "utf8",
							env,
							timeout: agent.timeoutMs ?? DEFAULT_TIMEOUT_MS,
						});

						if (result.error) {
							throw result.error;
						}

						const stdout = result.stdout ?? "";
						const stderr = result.stderr ?? "";
						const exitCode = result.status ?? 0;

						expect(exitCode).toBe(0);

						const { trace, cleaned } = extractTrace(stderr);
						if (!trace) {
							throw new Error("Missing translation trace in stderr.");
						}

						const cleanedWithoutWarnings = stripWarnings(cleaned, trace.warnings ?? []);

						const expected = await readExpectedFiles(expectedPaths);
						const normalizedStdout = normalizeStdout(agent.agentId, testCase.id, stdout);
						const normalizedExpectedStdout = normalizeStdout(
							agent.agentId,
							testCase.id,
							expected.stdout,
						);
						expect(normalizedStdout).toBe(normalizedExpectedStdout);

						const normalizedStderr = normalizeStderr(agent.agentId, cleanedWithoutWarnings);
						const normalizedExpectedStderr = normalizeStderr(agent.agentId, expected.stderr);
						expect(normalizedStderr).toBe(normalizedExpectedStderr);
						expect(trace.command).toBe(expected.invocation.command);
						expect(trace.args).toEqual(expected.invocation.args);
						if (expected.invocation.warnings) {
							expect(trace.warnings).toEqual(expected.invocation.warnings);
						}
					},
					testTimeout,
				);
			}
		});
	}
});
