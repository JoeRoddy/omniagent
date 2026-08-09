import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/index.js";

// The clipboard is stubbed so the suite never writes to the developer's real clipboard, and so
// the copy paths behave identically on a CI box with no clipboard helper installed.
const clipboard = vi.hoisted(() => ({ copied: [] as string[], shouldFail: false }));
const automaticSince = vi.hoisted(() => ({ argument: null as "90d" | null }));
vi.mock("../../src/lib/history/clipboard.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/lib/history/clipboard.js")>();
	return {
		...actual,
		copyToClipboard: vi.fn(async (text: string) => {
			if (clipboard.shouldFail) {
				throw new actual.ClipboardError("No clipboard helper found.");
			}
			clipboard.copied.push(text);
			return { command: "stub", args: [] };
		}),
	};
});
vi.mock("../../src/lib/history/auto-since.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/lib/history/auto-since.js")>();
	return {
		...actual,
		chooseAutomaticSince(files: Parameters<typeof actual.chooseAutomaticSince>[0], now?: Date) {
			if (automaticSince.argument === null) {
				return actual.chooseAutomaticSince(files, now);
			}
			return {
				argument: automaticSince.argument,
				since: new Date("2026-05-11T12:00:00.000Z"),
			};
		},
	};
});

function slug(absolutePath: string): string {
	return absolutePath.replace(/[^a-zA-Z0-9]/g, "-");
}

type Fixture = {
	root: string;
	homeDir: string;
	repoAlpha: string;
	repoBeta: string;
};

const claudeUser = (text: string, timestamp: string, cwd: string, sessionId: string) =>
	JSON.stringify({
		type: "user",
		sessionId,
		cwd,
		gitBranch: "main",
		timestamp,
		message: { role: "user", content: text },
	});

const claudeAssistant = (text: string, timestamp: string, cwd: string, sessionId: string) =>
	JSON.stringify({
		type: "assistant",
		sessionId,
		cwd,
		timestamp,
		message: { role: "assistant", content: [{ type: "text", text }] },
	});

const claudeToolResult = (text: string, cwd: string, sessionId: string) =>
	JSON.stringify({
		type: "user",
		sessionId,
		cwd,
		timestamp: "2026-08-01T09:00:00.000Z",
		message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: text }] },
	});

const claudeSidechain = (text: string, timestamp: string, cwd: string, sessionId: string) =>
	JSON.stringify({
		type: "user",
		sessionId,
		cwd,
		timestamp,
		isSidechain: true,
		message: { role: "user", content: text },
	});

const codexMeta = (cwd: string, id: string) =>
	JSON.stringify({
		timestamp: "2026-08-01T09:00:00.000Z",
		type: "session_meta",
		payload: { id, session_id: `${id}-forked`, cwd },
	});

const codexUser = (text: string, timestamp: string) =>
	JSON.stringify({
		timestamp,
		type: "event_msg",
		payload: { type: "user_message", message: text },
	});

const codexResponseItem = (text: string, timestamp: string) =>
	JSON.stringify({
		timestamp,
		type: "response_item",
		payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
	});

async function withSearchHome(fn: (fixture: Fixture) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-search-"));
	const homeDir = path.join(root, "home");
	const repoAlpha = path.join(root, "repo-alpha");
	const repoBeta = path.join(root, "repo-beta");
	const nested = path.join(repoAlpha, "src", "nested");

	await mkdir(nested, { recursive: true });
	await mkdir(repoBeta, { recursive: true });
	// findRepoRoot looks for .git or package.json.
	await writeFile(path.join(repoAlpha, "package.json"), "{}\n");
	await writeFile(path.join(repoBeta, "package.json"), "{}\n");

	const claudeAlpha = path.join(homeDir, ".claude", "projects", slug(repoAlpha));
	const claudeBeta = path.join(homeDir, ".claude", "projects", slug(repoBeta));
	await mkdir(path.join(claudeAlpha, "sess-a", "subagents"), { recursive: true });
	await mkdir(claudeBeta, { recursive: true });

	await writeFile(
		path.join(claudeAlpha, "sess-a.jsonl"),
		[
			claudeUser(
				"resolve the MERGE conflict on alpha",
				"2026-08-05T10:00:00.000Z",
				repoAlpha,
				"sess-a",
			),
			claudeAssistant(
				"assistant mentions merge conflict",
				"2026-08-05T10:01:00.000Z",
				repoAlpha,
				"sess-a",
			),
			claudeToolResult("merge conflict in generated output", repoAlpha, "sess-a"),
			JSON.stringify({
				type: "user",
				sessionId: "sess-a",
				cwd: repoAlpha,
				isMeta: true,
				timestamp: "2026-08-05T10:02:00.000Z",
				message: { role: "user", content: "Base directory for this skill: merge conflict" },
			}),
			JSON.stringify({
				type: "user",
				sessionId: "sess-a",
				cwd: repoAlpha,
				timestamp: "2026-08-05T10:03:00.000Z",
				message: { role: "user", content: "<task-notification>merge conflict</task-notification>" },
			}),
			"",
		].join("\n"),
	);
	await writeFile(
		path.join(claudeAlpha, "sess-a", "subagents", "agent-x.jsonl"),
		`${claudeSidechain("dispatch: investigate the merge conflict", "2026-08-05T10:04:00.000Z", repoAlpha, "sess-a")}\n`,
	);
	await writeFile(
		path.join(claudeBeta, "sess-b.jsonl"),
		`${claudeUser("beta wants a merge conflict fix", "2026-08-04T10:00:00.000Z", repoBeta, "sess-b")}\n`,
	);

	const codexDay = path.join(homeDir, ".codex", "sessions", "2026", "08", "06");
	await mkdir(codexDay, { recursive: true });
	await writeFile(
		path.join(codexDay, "rollout-alpha.jsonl"),
		[
			codexMeta(repoAlpha, "roll-alpha"),
			codexUser("codex handles the merge conflict", "2026-08-06T10:00:00.000Z"),
			// The polluted duplicate of the same turn.
			codexResponseItem(
				"<environment_context><cwd>/x</cwd></environment_context> codex handles the merge conflict",
				"2026-08-06T10:00:00.000Z",
			),
			"",
		].join("\n"),
	);

	try {
		await fn({ root, homeDir, repoAlpha, repoBeta });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe.sequential("search command", () => {
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
		automaticSince.argument = null;
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

	function useFixture(fixture: Fixture, cwd = fixture.repoAlpha): void {
		homeSpy = vi.spyOn(os, "homedir").mockReturnValue(fixture.homeDir);
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);
	}

	function stdout(): string {
		return logSpy.mock.calls.map(([value]) => String(value)).join("\n");
	}

	function stderr(): string {
		return errorSpy.mock.calls.map(([value]) => String(value)).join("\n");
	}

	async function search(args: string[]): Promise<void> {
		await runCli(["node", "omniagent", "search", ...args]);
	}

	function envelope(): {
		matches: Array<Record<string, unknown>>;
		stats: Record<string, number | boolean>;
		scope: Record<string, unknown>;
		errors: Array<Record<string, string>>;
		notes: Array<Record<string, string>>;
	} {
		return JSON.parse(stdout());
	}

	describe("matching", () => {
		it("finds prompts case-insensitively across both agents", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--json", "--limit", "0"]);

				const texts = envelope().matches.map((match) => match.text as string);
				expect(texts).toContain("resolve the MERGE conflict on alpha");
				expect(texts).toContain("codex handles the merge conflict");
			});
		});

		it("ANDs separate terms regardless of order", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["conflict", "resolve", "--json", "--limit", "0"]);

				expect(envelope().matches.map((match) => match.text)).toEqual([
					"resolve the MERGE conflict on alpha",
				]);
			});
		});

		it("treats a quoted phrase as an exact match", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["conflict on alpha", "--json", "--limit", "0"]);

				expect(envelope().matches).toHaveLength(1);
			});
		});

		it("honours --case-sensitive", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["MERGE", "--case-sensitive", "--json", "--limit", "0"]);

				expect(envelope().matches).toHaveLength(1);
			});
		});

		it("supports --regex", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["--regex", "merge\\s+conflict", "--json", "--limit", "0"]);

				expect(envelope().matches.length).toBeGreaterThan(0);
			});
		});

		// yargs hands back a number for a bare numeric positional unless the type is declared.
		it("does not throw on a purely numeric query", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["123", "--json"]);

				expect(envelope().matches).toEqual([]);
				expect(exitSpy).not.toHaveBeenCalledWith(1);
			});
		});
	});

	describe("role filtering", () => {
		it("returns only what the human typed by default", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--json", "--limit", "0"]);

				const texts = envelope().matches.map((match) => match.text as string);
				// tool output, isMeta skill payloads, task-notification wrappers, assistant replies,
				// and subagent dispatch prompts are all excluded.
				expect(texts).not.toContain("merge conflict in generated output");
				expect(texts.some((text) => text.includes("Base directory"))).toBe(false);
				expect(texts.some((text) => text.includes("task-notification"))).toBe(false);
				expect(texts).not.toContain("assistant mentions merge conflict");
				expect(texts.some((text) => text.startsWith("dispatch:"))).toBe(false);
			});
		});

		it("returns assistant replies under --role assistant", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--role", "assistant", "--json", "--limit", "0"]);

				expect(envelope().matches.map((match) => match.text)).toContain(
					"assistant mentions merge conflict",
				);
			});
		});

		it("returns subagent transcripts under --role agent", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--role", "agent", "--json", "--limit", "0"]);

				const matches = envelope().matches;
				expect(matches.map((match) => match.text)).toEqual([
					"dispatch: investigate the merge conflict",
				]);
				expect(matches[0]?.role).toBe("agent");
			});
		});

		it("notes that an agent cannot answer a role it does not record", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--role", "agent", "--json", "--limit", "0"]);

				expect(envelope().notes.some((note) => note.code === "role_unsupported")).toBe(true);
			});
		});

		// The single most important regression: the same Codex turn is stored twice.
		it("never double-counts the Codex response_item duplicate", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["codex handles", "--only", "codex", "--json", "--limit", "0"]);

				const matches = envelope().matches;
				expect(matches).toHaveLength(1);
				expect(matches[0]?.text).toBe("codex handles the merge conflict");
			});
		});

		it("never surfaces injected environment_context", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["environment_context", "--json", "--limit", "0"]);

				expect(envelope().matches).toEqual([]);
			});
		});
	});

	describe("scope", () => {
		it("searches every project by default", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--json", "--limit", "0"]);

				const cwds = new Set(envelope().matches.map((match) => match.cwd));
				expect(cwds.has(fixture.repoAlpha)).toBe(true);
				expect(cwds.has(fixture.repoBeta)).toBe(true);
			});
		});

		it("scopes to the current repository with --project .", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--project", ".", "--json", "--limit", "0"]);

				const result = envelope();
				expect(result.scope.kind).toBe("path");
				expect(new Set(result.matches.map((match) => match.cwd))).toEqual(
					new Set([fixture.repoAlpha]),
				);
			});
		});

		it("resolves --project . from a subdirectory up to the repository root", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture, path.join(fixture.repoAlpha, "src", "nested"));
				await search(["merge conflict", "--project", ".", "--json", "--limit", "0"]);

				const result = envelope();
				expect(result.scope.projectPath).toBe(fixture.repoAlpha);
				expect(result.matches.length).toBeGreaterThan(0);
			});
		});

		it("scopes by substring when --project is not path-like", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--project", "repo-beta", "--json", "--limit", "0"]);

				const result = envelope();
				expect(result.scope.kind).toBe("substring");
				expect(new Set(result.matches.map((match) => match.cwd))).toEqual(
					new Set([fixture.repoBeta]),
				);
			});
		});

		it("filters by --since", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--since", "2026-08-06", "--json", "--limit", "0"]);

				expect(envelope().matches.map((match) => match.text)).toEqual([
					"codex handles the merge conflict",
				]);
			});
		});

		it("filters by --until", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--until", "2026-08-04", "--json", "--limit", "0"]);

				expect(envelope().matches.map((match) => match.text)).toEqual([
					"beta wants a merge conflict fix",
				]);
			});
		});
	});

	describe("adaptive cutoff", () => {
		it("prints the locked notice to stderr and exposes the effective JSON scope", async () => {
			await withSearchHome(async (fixture) => {
				automaticSince.argument = "90d";
				useFixture(fixture);
				await search(["merge conflict", "--json", "--limit", "0"]);

				const result = envelope();
				const message =
					"Large history detected: using `--since 90d`. Use `--all-history` for everything.";
				expect(() => JSON.parse(stdout())).not.toThrow();
				expect(stderr()).toBe(message);
				expect(stderr()).not.toContain("Note:");
				expect(result.scope.since).toBe("2026-05-11T12:00:00.000Z");
				expect(result.notes).toContainEqual({
					targetId: "",
					displayName: "",
					code: "automatic_since",
					message,
				});
			});
		});

		it("accepts --all-history and disables the automatic cutoff", async () => {
			await withSearchHome(async (fixture) => {
				automaticSince.argument = "90d";
				useFixture(fixture);
				await search(["merge conflict", "--all-history", "--json", "--limit", "0"]);

				const result = envelope();
				expect(result.matches).toHaveLength(3);
				expect(result.scope.since).toBeNull();
				expect(result.notes).not.toContainEqual(
					expect.objectContaining({ code: "automatic_since" }),
				);
				expect(stderr()).toBe("");
			});
		});

		it("lets an explicit --since bypass adaptation", async () => {
			await withSearchHome(async (fixture) => {
				automaticSince.argument = "90d";
				useFixture(fixture);
				await search(["merge conflict", "--since", "7d", "--json", "--limit", "0"]);

				expect(envelope().notes).not.toContainEqual(
					expect.objectContaining({ code: "automatic_since" }),
				);
				expect(stderr()).not.toContain("Large history detected");
			});
		});

		it("rejects --all-history with --since", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["x", "--all-history", "--since", "7d"]);

				expect(errorSpy).toHaveBeenCalledWith(
					"Error: Use either --all-history or --since/--until, not both.",
				);
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects --all-history with --until through the JSON-aware error path", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["x", "--all-history", "--until", "7d", "--json"]);

				expect(envelope().errors[0]?.code).toBe("conflicting_history_scope");
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("keeps the 10,000-result cap under --all-history", async () => {
			await withSearchHome(async (fixture) => {
				const agentsDir = path.join(fixture.repoAlpha, "agents");
				await mkdir(agentsDir, { recursive: true });
				await writeFile(
					path.join(agentsDir, "omniagent.config.mjs"),
					`export default {
	targets: [{
		id: "bulk",
		displayName: "Bulk Agent",
		history: {
			roles: ["user"],
			listFiles: async function* () {
				yield {
					path: "/virtual/bulk.json",
					projectPath: "/repo",
					sessionId: "bulk",
					modifiedAt: "2026-08-09T00:00:00.000Z",
					sizeBytes: 1,
				};
			},
			scan: {
				kind: "custom",
				read: async function* (file, context) {
					for (let index = 0; index < 10005; index += 1) {
						yield {
							agentId: context.targetId,
							role: "user",
							timestamp: new Date(Date.UTC(2026, 7, 1) + index).toISOString(),
							text: \`matching record \${index}\`,
							sessionId: "bulk",
							cwd: "/repo",
							sourcePath: file.path,
							recordIndex: index,
						};
					}
				},
			},
		},
	}],
};
`,
				);
				useFixture(fixture);
				await search(["matching", "--only", "bulk", "--all-history", "--limit", "0", "--json"]);

				const result = envelope();
				expect(result.matches).toHaveLength(10_000);
				expect(result.stats.matchedRecords).toBe(10_005);
				expect(result.stats.truncated).toBe(true);
			});
		});
	});

	describe("targets", () => {
		it("restricts to one agent with --only", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--only", "claude", "--json", "--limit", "0"]);

				expect(new Set(envelope().matches.map((match) => match.agentId))).toEqual(
					new Set(["claude"]),
				);
			});
		});

		it("excludes an agent with --skip", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--skip", "codex", "--json", "--limit", "0"]);

				expect(new Set(envelope().matches.map((match) => match.agentId))).toEqual(
					new Set(["claude"]),
				);
			});
		});

		it("rejects an unknown target", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--only", "bogus"]);

				expect(errorSpy).toHaveBeenCalledWith(
					expect.stringContaining("Unknown target name(s): bogus"),
				);
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects a target that records no history", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--only", "copilot"]);

				expect(errorSpy).toHaveBeenCalledWith(
					expect.stringContaining("does not record searchable history"),
				);
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects --only together with --skip", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--only", "claude", "--skip", "codex"]);

				expect(errorSpy).toHaveBeenCalledWith("Error: Use either --only or --skip, not both.");
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});
	});

	describe("ordering and limit", () => {
		it("returns matches newest first across agents", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--json", "--limit", "0"]);

				expect(envelope().matches.map((match) => match.timestamp)).toEqual([
					"2026-08-06T10:00:00.000Z",
					"2026-08-05T10:00:00.000Z",
					"2026-08-04T10:00:00.000Z",
				]);
			});
		});

		it("is deterministic across repeated runs", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--json", "--limit", "0"]);
				const first = envelope().matches.map((match) => match.sessionId);
				logSpy.mockClear();
				await search(["merge conflict", "--json", "--limit", "0"]);

				expect(envelope().matches.map((match) => match.sessionId)).toEqual(first);
			});
		});

		it("truncates to --limit while reporting the true total", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--limit", "1", "--json"]);

				const result = envelope();
				expect(result.matches).toHaveLength(1);
				expect(result.stats.matchedRecords).toBe(3);
				expect(result.stats.truncated).toBe(true);
			});
		});

		it("shows the truncation in human output", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--limit", "1"]);

				expect(stdout()).toContain("Showing 1 of 3 matches");
			});
		});
	});

	describe("output", () => {
		it("prints a resume command per hit, with a cd when the project differs", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture, fixture.repoBeta);
				await search(["merge conflict", "--only", "claude", "--limit", "0"]);

				const output = stdout();
				expect(output).toContain("claude --resume sess-a");
				expect(output).toContain(`cd ${fixture.repoAlpha} && claude --resume sess-a`);
				// The hit whose cwd is the current directory needs no cd prefix.
				expect(output).toContain("claude --resume sess-b");
				expect(output).not.toContain(`cd ${fixture.repoBeta}`);
			});
		});

		it("uses the Codex rollout id, not the forked session id", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["codex handles", "--only", "codex", "--json"]);

				expect(envelope().matches[0]?.resumeCommand).toContain("codex resume roll-alpha");
			});
		});

		it("collapses multi-line prompts into a single excerpt line", async () => {
			await withSearchHome(async (fixture) => {
				const sessionFile = path.join(
					fixture.homeDir,
					".claude",
					"projects",
					slug(fixture.repoAlpha),
					"multiline.jsonl",
				);
				await writeFile(
					sessionFile,
					`${claudeUser("line one\nline two\n\n   line three about zebras", "2026-08-07T10:00:00.000Z", fixture.repoAlpha, "sess-m")}\n`,
				);
				useFixture(fixture);
				await search(["zebras", "--json"]);

				const match = envelope().matches[0] as Record<string, string>;
				expect(match.excerpt).toBe("line one line two line three about zebras");
				// The full prompt keeps its newlines so it can be reused verbatim.
				expect(match.text).toContain("\n");
			});
		});

		it("reports zero matches on stdout and exits successfully", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["nothingmatchesthis"]);

				expect(stdout()).toContain('No matches for "nothingmatchesthis".');
				expect(exitSpy).not.toHaveBeenCalled();
			});
		});

		// stdout must stay a clean, pipeable result list even when there is something to say.
		it("keeps notes off stdout so --json stays parseable", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--role", "agent", "--json", "--limit", "0"]);

				expect(() => JSON.parse(stdout())).not.toThrow();
				expect(stderr()).toContain("Note:");
			});
		});

		it("emits a stable envelope shape", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--json"]);

				const result = JSON.parse(stdout());
				expect(result.schemaVersion).toBe(1);
				expect(Object.keys(result)).toEqual(
					expect.arrayContaining([
						"schemaVersion",
						"generatedAt",
						"query",
						"scope",
						"matches",
						"stats",
						"errors",
						"notes",
					]),
				);
			});
		});

		it("sanitizes terminal controls in human output", async () => {
			await withSearchHome(async (fixture) => {
				const sessionFile = path.join(
					fixture.homeDir,
					".claude",
					"projects",
					slug(fixture.repoAlpha),
					"unsafe.jsonl",
				);
				await writeFile(
					sessionFile,
					`${claudeUser("zebras before\x1b]52;c;YXR0YWNr\x07after", "2026-08-09T10:00:00.000Z", fixture.repoAlpha, "sess-unsafe")}\n`,
				);
				useFixture(fixture);
				await search(["zebras", "--full"]);

				expect(stdout()).not.toContain("\x1b");
				expect(stdout()).not.toContain("\x07");
				expect(stdout()).toContain("before");
				expect(stdout()).toContain("after");
			});
		});
	});

	describe("clipboard and raw output", () => {
		let writeSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			clipboard.copied.length = 0;
			clipboard.shouldFail = false;
			writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		});

		afterEach(() => {
			writeSpy.mockRestore();
		});

		function written(): string {
			return writeSpy.mock.calls.map(([value]) => String(value)).join("");
		}

		it("copies the newest match in full, newlines intact", async () => {
			await withSearchHome(async (fixture) => {
				const sessionFile = path.join(
					fixture.homeDir,
					".claude",
					"projects",
					slug(fixture.repoAlpha),
					"multi.jsonl",
				);
				await writeFile(
					sessionFile,
					`${claudeUser("line one\nline two about zebras", "2026-08-09T10:00:00.000Z", fixture.repoAlpha, "sess-z")}\n`,
				);
				useFixture(fixture);
				await search(["zebras", "--copy"]);

				expect(clipboard.copied).toEqual(["line one\nline two about zebras"]);
			});
		});

		it("does not truncate a copied message above 64 KiB", async () => {
			await withSearchHome(async (fixture) => {
				const sessionFile = path.join(
					fixture.homeDir,
					".claude",
					"projects",
					slug(fixture.repoAlpha),
					"huge.jsonl",
				);
				const huge = `${"a".repeat(65_535)}🎉 zebras tail`;
				await writeFile(
					sessionFile,
					`${claudeUser(huge, "2026-08-09T10:00:00.000Z", fixture.repoAlpha, "sess-huge")}\n`,
				);
				useFixture(fixture);
				await search(["zebras tail", "--copy"]);

				expect(clipboard.copied).toEqual([huge]);
			});
		});

		it("copies the result at an explicit index", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--copy", "3", "--limit", "0"]);

				expect(clipboard.copied).toEqual(["beta wants a merge conflict fix"]);
			});
		});

		it("rejects an out-of-range index", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--copy", "99", "--limit", "0"]);

				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("out of range"));
				expect(exitSpy).toHaveBeenCalledWith(2);
				expect(clipboard.copied).toEqual([]);
			});
		});

		// `--copy` placed before the query swallows a search term; that must fail loudly rather
		// than silently copying the wrong result.
		it("rejects a non-numeric index and names the fix", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["--copy", "merge", "conflict"]);

				expect(errorSpy).toHaveBeenCalledWith(
					expect.stringContaining("Put the query before the flag"),
				);
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("prints the text instead of losing it when the clipboard is unavailable", async () => {
			await withSearchHome(async (fixture) => {
				clipboard.shouldFail = true;
				useFixture(fixture);
				await search(["merge conflict", "--copy", "--limit", "0"]);

				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No clipboard helper"));
				expect(written()).toContain("codex handles the merge conflict");
				expect(exitSpy).toHaveBeenCalledWith(1);
			});
		});

		it("writes only the message text under --print", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--print", "--limit", "0"]);

				expect(written()).toBe("codex handles the merge conflict\n");
				// Nothing else may reach stdout, or a pipe would receive the listing too.
				expect(stdout()).toBe("");
			});
		});

		it("honours an explicit --print index", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--print", "2", "--limit", "0"]);

				expect(written()).toBe("resolve the MERGE conflict on alpha\n");
			});
		});

		it("numbers results so an index can be chosen without re-running", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--limit", "0"]);

				expect(stdout()).toContain("[1]");
				expect(stdout()).toContain("[3]");
			});
		});

		it("prints complete text under --full", async () => {
			await withSearchHome(async (fixture) => {
				const sessionFile = path.join(
					fixture.homeDir,
					".claude",
					"projects",
					slug(fixture.repoAlpha),
					"long.jsonl",
				);
				const long = [
					"zebras",
					...Array.from({ length: 205 }, (_, index) => `line ${index}`),
					"end of prompt",
				].join("\n");
				await writeFile(
					sessionFile,
					`${claudeUser(long, "2026-08-09T10:00:00.000Z", fixture.repoAlpha, "sess-l")}\n`,
				);
				useFixture(fixture);
				await search(["zebras", "--full"]);

				// The excerpt and the former 200-line display cap would both have dropped this.
				expect(stdout()).toContain("end of prompt");
			});
		});

		it("exits 1 under --copy when an explicitly selected target has no history", async () => {
			await withSearchHome(async (fixture) => {
				await rm(path.join(fixture.homeDir, ".claude"), { recursive: true, force: true });
				useFixture(fixture);
				await search(["zebras", "--only", "claude", "--copy"]);

				expect(exitSpy).toHaveBeenCalledWith(1);
				expect(clipboard.copied).toEqual([]);
			});
		});

		it("stays non-interactive when stdout is not a TTY", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["merge conflict", "--limit", "0"]);

				// A picker would have produced no listing at all.
				expect(stdout()).toContain("matches");
				expect(clipboard.copied).toEqual([]);
			});
		});
	});

	describe("invalid usage", () => {
		it("requires a query", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search([]);

				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Provide a search query"));
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects an unknown role", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["x", "--role", "bogus"]);

				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--role must be one of"));
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects a negative limit", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["x", "--limit", "-1"]);

				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects an unparseable --since", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["x", "--since", "notadate"]);

				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects an out-of-range relative date through the JSON envelope", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["x", "--since", "999999999999999999999d", "--json"]);

				expect(envelope().errors[0]?.code).toBe("invalid_since");
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects an inverted date range", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["x", "--since", "2026-08-06", "--until", "2026-08-01"]);

				expect(errorSpy).toHaveBeenCalledWith("Error: --since must be before --until.");
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("rejects an invalid regex", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["--regex", "("]);

				expect(errorSpy).toHaveBeenCalledWith(
					expect.stringContaining("--regex pattern is invalid"),
				);
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		it("reports a bad flag value through the JSON envelope", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["x", "--role", "bogus", "--json"]);

				const result = JSON.parse(stdout());
				expect(result.errors[0].code).toBe("invalid_role");
				expect(exitSpy).toHaveBeenCalledWith(2);
			});
		});

		// Regression for the KNOWN_COMMANDS registration in src/cli/index.ts: without it, a parse
		// failure inside a registered command exits 2 instead of 1.
		it("exits 1 (not 2) on an unknown flag", async () => {
			await withSearchHome(async (fixture) => {
				useFixture(fixture);
				await search(["x", "--definitely-not-a-flag"]);

				expect(exitSpy).toHaveBeenCalledWith(1);
			});
		});
	});
});
