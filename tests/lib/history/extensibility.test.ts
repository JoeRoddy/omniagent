import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../../../src/cli/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = path.resolve(HERE, "../../../src/lib/history");

/**
 * A whole agent defined in user config: its own directory layout, its own record format (pipe
 * delimited, not JSON), its own resume verb. Nothing about it is known to the engine.
 */
function configSource(demoRoot: string, arrayRoot: string): string {
	return `import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const DEMO_ROOT = ${JSON.stringify(demoRoot)};
const ARRAY_ROOT = ${JSON.stringify(arrayRoot)};

export default {
	targets: [
		{
			id: "demo",
			displayName: "Demo Agent",
			history: {
				roles: ["user"],
				listFiles: async function* () {
					const entries = await readdir(DEMO_ROOT, { withFileTypes: true });
					for (const entry of entries) {
						if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
						yield {
							path: path.join(DEMO_ROOT, entry.name),
							projectPath: "/demo/project",
							sessionId: path.basename(entry.name, ".log"),
							modifiedAt: "2026-08-09T00:00:00.000Z",
							sizeBytes: null,
						};
					}
				},
				// Bespoke line format: TIMESTAMP|ROLE|TEXT. The engine only splits lines; every
				// bit of parsing lives here.
				normalize: (line, file, index, context) => {
					const parts = line.split("|");
					if (parts.length < 3) return null;
					const [timestamp, role, ...rest] = parts;
					if (role !== "user") return null;
					return {
						agentId: context.targetId,
						role: "user",
						timestamp,
						text: rest.join("|"),
						sessionId: file.sessionId,
						cwd: file.projectPath,
						sourcePath: file.path,
						recordIndex: index,
					};
				},
				resume: (record) => ({
					command: "demo-cli",
					args: ["--session", record.sessionId],
					cwd: null,
				}),
			},
		},
		{
			id: "arraystore",
			displayName: "Array Store Agent",
			history: {
				roles: ["user"],
				listFiles: async function* () {
					yield {
						path: path.join(ARRAY_ROOT, "store.json"),
						projectPath: "/array/project",
						sessionId: "arr-1",
						modifiedAt: "2026-08-08T00:00:00.000Z",
						sizeBytes: null,
					};
				},
				// Not line-oriented at all: one JSON document holding every message.
				scan: {
					kind: "custom",
					read: async function* (file, context) {
						const rows = JSON.parse(await readFile(file.path, "utf8"));
						let index = 0;
						for (const row of rows) {
							yield {
								agentId: context.targetId,
								role: "user",
								timestamp: row.at,
								text: row.text,
								sessionId: file.sessionId,
								cwd: file.projectPath,
								sourcePath: file.path,
								recordIndex: index++,
							};
						}
					},
				},
			},
		},
	],
};
`;
}

type Fixture = { root: string; repoRoot: string; homeDir: string };

async function withCustomAgent(fn: (fixture: Fixture) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-extensible-"));
	try {
		const repoRoot = path.join(root, "repo");
		const homeDir = path.join(root, "home");
		const demoRoot = path.join(root, "demo-history");
		const arrayRoot = path.join(root, "array-history");
		await mkdir(path.join(repoRoot, "agents"), { recursive: true });
		await mkdir(demoRoot, { recursive: true });
		await mkdir(arrayRoot, { recursive: true });
		await mkdir(homeDir, { recursive: true });
		await writeFile(path.join(repoRoot, "package.json"), "{}\n");
		await writeFile(
			path.join(repoRoot, "agents", "omniagent.config.mjs"),
			configSource(demoRoot, arrayRoot),
		);
		await writeFile(
			path.join(demoRoot, "sess-demo.log"),
			[
				"2026-08-09T10:00:00.000Z|user|demo agent talks about zebras",
				"2026-08-09T10:01:00.000Z|assistant|assistant mentions zebras",
				"2026-08-09T09:00:00.000Z|user|an older zebras prompt",
				"",
			].join("\n"),
		);
		await writeFile(
			path.join(arrayRoot, "store.json"),
			JSON.stringify([
				{ at: "2026-08-08T10:00:00.000Z", text: "array store mentions zebras" },
				{ at: "2026-08-08T09:00:00.000Z", text: "unrelated entry" },
			]),
		);
		await fn({ root, repoRoot, homeDir });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe.sequential("history capability extensibility", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let homeSpy: ReturnType<typeof vi.spyOn> | null = null;
	let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		process.env.NO_COLOR = "1";
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
		homeSpy?.mockRestore();
		cwdSpy?.mockRestore();
		homeSpy = null;
		cwdSpy = null;
	});

	function use(fixture: Fixture): void {
		homeSpy = vi.spyOn(os, "homedir").mockReturnValue(fixture.homeDir);
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(fixture.repoRoot);
	}

	function envelope(): {
		matches: Array<Record<string, unknown>>;
		stats: Record<string, number>;
	} {
		return JSON.parse(logSpy.mock.calls.map(([value]) => String(value)).join("\n"));
	}

	// The actual proof of the contract: a brand-new agent, defined only in user config, is fully
	// searchable without a single line changing inside the search engine.
	it("searches an agent defined entirely in omniagent.config, with zero engine changes", async () => {
		await withCustomAgent(async (fixture) => {
			use(fixture);
			await runCli([
				"node",
				"omniagent",
				"search",
				"zebras",
				"--only",
				"demo",
				"--json",
				"--limit",
				"0",
			]);

			const result = envelope();
			expect(result.matches.map((match) => match.text)).toEqual([
				"demo agent talks about zebras",
				"an older zebras prompt",
			]);
			expect(result.matches[0]?.agentId).toBe("demo");
			expect(result.matches[0]?.displayName).toBe("Demo Agent");
		});
	});

	it("honours the custom agent's own role filtering", async () => {
		await withCustomAgent(async (fixture) => {
			use(fixture);
			await runCli([
				"node",
				"omniagent",
				"search",
				"zebras",
				"--only",
				"demo",
				"--json",
				"--limit",
				"0",
			]);

			// The reader drops the assistant line itself; the engine never sees it.
			expect(envelope().matches.map((match) => match.text)).not.toContain(
				"assistant mentions zebras",
			);
		});
	});

	it("renders the custom agent's own resume verb", async () => {
		await withCustomAgent(async (fixture) => {
			use(fixture);
			await runCli(["node", "omniagent", "search", "zebras", "--only", "demo", "--json"]);

			expect(envelope().matches[0]?.resumeCommand).toBe("demo-cli --session sess-demo");
		});
	});

	// The escape hatch: an agent whose history is not line-oriented at all.
	it("searches a custom scan target backed by a single JSON document", async () => {
		await withCustomAgent(async (fixture) => {
			use(fixture);
			await runCli([
				"node",
				"omniagent",
				"search",
				"zebras",
				"--only",
				"arraystore",
				"--json",
				"--limit",
				"0",
			]);

			expect(envelope().matches.map((match) => match.text)).toEqual([
				"array store mentions zebras",
			]);
		});
	});

	it("orders results newest-first across built-in and custom agents alike", async () => {
		await withCustomAgent(async (fixture) => {
			use(fixture);
			await runCli([
				"node",
				"omniagent",
				"search",
				"zebras",
				"--only",
				"demo,arraystore",
				"--json",
				"--limit",
				"0",
			]);

			expect(envelope().matches.map((match) => match.timestamp)).toEqual([
				"2026-08-09T10:00:00.000Z",
				"2026-08-09T09:00:00.000Z",
				"2026-08-08T10:00:00.000Z",
			]);
		});
	});

	it("rejects a history block that defines neither reader", async () => {
		await withCustomAgent(async (fixture) => {
			use(fixture);
			await writeFile(
				path.join(fixture.repoRoot, "agents", "omniagent.config.mjs"),
				`export default {
	targets: [{ id: "broken", history: { roles: ["user"], listFiles: async function* () {} } }],
};
`,
			);
			await runCli(["node", "omniagent", "search", "zebras"]);

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("must define normalize (for JSONL) or scan.read"),
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	// A source-level guard, in the spirit of the existing tests/docs assertions: it fails loudly
	// the first time someone reaches for a target-specific shortcut inside the engine.
	it("keeps every engine module free of agent-specific knowledge", async () => {
		const engineModules = [
			"types.ts",
			"query.ts",
			"jsonl.ts",
			"filters.ts",
			"search.ts",
			"format.ts",
		];

		for (const moduleName of engineModules) {
			const source = await readFile(path.join(HISTORY_DIR, moduleName), "utf8");

			expect(source, `${moduleName} must not name a specific agent`).not.toMatch(/claude|codex/i);
			expect(source, `${moduleName} must not import an agent reader`).not.toMatch(
				/from "\.\/(claude|codex)\.js"/,
			);
			expect(source, `${moduleName} must not branch on target id`).not.toMatch(
				/targetId\s*===\s*["']/,
			);
		}
	});
});
