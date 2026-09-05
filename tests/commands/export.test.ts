import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

function slug(absolutePath: string): string {
	return absolutePath.replace(/[^a-zA-Z0-9]/g, "-");
}

type Fixture = {
	root: string;
	homeDir: string;
	repo: string;
};

const CLAUDE_SESSION = "5000f3fc-7e42-4dd8-b368-4587aa32b102";
const CODEX_SESSION = "019fb9f2-b5d6-72d2-a068-84023973af37";
/** Present in both agents' histories, to exercise the ambiguity path. */
const SHARED_SESSION = "shared-id";

function claudeRecord(
	record: Record<string, unknown>,
	repo: string,
	sessionId = CLAUDE_SESSION,
): string {
	return JSON.stringify({ sessionId, cwd: repo, gitBranch: "main", ...record });
}

function claudeSession(repo: string, sessionId = CLAUDE_SESSION): string {
	const assistant = (block: unknown, id: string, timestamp: string) =>
		claudeRecord(
			{
				type: "assistant",
				timestamp,
				message: { id, model: "claude-test-1", role: "assistant", content: [block] },
			},
			repo,
			sessionId,
		);
	return [
		claudeRecord(
			{
				type: "user",
				timestamp: "2026-08-05T10:00:00.000Z",
				message: { role: "user", content: "take a look at this project" },
			},
			repo,
			sessionId,
		),
		assistant({ type: "text", text: "I'll survey the repo." }, "msg_1", "2026-08-05T10:00:30.000Z"),
		assistant(
			{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls -la" } },
			"msg_1",
			"2026-08-05T10:00:31.000Z",
		),
		claudeRecord(
			{
				type: "user",
				timestamp: "2026-08-05T10:00:32.000Z",
				message: {
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "total 12\nsrc" }],
				},
			},
			repo,
			sessionId,
		),
		assistant(
			{ type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "/repo/README.md" } },
			"msg_2",
			"2026-08-05T10:00:40.000Z",
		),
		claudeRecord(
			{
				type: "user",
				timestamp: "2026-08-05T10:00:41.000Z",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_2",
							content: "File not found",
							is_error: true,
						},
					],
				},
			},
			repo,
			sessionId,
		),
		JSON.stringify({ type: "attachment", attachment: { type: "skill_listing" }, sessionId }),
		JSON.stringify({ type: "queue-operation", operation: "enqueue", sessionId }),
		assistant({ type: "text", text: "Here is the summary." }, "msg_3", "2026-08-05T10:02:00.000Z"),
		claudeRecord(
			{
				type: "user",
				timestamp: "2026-08-05T10:03:00.000Z",
				message: { role: "user", content: "thanks" },
			},
			repo,
			sessionId,
		),
		"",
	].join("\n");
}

function codexSession(repo: string, sessionId = CODEX_SESSION): string {
	const line = (timestamp: string, type: string, payload: Record<string, unknown>) =>
		JSON.stringify({ timestamp, type, payload });
	return [
		line("2026-08-06T10:00:00.000Z", "session_meta", { id: sessionId, cwd: repo }),
		line("2026-08-06T10:00:00.500Z", "turn_context", { model: "gpt-test", cwd: repo }),
		line("2026-08-06T10:00:01.000Z", "event_msg", {
			type: "user_message",
			message: "codex please list files",
		}),
		line("2026-08-06T10:00:02.000Z", "response_item", {
			type: "function_call",
			name: "exec_command",
			arguments: '{"cmd":"ls"}',
			call_id: "call_1",
		}),
		line("2026-08-06T10:00:03.000Z", "response_item", {
			type: "function_call_output",
			call_id: "call_1",
			output: "a\nb\n",
		}),
		line("2026-08-06T10:00:04.000Z", "event_msg", { type: "agent_message", message: "Listed." }),
		"",
	].join("\n");
}

async function withExportHome(fn: (fixture: Fixture) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-export-"));
	const homeDir = path.join(root, "home");
	const repo = path.join(root, "repo");
	await mkdir(repo, { recursive: true });
	// findRepoRoot looks for .git or package.json.
	await writeFile(path.join(repo, "package.json"), "{}\n");

	const claudeProject = path.join(homeDir, ".claude", "projects", slug(repo));
	await mkdir(path.join(claudeProject, CLAUDE_SESSION, "subagents"), { recursive: true });
	await writeFile(path.join(claudeProject, `${CLAUDE_SESSION}.jsonl`), claudeSession(repo));
	// A subagent transcript sharing the session id must not be folded into the export.
	await writeFile(
		path.join(claudeProject, CLAUDE_SESSION, "subagents", "agent-x.jsonl"),
		`${claudeRecord(
			{
				type: "user",
				isSidechain: true,
				timestamp: "2026-08-05T10:01:00.000Z",
				message: { role: "user", content: "SUBAGENT DISPATCH PROMPT" },
			},
			repo,
		)}\n`,
	);
	await writeFile(
		path.join(claudeProject, `${SHARED_SESSION}.jsonl`),
		claudeSession(repo, SHARED_SESSION),
	);

	const codexDay = path.join(homeDir, ".codex", "sessions", "2026", "08", "06");
	await mkdir(codexDay, { recursive: true });
	await writeFile(path.join(codexDay, `rollout-${CODEX_SESSION}.jsonl`), codexSession(repo));
	await writeFile(
		path.join(codexDay, `rollout-${SHARED_SESSION}.jsonl`),
		codexSession(repo, SHARED_SESSION),
	);

	try {
		await fn({ root, homeDir, repo });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe.sequential("export command", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let homeSpy: ReturnType<typeof vi.spyOn> | null = null;
	let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;
	let originalNoColor: string | undefined;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		originalNoColor = process.env.NO_COLOR;
		process.env.NO_COLOR = "1";
		process.exitCode = undefined;
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
		homeSpy?.mockRestore();
		cwdSpy?.mockRestore();
		homeSpy = null;
		cwdSpy = null;
		if (originalNoColor === undefined) {
			delete process.env.NO_COLOR;
		} else {
			process.env.NO_COLOR = originalNoColor;
		}
		process.exitCode = undefined;
	});

	function useFixture(fixture: Fixture, cwd = fixture.repo): void {
		homeSpy = vi.spyOn(os, "homedir").mockReturnValue(fixture.homeDir);
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
	}

	function stdout(): string {
		return logSpy.mock.calls.map(([value]) => String(value)).join("\n");
	}

	function stderr(): string {
		return errorSpy.mock.calls.map(([value]) => String(value)).join("\n");
	}

	async function exportCli(args: string[]): Promise<void> {
		await runCli(["node", "omniagent", "export", ...args]);
	}

	function envelope(): {
		session: Record<string, unknown> | null;
		events: Array<Record<string, unknown>>;
		errors: Array<Record<string, string>>;
		notes: Array<Record<string, string>>;
	} {
		return JSON.parse(stdout());
	}

	describe("chat log output", () => {
		it("prints a Claude session with tool calls collapsed by default", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([CLAUDE_SESSION]);

				const output = stdout();
				expect(output).toContain(`# Claude Code session ${CLAUDE_SESSION}`);
				expect(output).toContain(`- Project: ${fixture.repo} (main)`);
				expect(output).toContain("- Model: claude-test-1");
				expect(output).toContain(
					"- Messages: 2 user, 2 assistant · Tool calls: 2 (Bash ×1, Read ×1) · 1 failed",
				);
				// The session cwd is the current directory, so the resume line needs no cd prefix.
				expect(output).toContain(`- Resume: claude --resume ${CLAUDE_SESSION}`);
				expect(output).toContain("**user**");
				expect(output).toContain("take a look at this project");
				expect(output).toContain("I'll survey the repo.");
				expect(output).toContain("⋯ 2 tool calls (Bash ×1, Read ×1), 1 failed");
				expect(output).toContain("Here is the summary.");
				expect(output).toContain("thanks");
				// Collapsed means collapsed: no inputs, no outputs.
				expect(output).not.toContain("ls -la");
				expect(output).not.toContain("total 12");
				expect(output).not.toContain("File not found");
				// The subagent transcript is a separate session.
				expect(output).not.toContain("SUBAGENT DISPATCH PROMPT");
				// Order is preserved.
				expect(output.indexOf("I'll survey the repo.")).toBeLessThan(
					output.indexOf("⋯ 2 tool calls"),
				);
				expect(output.indexOf("⋯ 2 tool calls")).toBeLessThan(
					output.indexOf("Here is the summary."),
				);
				expect(exitSpy).not.toHaveBeenCalled();
				expect(stderr()).toBe("");
			});
		});

		it("expands every tool call with --verbose", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([CLAUDE_SESSION, "--verbose"]);

				const output = stdout();
				expect(output).not.toContain("⋯");
				expect(output).toContain("**tool call** Bash · ");
				expect(output).toContain(" · toolu_1");
				expect(output).toContain('"command": "ls -la"');
				expect(output).toContain("**tool result** Bash · ");
				expect(output).toContain("total 12\nsrc");
				expect(output).toContain("**tool result** Read · error · ");
				expect(output).toContain("File not found");
				expect(exitSpy).not.toHaveBeenCalled();
			});
		});

		it("prints a Codex session, including legacy events and function calls", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([CODEX_SESSION, "--verbose"]);

				const output = stdout();
				expect(output).toContain(`# OpenAI Codex session ${CODEX_SESSION}`);
				expect(output).toContain("- Model: gpt-test");
				expect(output).toContain(`- Resume: codex resume ${CODEX_SESSION}`);
				expect(output).toContain("codex please list files");
				expect(output).toContain("**tool call** exec_command · ");
				expect(output).toContain('"cmd": "ls"');
				expect(output).toContain("**tool result** exec_command · ");
				expect(output).toContain("Listed.");
				expect(exitSpy).not.toHaveBeenCalled();
			});
		});

		it("accepts a unique id prefix", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([CLAUDE_SESSION.slice(0, 8)]);

				expect(stdout()).toContain(`# Claude Code session ${CLAUDE_SESSION}`);
				expect(exitSpy).not.toHaveBeenCalled();
			});
		});

		it("prefixes the resume command with cd when run from another directory", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture, fixture.root);
				await exportCli([CLAUDE_SESSION]);

				expect(stdout()).toContain(
					`- Resume: cd ${fixture.repo} && claude --resume ${CLAUDE_SESSION}`,
				);
			});
		});
	});

	describe("--json", () => {
		it("emits the collapsed envelope by default", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([CLAUDE_SESSION, "--json"]);

				const result = envelope();
				expect(result.session).toEqual(
					expect.objectContaining({
						agentId: "claude",
						displayName: "Claude Code",
						sessionId: CLAUDE_SESSION,
						cwd: fixture.repo,
						gitBranch: "main",
						model: "claude-test-1",
						startedAt: "2026-08-05T10:00:00.000Z",
						endedAt: "2026-08-05T10:03:00.000Z",
						resumeCommand: `claude --resume ${CLAUDE_SESSION}`,
						toolCallsByName: { Bash: 1, Read: 1 },
					}),
				);
				expect(result.session).not.toHaveProperty("events");
				expect(result.events.map((event) => event.kind)).toEqual([
					"message",
					"message",
					"tool_calls",
					"message",
					"message",
				]);
				expect(result.events[2]).toEqual({
					kind: "tool_calls",
					count: 2,
					byName: { Bash: 1, Read: 1 },
					failed: 1,
					timestamp: "2026-08-05T10:00:31.000Z",
				});
				expect(result.errors).toEqual([]);
				expect(exitSpy).not.toHaveBeenCalled();
			});
		});

		it("emits raw events with --verbose", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([CLAUDE_SESSION, "--json", "--verbose"]);

				const kinds = envelope().events.map((event) => event.kind);
				expect(kinds).toEqual([
					"message",
					"message",
					"tool_call",
					"tool_result",
					"tool_call",
					"tool_result",
					"message",
					"message",
				]);
				expect(envelope().events[2]).toEqual({
					kind: "tool_call",
					callId: "toolu_1",
					name: "Bash",
					input: { command: "ls -la" },
					timestamp: "2026-08-05T10:00:31.000Z",
				});
			});
		});
	});

	describe("--output", () => {
		it("writes the chat log to a file and confirms on stderr", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				const target = path.join(fixture.root, "out", "chat.md");
				await mkdir(path.dirname(target), { recursive: true });
				await exportCli([CLAUDE_SESSION, "--output", target]);

				const written = await readFile(target, "utf8");
				expect(written).toContain(`# Claude Code session ${CLAUDE_SESSION}`);
				expect(written).toContain("⋯ 2 tool calls");
				expect(written.endsWith("\n")).toBe(true);
				expect(stdout()).toBe("");
				expect(stderr()).toContain("✓ Wrote");
				expect(stderr()).toContain("chat.md (8 events)");
				expect(exitSpy).not.toHaveBeenCalled();
			});
		});

		it("resolves a relative path from the current directory", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([CODEX_SESSION, "-o", "codex.md"]);

				const written = await readFile(path.join(fixture.repo, "codex.md"), "utf8");
				expect(written).toContain(`# OpenAI Codex session ${CODEX_SESSION}`);
			});
		});

		it("exits 1 when the file cannot be written", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([
					CLAUDE_SESSION,
					"--output",
					path.join(fixture.root, "missing-dir", "x.md"),
				]);

				expect(stderr()).toContain("Error: Could not write");
				expect(exitSpy).toHaveBeenCalledWith(1);
			});
		});
	});

	describe("resolution failures", () => {
		it("exits 1 with a hint when nothing matches", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli(["does-not-exist"]);

				expect(stdout()).toBe("");
				expect(stderr()).toMatch(
					/No session matching "does-not-exist" was found in (claude, codex|codex, claude) history\./,
				);
				expect(stderr()).toContain("omniagent search <query> --json");
				expect(exitSpy).toHaveBeenCalledWith(1);
			});
		});

		it("reports not found inside the JSON envelope", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli(["does-not-exist", "--json"]);

				const result = envelope();
				expect(result.session).toBeNull();
				expect(result.events).toEqual([]);
				expect(result.errors[0]?.code).toBe("session_not_found");
				expect(exitSpy).toHaveBeenCalledWith(1);
			});
		});

		it("exits 2 and lists the candidates when an id is ambiguous", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([SHARED_SESSION]);

				const errors = stderr();
				expect(errors).toContain(`"${SHARED_SESSION}" matches 2 sessions.`);
				expect(errors).toContain("--only <target>");
				expect(errors).toMatch(/claude\s+shared-id/);
				expect(errors).toMatch(/codex\s+shared-id/);
				expect(stdout()).toBe("");
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("exits 2 when a prefix matches several sessions", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				// "shared-id" exists in both agents' histories and nothing else starts with "s".
				await exportCli(["s"]);

				expect(stderr()).toContain("matches 2 sessions");
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("resolves an ambiguous id with --only", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([SHARED_SESSION, "--only", "codex"]);

				expect(stdout()).toContain(`# OpenAI Codex session ${SHARED_SESSION}`);
				expect(exitSpy).not.toHaveBeenCalled();
			});
		});

		it("rejects an unknown --only target", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([CLAUDE_SESSION, "--only", "nope"]);

				expect(stderr()).toContain("Unknown target name(s): nope.");
				expect(stderr()).toContain("Exportable targets:");
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects a target without history", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([CLAUDE_SESSION, "--only", "copilot"]);

				expect(stderr()).toContain("copilot does not record exportable history.");
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("requires a session id", async () => {
			await withExportHome(async (fixture) => {
				useFixture(fixture);
				await exportCli([]);

				expect(stderr()).toContain("Error: Missing required argument: session-id");
				expect(exitSpy).toHaveBeenCalledWith(1);
			});
		});

		it("survives an empty history directory", async () => {
			await withExportHome(async (fixture) => {
				await rm(path.join(fixture.homeDir, ".claude"), { recursive: true, force: true });
				await rm(path.join(fixture.homeDir, ".codex"), { recursive: true, force: true });
				useFixture(fixture);
				await exportCli([CLAUDE_SESSION]);

				expect(stderr()).toContain("No session matching");
				expect(exitSpy).toHaveBeenCalledWith(1);
			});
		});
	});

	describe("help", () => {
		it("describes the command and its flags", async () => {
			await runCli(["node", "omniagent", "export", "--help"]);

			const output = stdout();
			// The builder's usage string replaces the command description in yargs' help output.
			expect(output).toContain("omniagent export <session-id> [--verbose]");
			expect(output).toContain("--verbose");
			expect(output).toContain("--output");
			expect(output).toContain("--only");
			expect(output).toContain("--json");
			expect(output).toContain("Subagent transcripts are not included");
			expect(exitSpy).not.toHaveBeenCalled();
		});

		it("is listed among the root commands", async () => {
			await runCli(["node", "omniagent", "--help"]);

			expect(stdout()).toContain("omniagent export <session-id>");
		});
	});
});
