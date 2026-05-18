import { vi } from "vitest";

const ptyMock = vi.hoisted(() => {
	const spawn = vi.fn((_command: string, args: string[]) => {
		const dataHandlers: Array<(chunk: string) => void> = [];
		const exitHandlers: Array<(event: { exitCode: number }) => void> = [];
		const child = {
			write: vi.fn(),
			kill: vi.fn(() => {
				for (const handler of exitHandlers) {
					handler({ exitCode: 143 });
				}
			}),
			onData: vi.fn((handler: (chunk: string) => void) => {
				dataHandlers.push(handler);
			}),
			onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
				exitHandlers.push(handler);
			}),
		};

		if (args.some((arg) => arg.includes("ready"))) {
			setTimeout(() => {
				for (const handler of dataHandlers) {
					handler("\x1b[32mready\x1b[0m\r\n");
				}
			}, 5);
		}

		return child;
	});

	return { spawn };
});

vi.mock("node-pty", () => ({
	default: {
		spawn: ptyMock.spawn,
	},
}));

describe("PTY usage utility", () => {
	it("captures raw output, rendered screen text, named snapshots, and debug artifacts", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");
		const result = await runPtyScenario({
			command: "node",
			args: ["-e", "ready"],
			timeoutMs: 1_000,
			steps: [{ waitMs: 20, capture: "ready" }],
			debug: {
				enabled: true,
				includeRawOutput: true,
				includeScreenSnapshots: true,
			},
		});

		expect(result.raw).toContain("ready");
		expect(result.screen).toContain("ready");
		expect(result.snapshots.ready.screen).toContain("ready");
		expect(result.debug).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "raw-output", label: "pty.raw" }),
				expect.objectContaining({ type: "screen-snapshot", label: "ready" }),
			]),
		);
	});

	it("can wait for matching output before continuing", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");
		const result = await runPtyScenario({
			command: "node",
			args: ["-e", "ready"],
			timeoutMs: 1_000,
			steps: [{ waitFor: ({ raw }) => raw.includes("ready"), capture: "ready" }],
		});

		expect(result.raw).toContain("ready");
		expect(result.snapshots.ready.raw).toContain("ready");
	});

	it("marks timed out processes and kills them safely", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");
		const result = await runPtyScenario({
			command: "node",
			args: ["-e", "setInterval"],
			timeoutMs: 10,
			steps: [{ waitMs: 20 }],
			finalWaitMs: 0,
		});

		expect(result.timedOut).toBe(true);
	});
});
