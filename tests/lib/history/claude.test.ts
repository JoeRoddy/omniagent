import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	cleanClaudeText,
	extractClaudeUserText,
	listClaudeFiles,
	normalizeClaudeLine,
	projectSlugMatches,
	readClaudeTranscript,
	resumeClaudeSession,
	slugifyProjectPath,
} from "../../../src/lib/history/claude.js";
import type {
	HistoryContext,
	HistoryFile,
	HistoryRole,
	SearchScope,
	TranscriptEvent,
} from "../../../src/lib/history/types.js";

function context(overrides: Partial<HistoryContext> = {}): HistoryContext {
	return {
		targetId: "claude",
		displayName: "Claude Code",
		homeDir: "/home/test",
		cwd: "/repo",
		roles: new Set<HistoryRole>(["user", "assistant", "agent"]),
		signal: new AbortController().signal,
		...overrides,
	};
}

function file(overrides: Partial<HistoryFile> = {}): HistoryFile {
	return {
		path: "/transcripts/session.jsonl",
		projectPath: null,
		sessionId: "session",
		modifiedAt: null,
		sizeBytes: null,
		...overrides,
	};
}

function scope(overrides: Partial<SearchScope> = {}): SearchScope {
	return { projectPath: null, projectMatch: null, since: null, until: null, ...overrides };
}

const userRecord = (content: unknown, extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		type: "user",
		sessionId: "session",
		cwd: "/repo",
		timestamp: "2026-08-01T10:00:00.000Z",
		message: { role: "user", content },
		...extra,
	});

describe("slugifyProjectPath", () => {
	it("replaces every non-alphanumeric character with a hyphen", () => {
		expect(slugifyProjectPath("/Users/joe/dev/my.project")).toBe("-Users-joe-dev-my-project");
	});

	it("matches a session started in a subdirectory of the project", () => {
		expect(projectSlugMatches("-a-b-foo-src-nested", "/a/b/foo")).toBe(true);
		expect(projectSlugMatches("-a-b-foo", "/a/b/foo")).toBe(true);
	});

	// Without the trailing-hyphen guard, `/a/b/foo` swallows every sibling sharing that prefix.
	it("does not match a sibling project whose name extends the slug", () => {
		expect(projectSlugMatches("-a-b-foobar", "/a/b/foo")).toBe(false);
	});
});

describe("cleanClaudeText", () => {
	it("strips system reminders", () => {
		expect(cleanClaudeText("real prompt<system-reminder>noise\nmore</system-reminder>")).toBe(
			"real prompt",
		);
	});

	it("drops harness wrapper records", () => {
		for (const tag of [
			"task-notification",
			"command-name",
			"command-message",
			"local-command-stdout",
			"bash-input",
		]) {
			expect(cleanClaudeText(`<${tag}>payload</${tag}>`)).toBe("");
		}
		expect(cleanClaudeText("Caveat: the messages below were generated")).toBe("");
	});

	it("keeps ordinary prose that merely contains angle brackets", () => {
		expect(cleanClaudeText("use <div> here")).toBe("use <div> here");
	});
});

describe("normalizeClaudeLine", () => {
	it("extracts a plain string user prompt", () => {
		const record = normalizeClaudeLine(userRecord("fix the merge conflict"), file(), 3, context());

		expect(record?.role).toBe("user");
		expect(record?.text).toBe("fix the merge conflict");
		expect(record?.sessionId).toBe("session");
		expect(record?.cwd).toBe("/repo");
		expect(record?.recordIndex).toBe(3);
	});

	it("extracts only text blocks from a block array", () => {
		const record = normalizeClaudeLine(
			userRecord([
				{ type: "text", text: "first" },
				{ type: "text", text: "second" },
			]),
			file(),
			0,
			context(),
		);

		expect(record?.text).toBe("first\nsecond");
	});

	// tool_result blocks ride on user-role records and outnumber real prompts ~20:1. Treating
	// them as user messages is the single largest false-positive source.
	it("ignores tool_result blocks entirely", () => {
		const line = userRecord([
			{ type: "tool_result", tool_use_id: "t1", content: "merge conflict in foo.ts" },
		]);

		expect(normalizeClaudeLine(line, file(), 0, context())).toBeNull();
	});

	it("ignores isMeta records", () => {
		const line = userRecord("Base directory for this skill: /x", { isMeta: true });

		expect(normalizeClaudeLine(line, file(), 0, context())).toBeNull();
	});

	// Sidechain user records are dispatch prompts written by the orchestrator, not the human.
	it("classifies sidechain records as the agent role, never user", () => {
		const line = userRecord("do a medium-breadth exploration", { isSidechain: true });

		expect(normalizeClaudeLine(line, file(), 0, context())?.role).toBe("agent");
		expect(
			normalizeClaudeLine(line, file(), 0, context({ roles: new Set<HistoryRole>(["user"]) })),
		).toBeNull();
	});

	it("extracts assistant text", () => {
		const line = JSON.stringify({
			type: "assistant",
			sessionId: "session",
			message: { role: "assistant", content: [{ type: "text", text: "here is the fix" }] },
		});

		expect(normalizeClaudeLine(line, file(), 0, context())?.role).toBe("assistant");
	});

	it("skips records whose role was not requested", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: { content: [{ type: "text", text: "hi" }] },
		});

		expect(
			normalizeClaudeLine(line, file(), 0, context({ roles: new Set<HistoryRole>(["user"]) })),
		).toBeNull();
	});

	it("returns null for malformed JSON instead of throwing", () => {
		expect(normalizeClaudeLine('{"type":"user"', file(), 0, context())).toBeNull();
	});

	it("falls back to the file session id when the record omits one", () => {
		const line = JSON.stringify({ type: "user", message: { content: "hello" } });

		expect(
			normalizeClaudeLine(line, file({ sessionId: "from-file" }), 0, context())?.sessionId,
		).toBe("from-file");
	});
});

describe("listClaudeFiles", () => {
	async function withHome(fn: (homeDir: string) => Promise<void>): Promise<void> {
		const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-claude-hist-"));
		try {
			const homeDir = path.join(root, "home");
			const projects = path.join(homeDir, ".claude", "projects");
			const projectA = path.join(projects, slugifyProjectPath("/repo/alpha"));
			const projectB = path.join(projects, slugifyProjectPath("/repo/alphabet"));
			await mkdir(path.join(projectA, "sess-1", "subagents"), { recursive: true });
			await mkdir(projectB, { recursive: true });
			await writeFile(path.join(projectA, "sess-1.jsonl"), "{}\n");
			await writeFile(path.join(projectA, "sess-1", "subagents", "agent-aaa.jsonl"), "{}\n");
			await writeFile(path.join(projectB, "sess-2.jsonl"), "{}\n");
			await fn(homeDir);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}

	async function collectFiles(homeDir: string, s: SearchScope, roles: HistoryRole[]) {
		const out: HistoryFile[] = [];
		for await (const found of listClaudeFiles(s, context({ homeDir, roles: new Set(roles) }))) {
			out.push(found);
		}
		return out;
	}

	async function collect(homeDir: string, s: SearchScope, roles: HistoryRole[]) {
		return (await collectFiles(homeDir, s, roles)).map((found) => found.path);
	}

	// 111 of 203 files on a real install live under subagents/. A one-level walk drops them all.
	it("recurses into subagent transcripts", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope(), ["user", "assistant", "agent"]);

			expect(found.some((p) => p.includes(`${path.sep}subagents${path.sep}`))).toBe(true);
			expect(found).toHaveLength(3);
		});
	});

	it("returns filesystem modification time and size metadata", async () => {
		await withHome(async (homeDir) => {
			const found = await collectFiles(homeDir, scope(), ["user"]);

			expect(found.every((candidate) => candidate.modifiedAt !== null)).toBe(true);
			expect(found.every((candidate) => Date.parse(candidate.modifiedAt as string) > 0)).toBe(true);
			expect(found.every((candidate) => candidate.sizeBytes === 3)).toBe(true);
		});
	});

	it("skips subagent transcripts when the agent role was not requested", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope(), ["user"]);

			expect(found.some((p) => p.includes("subagents"))).toBe(false);
			expect(found).toHaveLength(2);
		});
	});

	it("reads only subagent transcripts when only the agent role was requested", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope(), ["agent"]);

			expect(found).toHaveLength(1);
			expect(found[0]).toContain("subagents");
		});
	});

	it("prunes sibling projects that merely share a slug prefix", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope({ projectPath: "/repo/alpha" }), [
				"user",
				"agent",
			]);

			expect(found).toHaveLength(2);
			expect(found.every((p) => !p.includes("alphabet"))).toBe(true);
		});
	});

	it("matches a slugified substring filter", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope({ projectMatch: "repo/alphabet" }), ["user"]);

			expect(found).toHaveLength(1);
			expect(found[0]).toContain("alphabet");
		});
	});

	it("yields nothing when the projects directory is absent", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-claude-empty-"));
		try {
			expect(await collect(root, scope(), ["user"])).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("resumeClaudeSession", () => {
	it("reports the session cwd so the renderer can emit a cd prefix", () => {
		const resume = resumeClaudeSession({
			agentId: "claude",
			role: "user",
			timestamp: null,
			text: "hi",
			sessionId: "abc123",
			cwd: "/repo/alpha",
			sourcePath: "/x.jsonl",
			recordIndex: 0,
		});

		expect(resume).toEqual({ command: "claude", args: ["--resume", "abc123"], cwd: "/repo/alpha" });
	});
});

describe("extractClaudeUserText", () => {
	it("renders slash commands the way they were typed", () => {
		expect(
			extractClaudeUserText(
				"<command-name>/pr-prep</command-name><command-message>pr-prep</command-message><command-args>--fast</command-args>",
			),
		).toBe("/pr-prep --fast");
		expect(
			extractClaudeUserText(
				"<command-name>/clear</command-name><command-message>clear</command-message><command-args></command-args>",
			),
		).toBe("/clear");
	});

	it("renders ! shell lines and still drops their captured output", () => {
		expect(extractClaudeUserText("<bash-input>git status</bash-input>")).toBe("! git status");
		expect(extractClaudeUserText("<bash-stdout>On branch main</bash-stdout>")).toBe("");
		expect(extractClaudeUserText("<local-command-stdout>ok</local-command-stdout>")).toBe("");
	});

	it("otherwise applies the search cleaner", () => {
		expect(extractClaudeUserText("<system-reminder>ignore</system-reminder>hello")).toBe("hello");
		expect(extractClaudeUserText("<task-notification>done</task-notification>")).toBe("");
		expect(extractClaudeUserText("  plain prompt  ")).toBe("plain prompt");
	});
});

describe("readClaudeTranscript", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "omniagent-claude-transcript-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const assistantBlock = (
		block: unknown,
		messageId = "msg_1",
		timestamp = "2026-08-01T10:00:01.000Z",
	) =>
		JSON.stringify({
			type: "assistant",
			sessionId: "session",
			cwd: "/repo",
			gitBranch: "main",
			timestamp,
			message: { id: messageId, model: "claude-test", role: "assistant", content: [block] },
		});

	async function transcript(lines: string[]): Promise<TranscriptEvent[]> {
		const filePath = path.join(root, "session.jsonl");
		await writeFile(filePath, `${lines.join("\n")}\n`);
		const events: TranscriptEvent[] = [];
		for await (const event of readClaudeTranscript(file({ path: filePath }), context())) {
			events.push(event);
		}
		return events;
	}

	it("emits session meta, then messages and tool events in file order", async () => {
		const events = await transcript([
			userRecord("hello there"),
			assistantBlock({ type: "text", text: "Looking." }),
			assistantBlock({ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }),
			userRecord([{ type: "tool_result", tool_use_id: "toolu_1", content: "a\nb" }]),
			assistantBlock({ type: "text", text: "Done." }, "msg_2", "2026-08-01T10:00:05.000Z"),
		]);

		expect(events).toEqual([
			{ kind: "meta", cwd: "/repo" },
			{ kind: "message", role: "user", text: "hello there", timestamp: "2026-08-01T10:00:00.000Z" },
			// The user record above carries no branch; the first assistant record supplies it.
			{ kind: "meta", gitBranch: "main", model: "claude-test" },
			{
				kind: "message",
				role: "assistant",
				text: "Looking.",
				timestamp: "2026-08-01T10:00:01.000Z",
			},
			{
				kind: "tool_call",
				callId: "toolu_1",
				name: "Bash",
				input: { command: "ls" },
				timestamp: "2026-08-01T10:00:01.000Z",
			},
			{
				kind: "tool_result",
				callId: "toolu_1",
				output: "a\nb",
				isError: false,
				timestamp: "2026-08-01T10:00:00.000Z",
			},
			{ kind: "message", role: "assistant", text: "Done.", timestamp: "2026-08-01T10:00:05.000Z" },
		]);
	});

	it("merges the text blocks of one API message and keeps separate messages apart", async () => {
		const events = await transcript([
			assistantBlock({ type: "text", text: "First half." }, "msg_1"),
			assistantBlock({ type: "text", text: "Second half." }, "msg_1"),
			assistantBlock({ type: "text", text: "Another message." }, "msg_2"),
		]);

		const messages = events.filter((event) => event.kind === "message");
		expect(messages.map((event) => (event.kind === "message" ? event.text : ""))).toEqual([
			"First half.\n\nSecond half.",
			"Another message.",
		]);
	});

	it("flags failed tool results and renders block-array results as text", async () => {
		const events = await transcript([
			userRecord([
				{ type: "tool_result", tool_use_id: "toolu_1", content: "Exit code 1", is_error: true },
			]),
			userRecord([
				{
					type: "tool_result",
					tool_use_id: "toolu_2",
					content: [
						{ type: "text", text: "line one" },
						{ type: "tool_reference", tool_name: "WebFetch" },
						{ type: "image", source: {} },
					],
				},
			]),
		]);

		const results = events.filter((event) => event.kind === "tool_result");
		expect(results).toEqual([
			expect.objectContaining({ callId: "toolu_1", output: "Exit code 1", isError: true }),
			expect.objectContaining({
				callId: "toolu_2",
				output: "line one\n[tool: WebFetch]\n[image]",
				isError: false,
			}),
		]);
	});

	it("keeps readable thinking and drops empty signature-only shells", async () => {
		const events = await transcript([
			assistantBlock({ type: "thinking", thinking: "", signature: "abc" }),
			assistantBlock({ type: "thinking", thinking: "Let me check the tests.", signature: "abc" }),
		]);

		expect(events.filter((event) => event.kind === "thinking")).toEqual([
			expect.objectContaining({ text: "Let me check the tests." }),
		]);
	});

	it("skips harness records, injected meta, and malformed lines", async () => {
		const events = await transcript([
			"not json at all",
			JSON.stringify({ type: "attachment", attachment: { type: "skill_listing" } }),
			JSON.stringify({ type: "system", subtype: "stop_hook_summary" }),
			JSON.stringify({ type: "queue-operation", operation: "enqueue" }),
			userRecord("Base directory for this skill", { isMeta: true }),
			userRecord("<command-name>/clear</command-name><command-message>clear</command-message>"),
			userRecord("real prompt"),
		]);

		expect(events.filter((event) => event.kind === "message")).toEqual([
			expect.objectContaining({ role: "user", text: "/clear" }),
			expect.objectContaining({ role: "user", text: "real prompt" }),
		]);
	});

	it("falls back to the discovered project path when records omit a cwd", async () => {
		const filePath = path.join(root, "session.jsonl");
		await writeFile(
			filePath,
			`${JSON.stringify({ type: "user", timestamp: null, message: { role: "user", content: "hi" } })}\n`,
		);
		const events: TranscriptEvent[] = [];
		for await (const event of readClaudeTranscript(
			file({ path: filePath, projectPath: "/from/discovery" }),
			context(),
		)) {
			events.push(event);
		}

		expect(events[0]).toEqual({ kind: "meta", cwd: "/from/discovery" });
	});
});
