import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	listCodexFiles,
	normalizeCodexLine,
	readCodexSessionMeta,
	resumeCodexSession,
} from "../../../src/lib/history/codex.js";
import type {
	HistoryContext,
	HistoryFile,
	HistoryRole,
	SearchScope,
} from "../../../src/lib/history/types.js";

function context(overrides: Partial<HistoryContext> = {}): HistoryContext {
	return {
		targetId: "codex",
		displayName: "OpenAI Codex",
		homeDir: "/home/test",
		cwd: "/repo",
		roles: new Set<HistoryRole>(["user", "assistant"]),
		signal: new AbortController().signal,
		...overrides,
	};
}

function file(overrides: Partial<HistoryFile> = {}): HistoryFile {
	return {
		path: "/sessions/rollout.jsonl",
		projectPath: "/repo",
		sessionId: "rollout-id",
		modifiedAt: null,
		sizeBytes: null,
		...overrides,
	};
}

function scope(overrides: Partial<SearchScope> = {}): SearchScope {
	return { projectPath: null, projectMatch: null, since: null, until: null, ...overrides };
}

const sessionMeta = (cwd: string, id = "rollout-id") =>
	JSON.stringify({
		timestamp: "2026-08-01T10:00:00.000Z",
		type: "session_meta",
		payload: { id, session_id: `${id}-forked`, cwd, model: "gpt-5", cli_version: "0.1.0" },
	});

const userEvent = (message: string) =>
	JSON.stringify({
		timestamp: "2026-08-01T10:05:00.000Z",
		type: "event_msg",
		payload: { type: "user_message", message, images: [] },
	});

const agentEvent = (message: string) =>
	JSON.stringify({
		timestamp: "2026-08-01T10:06:00.000Z",
		type: "event_msg",
		payload: { type: "agent_message", message, phase: "commentary" },
	});

/**
 * Current shape (Codex from 2026-08-07): messages arrive as completed thread items rather than
 * bespoke user_message / agent_message events.
 */
const itemCompletedUser = (text: string, timestamp = "2026-08-07T10:05:00.000Z") =>
	JSON.stringify({
		timestamp,
		type: "event_msg",
		payload: {
			type: "item_completed",
			item: { type: "UserMessage", id: "i1", content: [{ type: "text", text, text_elements: [] }] },
		},
	});

/** Agent messages use a capitalised block type; the reader keys off the text field, not the label. */
const itemCompletedAgent = (text: string) =>
	JSON.stringify({
		timestamp: "2026-08-07T10:06:00.000Z",
		type: "event_msg",
		payload: {
			type: "item_completed",
			item: { type: "AgentMessage", id: "i2", content: [{ type: "Text", text }] },
		},
	});

const itemCompletedOther = (itemType: string) =>
	JSON.stringify({
		timestamp: "2026-08-07T10:07:00.000Z",
		type: "event_msg",
		payload: { type: "item_completed", item: { type: itemType, id: "i3", content: [] } },
	});

/** The polluted duplicate: same text, wrapped with injected harness context. */
const responseItemUser = (text: string) =>
	JSON.stringify({
		timestamp: "2026-08-01T10:05:00.000Z",
		type: "response_item",
		payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
	});

describe("normalizeCodexLine", () => {
	it("extracts a user prompt from an event_msg", () => {
		const record = normalizeCodexLine(userEvent("fix the merge conflict"), file(), 2, context());

		expect(record?.role).toBe("user");
		expect(record?.text).toBe("fix the merge conflict");
		expect(record?.sessionId).toBe("rollout-id");
		expect(record?.cwd).toBe("/repo");
		expect(record?.recordIndex).toBe(2);
	});

	it("extracts assistant text from agent_message", () => {
		expect(normalizeCodexLine(agentEvent("here you go"), file(), 0, context())?.role).toBe(
			"assistant",
		);
	});

	// THE TRAP. response_item carries the same user text but with injected harness blocks.
	// Widening the predicate to accept it silently doubles every result.
	it("ignores response_item records that duplicate user text", () => {
		expect(
			normalizeCodexLine(responseItemUser("fix the merge conflict"), file(), 0, context()),
		).toBeNull();
	});

	it("never surfaces injected environment_context", () => {
		const line = responseItemUser("<environment_context><cwd>/repo</cwd></environment_context>");

		expect(normalizeCodexLine(line, file(), 0, context())).toBeNull();
	});

	it("yields exactly one record when both encodings of the same turn are present", () => {
		const text = "fix the merge conflict";
		const lines = [userEvent(text), responseItemUser(text)];
		const records = lines
			.map((line, index) => normalizeCodexLine(line, file(), index, context()))
			.filter((record) => record !== null);

		expect(records).toHaveLength(1);
		expect(records[0]?.text).toBe(text);
	});

	it("skips roles that were not requested", () => {
		expect(
			normalizeCodexLine(
				agentEvent("hi"),
				file(),
				0,
				context({ roles: new Set<HistoryRole>(["user"]) }),
			),
		).toBeNull();
	});

	it("ignores non-message events and malformed lines", () => {
		const tokenCount = JSON.stringify({ type: "event_msg", payload: { type: "token_count" } });

		expect(normalizeCodexLine(tokenCount, file(), 0, context())).toBeNull();
		expect(normalizeCodexLine('{"type":"event_msg"', file(), 0, context())).toBeNull();
	});

	it("drops empty messages", () => {
		expect(normalizeCodexLine(userEvent("   "), file(), 0, context())).toBeNull();
	});
});

// Codex changed its transcript format on 2026-08-07: user_message / agent_message events were
// replaced by item_completed thread items. Reading only the legacy shape silently returns
// nothing for every recent session, which no snapshot of older transcripts can catch.
describe("current item_completed format", () => {
	it("extracts a user prompt from a completed UserMessage item", () => {
		const record = normalizeCodexLine(itemCompletedUser("asdfadsf"), file(), 4, context());

		expect(record?.role).toBe("user");
		expect(record?.text).toBe("asdfadsf");
		expect(record?.recordIndex).toBe(4);
	});

	it("extracts assistant text from a completed AgentMessage item", () => {
		const record = normalizeCodexLine(itemCompletedAgent("here you go"), file(), 0, context());

		expect(record?.role).toBe("assistant");
		expect(record?.text).toBe("here you go");
	});

	it("ignores completed items that are not messages", () => {
		for (const itemType of ["Reasoning", "CommandExecution", "FileChange", "Plan"]) {
			expect(normalizeCodexLine(itemCompletedOther(itemType), file(), 0, context())).toBeNull();
		}
	});

	it("still yields exactly one record when the turn is also stored as a response_item", () => {
		const text = "asdfadsf";
		const records = [responseItemUser(text), itemCompletedUser(text)]
			.map((line, index) => normalizeCodexLine(line, file(), index, context()))
			.filter((record) => record !== null);

		expect(records).toHaveLength(1);
		expect(records[0]?.text).toBe(text);
	});

	it("honours role filtering", () => {
		expect(
			normalizeCodexLine(
				itemCompletedAgent("hi"),
				file(),
				0,
				context({ roles: new Set<HistoryRole>(["user"]) }),
			),
		).toBeNull();
	});

	it("joins multiple content blocks", () => {
		const line = JSON.stringify({
			timestamp: "2026-08-07T10:05:00.000Z",
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: {
					type: "UserMessage",
					content: [
						{ type: "text", text: "first " },
						{ type: "text", text: "second" },
					],
				},
			},
		});

		expect(normalizeCodexLine(line, file(), 0, context())?.text).toBe("first second");
	});

	it("drops an item with no text content", () => {
		const line = JSON.stringify({
			timestamp: "2026-08-07T10:05:00.000Z",
			type: "event_msg",
			payload: { type: "item_completed", item: { type: "UserMessage", content: [] } },
		});

		expect(normalizeCodexLine(line, file(), 0, context())).toBeNull();
	});
});

// Both encodings must keep working: transcripts written before the change are still on disk.
describe("legacy event format", () => {
	it("still extracts user_message and agent_message events", () => {
		expect(normalizeCodexLine(userEvent("legacy prompt"), file(), 0, context())?.text).toBe(
			"legacy prompt",
		);
		expect(normalizeCodexLine(agentEvent("legacy reply"), file(), 0, context())?.role).toBe(
			"assistant",
		);
	});
});

describe("readCodexSessionMeta", () => {
	async function withFile(body: string, fn: (filePath: string) => Promise<void>): Promise<void> {
		const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-codex-meta-"));
		try {
			const filePath = path.join(root, "rollout.jsonl");
			await writeFile(filePath, body);
			await fn(filePath);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}

	it("prefers the rollout id over the forked session_id", async () => {
		await withFile(`${sessionMeta("/repo/alpha", "roll-1")}\n${userEvent("hi")}\n`, async (p) => {
			const meta = await readCodexSessionMeta(p);

			expect(meta?.sessionId).toBe("roll-1");
			expect(meta?.cwd).toBe("/repo/alpha");
		});
	});

	it("returns null when the first line is not session_meta", async () => {
		await withFile(`${userEvent("hi")}\n`, async (p) => {
			expect(await readCodexSessionMeta(p)).toBeNull();
		});
	});

	it("returns null for a torn header rather than throwing", async () => {
		await withFile('{"type":"session_meta","payload":{"cwd":"/re', async (p) => {
			expect(await readCodexSessionMeta(p)).toBeNull();
		});
	});
});

describe("listCodexFiles", () => {
	async function withHome(fn: (homeDir: string) => Promise<void>): Promise<void> {
		const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-codex-hist-"));
		try {
			const homeDir = path.join(root, "home");
			const day = path.join(homeDir, ".codex", "sessions", "2026", "08", "01");
			const otherDay = path.join(homeDir, ".codex", "sessions", "2026", "06", "15");
			await mkdir(day, { recursive: true });
			await mkdir(otherDay, { recursive: true });
			await writeFile(
				path.join(day, "rollout-alpha.jsonl"),
				`${sessionMeta("/repo/alpha", "roll-alpha")}\n${userEvent("hi")}\n`,
			);
			await writeFile(
				path.join(day, "rollout-beta.jsonl"),
				`${sessionMeta("/repo/beta", "roll-beta")}\n${userEvent("hi")}\n`,
			);
			await writeFile(path.join(otherDay, "rollout-old.jsonl"), `${sessionMeta("/repo/alpha")}\n`);
			await writeFile(path.join(day, "torn.jsonl"), '{"type":"session_meta","payl');
			await fn(homeDir);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}

	async function collect(homeDir: string, s: SearchScope) {
		const out: HistoryFile[] = [];
		for await (const found of listCodexFiles(s, context({ homeDir }))) {
			out.push(found);
		}
		return out;
	}

	it("walks date shards and carries the header cwd and rollout id", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope());
			const alpha = found.find((f) => f.path.endsWith("rollout-alpha.jsonl"));

			expect(found).toHaveLength(4);
			expect(alpha?.projectPath).toBe("/repo/alpha");
			expect(alpha?.sessionId).toBe("roll-alpha");
		});
	});

	it("prunes by project path using only the header", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope({ projectPath: "/repo/alpha" }));

			// alpha from both shards, plus the torn file (fail-open); never beta.
			expect(found.some((f) => f.path.includes("beta"))).toBe(false);
			expect(found.some((f) => f.path.includes("alpha"))).toBe(true);
		});
	});

	// A file whose header could not be read must still be scanned, then filtered per record.
	it("fails open on an unreadable header", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope({ projectPath: "/repo/nowhere" }));

			expect(found.map((f) => path.basename(f.path))).toEqual(["torn.jsonl"]);
		});
	});

	it("prunes whole date shards outside the requested range", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope({ since: new Date("2026-07-01T00:00:00Z") }));

			expect(found.some((f) => f.path.includes(path.join("2026", "06")))).toBe(false);
		});
	});

	it("yields nothing when the sessions directory is absent", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-codex-empty-"));
		try {
			expect(await collect(root, scope())).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("resumeCodexSession", () => {
	it("reports the session cwd because codex resume is directory-scoped", () => {
		const resume = resumeCodexSession({
			agentId: "codex",
			role: "user",
			timestamp: null,
			text: "hi",
			sessionId: "roll-1",
			cwd: "/repo/alpha",
			sourcePath: "/x.jsonl",
			recordIndex: 0,
		});

		expect(resume).toEqual({ command: "codex", args: ["resume", "roll-1"], cwd: "/repo/alpha" });
	});
});
