import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type JsonlCounters, readJsonlLines } from "../../../src/lib/history/jsonl.js";

async function withTempFile(
	contents: string | Buffer,
	fn: (filePath: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-jsonl-"));
	try {
		const filePath = path.join(root, "transcript.jsonl");
		await writeFile(filePath, contents);
		await fn(filePath);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function collect(
	filePath: string,
	options: Parameters<typeof readJsonlLines>[1] = {},
): Promise<string[]> {
	const out: string[] = [];
	for await (const line of readJsonlLines(filePath, options)) {
		out.push(line.text);
	}
	return out;
}

function counters(): JsonlCounters {
	return { scannedBytes: 0, oversizedLines: 0 };
}

describe("readJsonlLines", () => {
	it("reads every record when lines straddle chunk boundaries", async () => {
		const records = Array.from({ length: 40 }, (_, i) =>
			JSON.stringify({ n: i, pad: "x".repeat(i) }),
		);
		await withTempFile(`${records.join("\n")}\n`, async (filePath) => {
			// 16-byte chunks guarantee nearly every record spans several reads.
			const lines = await collect(filePath, { highWaterMark: 16 });

			expect(lines).toEqual(records);
		});
	});

	it("yields a final line that has no trailing newline", async () => {
		await withTempFile('{"a":1}\n{"b":2}', async (filePath) => {
			expect(await collect(filePath, { highWaterMark: 4 })).toEqual(['{"a":1}', '{"b":2}']);
		});
	});

	it("yields a torn final line so the caller can count it as malformed", async () => {
		await withTempFile('{"a":1}\n{"b":', async (filePath) => {
			const lines = await collect(filePath, { highWaterMark: 4 });

			expect(lines).toEqual(['{"a":1}', '{"b":']);
			expect(() => JSON.parse(lines[1] as string)).toThrow();
		});
	});

	it("handles CRLF line endings", async () => {
		await withTempFile('{"a":1}\r\n{"b":2}\r\n', async (filePath) => {
			expect(await collect(filePath, { highWaterMark: 5 })).toEqual(['{"a":1}', '{"b":2}']);
		});
	});

	it("skips blank lines and handles an empty file", async () => {
		await withTempFile('\n\n{"a":1}\n\n', async (filePath) => {
			expect(await collect(filePath)).toEqual(['{"a":1}']);
		});
		await withTempFile("", async (filePath) => {
			expect(await collect(filePath)).toEqual([]);
		});
	});

	it("drops an over-length line, counts it, and resyncs to the next record", async () => {
		const huge = JSON.stringify({ big: "y".repeat(4000) });
		await withTempFile(`{"a":1}\n${huge}\n{"b":2}\n`, async (filePath) => {
			const stats = counters();
			const lines = await collect(filePath, {
				highWaterMark: 64,
				maxLineBytes: 512,
				counters: stats,
			});

			// The record after the oversized one must still come through — that is the resync.
			expect(lines).toEqual(['{"a":1}', '{"b":2}']);
			expect(stats.oversizedLines).toBe(1);
		});
	});

	it("keeps line indexes accurate across dropped and prefiltered lines", async () => {
		const huge = JSON.stringify({ big: "y".repeat(4000) });
		await withTempFile(`{"a":1}\n${huge}\n{"skip":1}\n{"b":2}\n`, async (filePath) => {
			const seen: Array<{ text: string; index: number }> = [];
			for await (const line of readJsonlLines(filePath, {
				highWaterMark: 64,
				maxLineBytes: 512,
				prefilter: (text) => !text.includes("skip"),
			})) {
				seen.push({ text: line.text, index: line.index });
			}

			expect(seen).toEqual([
				{ text: '{"a":1}', index: 0 },
				{ text: '{"b":2}', index: 3 },
			]);
		});
	});

	it("applies the prefilter without parsing", async () => {
		await withTempFile('{"a":1}\n{"b":2}\n{"a":3}\n', async (filePath) => {
			expect(await collect(filePath, { prefilter: (text) => text.includes('"a"') })).toEqual([
				'{"a":1}',
				'{"a":3}',
			]);
		});
	});

	it("counts scanned bytes", async () => {
		const body = '{"a":1}\n{"b":2}\n';
		await withTempFile(body, async (filePath) => {
			const stats = counters();
			await collect(filePath, { counters: stats, highWaterMark: 4 });

			expect(stats.scannedBytes).toBe(Buffer.byteLength(body));
		});
	});

	it("stops early when the signal aborts", async () => {
		const records = Array.from({ length: 200 }, (_, i) => JSON.stringify({ n: i }));
		await withTempFile(`${records.join("\n")}\n`, async (filePath) => {
			const controller = new AbortController();
			const seen: string[] = [];
			for await (const line of readJsonlLines(filePath, {
				highWaterMark: 16,
				signal: controller.signal,
			})) {
				seen.push(line.text);
				if (seen.length === 3) {
					controller.abort();
				}
			}

			expect(seen.length).toBeLessThan(records.length);
			expect(seen[0]).toBe(records[0]);
		});
	});

	it("decodes multi-byte characters split across chunks", async () => {
		const record = JSON.stringify({ text: "日本語 café 🎉 merge conflict" });
		await withTempFile(`${record}\n`, async (filePath) => {
			// 3-byte chunks slice straight through the multi-byte sequences.
			const lines = await collect(filePath, { highWaterMark: 3 });

			expect(lines).toEqual([record]);
			expect(JSON.parse(lines[0] as string).text).toContain("日本語");
		});
	});
});
