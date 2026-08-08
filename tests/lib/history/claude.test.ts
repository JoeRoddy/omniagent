import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	cleanClaudeText,
	listClaudeFiles,
	normalizeClaudeLine,
	projectSlugMatches,
	resumeClaudeSession,
	slugifyProjectPath,
} from "../../../src/lib/history/claude.js";
import type {
	HistoryContext,
	HistoryFile,
	HistoryRole,
	SearchScope,
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

	async function collect(homeDir: string, s: SearchScope, roles: HistoryRole[]) {
		const out: string[] = [];
		for await (const found of listClaudeFiles(s, context({ homeDir, roles: new Set(roles) }))) {
			out.push(found.path);
		}
		return out;
	}

	// 111 of 203 files on a real install live under subagents/. A one-level walk drops them all.
	it("recurses into subagent transcripts", async () => {
		await withHome(async (homeDir) => {
			const found = await collect(homeDir, scope(), ["user", "assistant", "agent"]);

			expect(found.some((p) => p.includes(`${path.sep}subagents${path.sep}`))).toBe(true);
			expect(found).toHaveLength(3);
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
