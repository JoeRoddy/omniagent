import {
	buildExportEnvelope,
	collapseToolCalls,
	renderChatLog,
	summarizeToolCounts,
} from "../../../src/lib/history/chat-log.js";
import {
	type ExportedSession,
	exportSession,
	isTranscriptEvent,
} from "../../../src/lib/history/export.js";
import type { HistoryFile, TranscriptEvent } from "../../../src/lib/history/types.js";
import type { ResolvedTarget } from "../../../src/lib/targets/config-types.js";

const T0 = "2026-08-01T10:00:00.000Z";
const T1 = "2026-08-01T10:01:00.000Z";
const T2 = "2026-08-01T10:02:00.000Z";
const T3 = "2026-08-01T10:03:00.000Z";

const user = (text: string, timestamp: string | null = T0): TranscriptEvent => ({
	kind: "message",
	role: "user",
	text,
	timestamp,
});
const assistant = (text: string, timestamp: string | null = T1): TranscriptEvent => ({
	kind: "message",
	role: "assistant",
	text,
	timestamp,
});
const call = (
	name: string,
	input: unknown,
	callId = `${name}-1`,
	timestamp: string | null = T1,
): TranscriptEvent => ({ kind: "tool_call", callId, name, input, timestamp });
const result = (
	callId: string,
	output: string,
	isError = false,
	timestamp: string | null = T1,
): TranscriptEvent => ({ kind: "tool_result", callId, output, isError, timestamp });
const thinking = (text: string, timestamp: string | null = T1): TranscriptEvent => ({
	kind: "thinking",
	text,
	timestamp,
});

type FakeSessions = Record<string, unknown[]>;

type FakeTargetOptions = {
	/** Set false to model a searchable agent that predates the export capability. */
	transcript?: boolean;
	cwd?: string | null;
	modifiedAt?: string;
	/** Extra files for the same session id, to model a store split across several files. */
	extraFiles?: Record<string, unknown[]>;
	listFiles?: () => AsyncIterable<HistoryFile>;
	roles?: Array<"user" | "assistant" | "agent">;
};

/**
 * A whole agent defined in memory: its own files, its own event stream, its own resume verb.
 * Nothing about it is known to the engine.
 */
function fakeTarget(
	id: string,
	sessions: FakeSessions,
	options: FakeTargetOptions = {},
): ResolvedTarget {
	const projectPath = options.cwd === undefined ? `/repo/${id}` : options.cwd;
	const files: HistoryFile[] = Object.keys(sessions).map((sessionId) => ({
		path: `/${id}/${sessionId}.log`,
		projectPath,
		sessionId,
		modifiedAt: options.modifiedAt ?? "2026-08-01T00:00:00.000Z",
		sizeBytes: null,
	}));
	const store: FakeSessions = { ...sessions };
	for (const [filePath, events] of Object.entries(options.extraFiles ?? {})) {
		const sessionId = filePath.split("/")[2] ?? "";
		files.push({
			path: filePath,
			projectPath,
			sessionId,
			modifiedAt: "2026-08-02T00:00:00.000Z",
			sizeBytes: null,
		});
		store[filePath] = events;
	}
	const eventsFor = (file: HistoryFile): unknown[] =>
		store[file.path] ?? store[file.sessionId ?? ""] ?? [];

	return {
		id,
		displayName: id.toUpperCase(),
		aliases: [],
		outputs: {},
		isBuiltIn: false,
		isCustomized: true,
		history: {
			roles: options.roles ?? ["user", "assistant"],
			listFiles:
				options.listFiles ??
				async function* () {
					yield* files;
				},
			scan: {
				kind: "custom",
				read: async function* (file) {
					for (const event of eventsFor(file) as TranscriptEvent[]) {
						if (event.kind === "message") {
							yield {
								agentId: id,
								role: event.role,
								timestamp: event.timestamp,
								text: event.text,
								sessionId: file.sessionId ?? "",
								cwd: file.projectPath,
								sourcePath: file.path,
								recordIndex: 0,
							};
						}
					}
				},
			},
			resume: (record) => ({
				command: `${id}-cli`,
				args: ["resume", record.sessionId],
				cwd: record.cwd,
			}),
			...(options.transcript === false
				? {}
				: {
						transcript: async function* (file) {
							yield* eventsFor(file) as TranscriptEvent[];
						},
					}),
		},
	};
}

async function run(targets: ResolvedTarget[], sessionId: string) {
	return exportSession({
		targets,
		sessionId,
		homeDir: "/home/demo",
		cwd: "/repo/demo",
		signal: new AbortController().signal,
	});
}

const CONVERSATION: TranscriptEvent[] = [
	{ kind: "meta", cwd: "/repo/demo", gitBranch: "main", model: "demo-model" },
	user("please fix the build", T0),
	assistant("Looking at it.", T1),
	thinking("The test file is stale.", T1),
	call("Bash", { command: "npm test" }, "c1", T1),
	result("c1", "1 failing", true, T1),
	call("Edit", { file_path: "a.ts" }, "c2", T2),
	result("c2", "ok", false, T2),
	call("Bash", { command: "npm test" }, "c3", T2),
	result("c3", "all passing", false, T2),
	assistant("Fixed, tests pass.", T3),
];

describe("exportSession", () => {
	it("reads a session by exact id and summarizes it", async () => {
		const target = fakeTarget("demo", { "sess-1": CONVERSATION, "sess-2": [user("other")] });

		const outcome = await run([target], "sess-1");

		expect(outcome.session).not.toBeNull();
		const session = outcome.session as ExportedSession;
		expect(session.agentId).toBe("demo");
		expect(session.displayName).toBe("DEMO");
		expect(session.sessionId).toBe("sess-1");
		expect(session.cwd).toBe("/repo/demo");
		expect(session.gitBranch).toBe("main");
		expect(session.model).toBe("demo-model");
		expect(session.startedAt).toBe(T0);
		expect(session.endedAt).toBe(T3);
		expect(session.sourcePaths).toEqual(["/demo/sess-1.log"]);
		expect(session.counts).toEqual({
			user: 1,
			assistant: 2,
			toolCalls: 3,
			toolResults: 3,
			failedToolCalls: 1,
			thinking: 1,
		});
		expect(session.toolCallsByName).toEqual({ Bash: 2, Edit: 1 });
		// Meta events are consumed, not exported.
		expect(session.events.some((event) => event.kind === "meta")).toBe(false);
		expect(session.events).toHaveLength(CONVERSATION.length - 1);
		// The session cwd matches the caller's cwd, so no cd prefix is needed.
		expect(session.resumeCommand).toBe("demo-cli resume sess-1");
		expect(outcome.candidates).toEqual([
			expect.objectContaining({ agentId: "demo", sessionId: "sess-1", cwd: "/repo/demo" }),
		]);
		expect(outcome.errors).toEqual([]);
		expect(outcome.notes).toEqual([]);
	});

	it("accepts a unique prefix, case-insensitively", async () => {
		const target = fakeTarget("demo", { "ABC-123": [user("hi")], "xyz-999": [user("yo")] });

		const outcome = await run([target], "abc");

		expect(outcome.session?.sessionId).toBe("ABC-123");
	});

	it("prefers an exact match over other sessions that merely extend it", async () => {
		const target = fakeTarget("demo", { sess: [user("exact")], "sess-longer": [user("longer")] });

		const outcome = await run([target], "sess");

		expect(outcome.session?.sessionId).toBe("sess");
		expect(outcome.candidates).toHaveLength(1);
	});

	it("reports every candidate, newest first, when a prefix is ambiguous", async () => {
		const older = fakeTarget(
			"demo",
			{ "sess-a": [user("a")] },
			{ modifiedAt: "2026-08-01T00:00:00.000Z" },
		);
		const newer = fakeTarget(
			"other",
			{ "sess-b": [user("b")] },
			{ modifiedAt: "2026-08-05T00:00:00.000Z" },
		);

		const outcome = await run([older, newer], "sess");

		expect(outcome.session).toBeNull();
		expect(outcome.candidates.map((candidate) => candidate.sessionId)).toEqual([
			"sess-b",
			"sess-a",
		]);
		expect(outcome.candidates[0]).toEqual({
			agentId: "other",
			displayName: "OTHER",
			sessionId: "sess-b",
			cwd: "/repo/other",
			modifiedAt: "2026-08-05T00:00:00.000Z",
		});
	});

	it("treats the same id in two agents' histories as ambiguous", async () => {
		const a = fakeTarget("demo", { shared: [user("a")] });
		const b = fakeTarget("other", { shared: [user("b")] });

		const outcome = await run([a, b], "shared");

		expect(outcome.session).toBeNull();
		expect(outcome.candidates.map((candidate) => candidate.agentId).sort()).toEqual([
			"demo",
			"other",
		]);
	});

	it("learns a candidate's project from its transcript when discovery did not know it", async () => {
		const events = [{ kind: "meta", cwd: "/learned/from/meta" }, user("a")];
		const a = fakeTarget("demo", { shared: events }, { cwd: null });
		const b = fakeTarget("other", { shared: [user("b")] });

		const outcome = await run([a, b], "shared");

		expect(outcome.candidates.find((candidate) => candidate.agentId === "demo")?.cwd).toBe(
			"/learned/from/meta",
		);
	});

	it("returns no session and no candidates when nothing matches", async () => {
		const target = fakeTarget("demo", { "sess-1": [user("hi")] });

		const outcome = await run([target], "nope");

		expect(outcome.session).toBeNull();
		expect(outcome.candidates).toEqual([]);
	});

	it("never matches an empty id", async () => {
		const target = fakeTarget("demo", { "sess-1": [user("hi")] });

		const outcome = await run([target], "   ");

		expect(outcome.session).toBeNull();
		expect(outcome.candidates).toEqual([]);
	});

	it("falls back to the search reader for an agent without a transcript reader", async () => {
		const target = fakeTarget("legacy", { "sess-1": CONVERSATION }, { transcript: false });

		const outcome = await run([target], "sess-1");

		const session = outcome.session as ExportedSession;
		expect(session.events.map((event) => event.kind)).toEqual(["message", "message", "message"]);
		expect(session.counts.toolCalls).toBe(0);
		expect(session.cwd).toBe("/repo/legacy");
		expect(outcome.notes).toEqual([
			expect.objectContaining({
				targetId: "legacy",
				code: "transcript_unavailable",
				message: "LEGACY does not expose tool calls; the chat log contains messages only.",
			}),
		]);
	});

	it("skips malformed events and says how many", async () => {
		const target = fakeTarget("demo", {
			"sess-1": [
				user("ok"),
				{ kind: "message", role: "narrator", text: "bad role" },
				{ kind: "tool_call", name: "", callId: null, input: null, timestamp: null },
				{ kind: "tool_result", callId: "x", output: 42, isError: false, timestamp: null },
				null,
				"string",
				assistant("still fine"),
			],
		});

		const outcome = await run([target], "sess-1");

		expect(outcome.session?.events).toHaveLength(2);
		expect(outcome.notes).toEqual([
			expect.objectContaining({
				code: "malformed_events",
				message: "Skipped 5 malformed transcript event(s).",
			}),
		]);
	});

	it("concatenates several files for one session in modification order", async () => {
		const target = fakeTarget(
			"demo",
			{ "sess-1": [user("first file", T0)] },
			{ extraFiles: { "/demo/sess-1/part-2.log": [assistant("second file", T1)] } },
		);

		const outcome = await run([target], "sess-1");

		const session = outcome.session as ExportedSession;
		expect(session.sourcePaths).toEqual(["/demo/sess-1.log", "/demo/sess-1/part-2.log"]);
		expect(session.events.map((event) => (event.kind === "message" ? event.text : ""))).toEqual([
			"first file",
			"second file",
		]);
	});

	it("reports a target whose discovery fails and keeps going", async () => {
		const broken = fakeTarget(
			"broken",
			{},
			{
				listFiles: async function* () {
					yield* [] as HistoryFile[];
					throw new Error("disk on fire");
				},
			},
		);
		const fine = fakeTarget("demo", { "sess-1": [user("hi")] });

		const outcome = await run([broken, fine], "sess-1");

		expect(outcome.session?.sessionId).toBe("sess-1");
		expect(outcome.errors).toEqual([
			expect.objectContaining({
				targetId: "broken",
				code: "history_list_failed",
				message: "disk on fire",
			}),
		]);
	});

	it("reports a transcript that cannot be read instead of throwing", async () => {
		const target = fakeTarget("demo", { "sess-1": [user("hi")] });
		(target.history as NonNullable<ResolvedTarget["history"]>).transcript = async function* () {
			yield user("partial");
			throw new Error("torn record");
		};

		const outcome = await run([target], "sess-1");

		expect(outcome.session?.events).toHaveLength(1);
		expect(outcome.errors).toEqual([
			expect.objectContaining({
				code: "transcript_read_failed",
				message: "Could not read /demo/sess-1.log: torn record",
			}),
		]);
	});

	it("skips an agent that records no conversation roles", async () => {
		const agentsOnly = fakeTarget("agents", { "sess-1": [user("hi")] }, { roles: ["agent"] });

		const outcome = await run([agentsOnly], "sess-1");

		expect(outcome.session).toBeNull();
		expect(outcome.notes).toEqual([
			expect.objectContaining({ targetId: "agents", code: "role_unsupported" }),
		]);
	});

	it("emits a cd prefix in the resume command when the session lives elsewhere", async () => {
		const target = fakeTarget("demo", { "sess-1": [user("hi")] }, { cwd: "/home/demo/elsewhere" });

		const outcome = await run([target], "sess-1");

		expect(outcome.session?.resumeCommand).toBe("cd ~/elsewhere && demo-cli resume sess-1");
	});
});

describe("isTranscriptEvent", () => {
	it("accepts every well-formed kind", () => {
		expect(isTranscriptEvent({ kind: "meta" })).toBe(true);
		expect(isTranscriptEvent({ kind: "meta", cwd: null, gitBranch: "x", model: undefined })).toBe(
			true,
		);
		expect(isTranscriptEvent(user("x"))).toBe(true);
		expect(isTranscriptEvent(call("Bash", undefined, null, null))).toBe(true);
		expect(isTranscriptEvent(result("c", "", false, null))).toBe(true);
		expect(isTranscriptEvent(thinking("t", null))).toBe(true);
	});

	it("rejects the wrong shape", () => {
		expect(isTranscriptEvent({ kind: "message", role: "user", text: "", timestamp: null })).toBe(
			false,
		);
		expect(isTranscriptEvent({ kind: "message", role: "agent", text: "x", timestamp: null })).toBe(
			false,
		);
		expect(
			isTranscriptEvent({ kind: "tool_call", name: "x", callId: 1, input: null, timestamp: null }),
		).toBe(false);
		expect(
			isTranscriptEvent({
				kind: "tool_result",
				callId: null,
				output: "x",
				isError: "no",
				timestamp: null,
			}),
		).toBe(false);
		expect(isTranscriptEvent({ kind: "meta", cwd: 3 })).toBe(false);
		expect(isTranscriptEvent({ kind: "unknown" })).toBe(false);
	});
});

describe("collapseToolCalls", () => {
	it("folds each run of tool activity into one group placed where it happened", () => {
		const entries = collapseToolCalls(CONVERSATION);

		expect(entries.map((entry) => entry.kind)).toEqual([
			"message",
			"message",
			"tool_calls",
			"message",
		]);
		expect(entries[2]).toEqual({
			kind: "tool_calls",
			count: 3,
			byName: { Bash: 2, Edit: 1 },
			failed: 1,
			timestamp: T1,
		});
	});

	it("drops a run with no tool call and keeps a trailing run", () => {
		const entries = collapseToolCalls([
			user("a"),
			thinking("just thinking"),
			assistant("b"),
			call("Bash", {}, "c1"),
		]);

		expect(entries.map((entry) => entry.kind)).toEqual(["message", "message", "tool_calls"]);
	});
});

describe("summarizeToolCounts", () => {
	it("orders by count, then name", () => {
		expect(summarizeToolCounts({ Read: 3, Bash: 3, Edit: 1 })).toBe("Bash ×3, Read ×3, Edit ×1");
		expect(summarizeToolCounts({})).toBe("");
	});
});

function session(overrides: Partial<ExportedSession> = {}): ExportedSession {
	return {
		agentId: "demo",
		displayName: "Demo Agent",
		sessionId: "sess-1",
		cwd: "/home/demo/project",
		gitBranch: "main",
		model: "demo-model",
		startedAt: T0,
		endedAt: T3,
		sourcePaths: ["/home/demo/.demo/sess-1.log"],
		resumeCommand: "demo-cli resume sess-1",
		counts: {
			user: 1,
			assistant: 2,
			toolCalls: 3,
			toolResults: 3,
			failedToolCalls: 1,
			thinking: 1,
		},
		toolCallsByName: { Bash: 2, Edit: 1 },
		events: CONVERSATION.filter((event) => event.kind !== "meta"),
		...overrides,
	};
}

describe("renderChatLog", () => {
	it("renders a header and a collapsed conversation by default", () => {
		const text = renderChatLog(session(), { verbose: false, homeDir: "/home/demo" });

		expect(text).toContain("# Demo Agent session sess-1");
		expect(text).toContain("- Project: ~/project (main)");
		expect(text).toContain("- Model: demo-model");
		expect(text).toMatch(
			/- Started: \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Ended: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
		);
		expect(text).toContain(
			"- Messages: 1 user, 2 assistant · Tool calls: 3 (Bash ×2, Edit ×1) · 1 failed",
		);
		expect(text).toContain("- Resume: demo-cli resume sess-1");
		expect(text).toContain("- Source: ~/.demo/sess-1.log");

		const body = text.slice(text.indexOf("---"));
		expect(body).toContain("**user**");
		expect(body).toContain("please fix the build");
		expect(body).toContain("**assistant**");
		expect(body).toContain("⋯ 3 tool calls (Bash ×2, Edit ×1), 1 failed");
		// Order: user, assistant, the collapsed run, assistant.
		expect(body.indexOf("Looking at it.")).toBeLessThan(body.indexOf("⋯ 3 tool calls"));
		expect(body.indexOf("⋯ 3 tool calls")).toBeLessThan(body.indexOf("Fixed, tests pass."));
		// Nothing from inside the run leaks out.
		expect(body).not.toContain("npm test");
		expect(body).not.toContain("1 failing");
		expect(body).not.toContain("The test file is stale.");
		expect(body).not.toContain("**tool call**");
	});

	it("expands every tool call, result, and thinking block with --verbose", () => {
		const text = renderChatLog(session(), { verbose: true, homeDir: "/home/demo" });

		expect(text).not.toContain("⋯");
		expect(text).toContain("**thinking**");
		expect(text).toContain("The test file is stale.");
		expect(text).toContain("**tool call** Bash · ");
		expect(text).toContain(" · c1");
		expect(text).toContain('```json\n{\n  "command": "npm test"\n}\n```');
		// The result learns its tool name from the matching call and flags the error.
		expect(text).toContain("**tool result** Bash · error · ");
		expect(text).toContain("```\n1 failing\n```");
		expect(text).toContain("**tool result** Edit · ");
		expect(text).toContain("```\nok\n```");
	});

	it("renders string inputs raw, missing inputs and outputs as placeholders", () => {
		const text = renderChatLog(
			session({
				events: [
					call("exec", "const r = await tools.exec_command({ cmd: 'ls' });", "c1"),
					result("c1", "", false),
					call("noop", undefined, "c2"),
				],
			}),
			{ verbose: true, homeDir: "/home/demo" },
		);

		expect(text).toContain("```\nconst r = await tools.exec_command({ cmd: 'ls' });\n```");
		expect(text).toContain("**tool result** exec · ");
		expect(text).toContain("(no output)");
		expect(text).toContain("**tool call** noop");
		expect(text).toContain("(no input)");
	});

	it("uses a longer fence when the content contains one", () => {
		const output = "```ts\nconst a = 1;\n```\n````\nnested\n````";
		const text = renderChatLog(
			session({ events: [call("Read", "", "c1"), result("c1", output)] }),
			{
				verbose: true,
				homeDir: "/home/demo",
			},
		);

		expect(text).toContain(`\`\`\`\`\`\n${output}\n\`\`\`\`\``);
	});

	it("strips terminal control sequences from everything it prints", () => {
		const text = renderChatLog(
			session({
				displayName: "Evil\x1b]52;c;YXR0YWNr\x07Agent",
				events: [
					user("hi\x1b[31m there"),
					call("Bash", { command: "printf '\x07'" }, "c1"),
					result("c1", "\x1b[2Jcleared"),
				],
			}),
			{ verbose: true, homeDir: "/home/demo" },
		);

		expect(text).not.toContain("\x1b");
		expect(text).not.toContain("\x07");
		expect(text).toContain("hi there");
		expect(text).toContain("cleared");
	});

	it("omits header lines it has no information for", () => {
		const text = renderChatLog(
			session({
				cwd: null,
				gitBranch: null,
				model: null,
				startedAt: null,
				endedAt: null,
				resumeCommand: null,
				sourcePaths: [],
				toolCallsByName: {},
				counts: {
					user: 0,
					assistant: 0,
					toolCalls: 0,
					toolResults: 0,
					failedToolCalls: 0,
					thinking: 0,
				},
				events: [],
			}),
			{ verbose: false, homeDir: "/home/demo" },
		);

		expect(text).not.toContain("- Project:");
		expect(text).not.toContain("- Model:");
		expect(text).not.toContain("- Started:");
		expect(text).not.toContain("- Resume:");
		expect(text).not.toContain("- Source:");
		expect(text).toContain("- Messages: 0 user, 0 assistant · Tool calls: 0");
	});
});

describe("buildExportEnvelope", () => {
	it("mirrors the collapsed view by default and the raw events when verbose", () => {
		const collapsed = buildExportEnvelope({
			session: session(),
			verbose: false,
			errors: [],
			notes: [],
			generatedAt: T3,
		});
		const verbose = buildExportEnvelope({
			session: session(),
			verbose: true,
			errors: [],
			notes: [],
			generatedAt: T3,
		});

		expect(collapsed.schemaVersion).toBe(1);
		expect(collapsed.verbose).toBe(false);
		expect(collapsed.session).not.toHaveProperty("events");
		expect(collapsed.session?.sessionId).toBe("sess-1");
		expect(collapsed.events.map((entry) => entry.kind)).toEqual([
			"message",
			"message",
			"tool_calls",
			"message",
		]);
		expect(verbose.events).toEqual(session().events);
	});

	it("carries a null session with empty events", () => {
		const envelope = buildExportEnvelope({
			session: null,
			verbose: false,
			errors: [{ targetId: "", displayName: "", code: "session_not_found", message: "nope" }],
			notes: [],
			generatedAt: T3,
		});

		expect(envelope.session).toBeNull();
		expect(envelope.events).toEqual([]);
		expect(envelope.errors[0]?.code).toBe("session_not_found");
	});
});
