import { vi } from "vitest";

const ptyMock = vi.hoisted(() => {
	const spawn = vi.fn((_command: string, args: string[]) => {
		if (args.some((arg) => arg.includes("throw-spawn"))) {
			throw new Error("spawn failed");
		}

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
		if (args.some((arg) => arg.includes("exit-early"))) {
			setTimeout(() => {
				for (const handler of exitHandlers) {
					handler({ exitCode: 0 });
				}
			}, 10);
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

	it("awaits an asynchronous write resolver and writes its returned key", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		let resolveWrite: ((value: string | undefined) => void) | undefined;
		const write = new Promise<string | undefined>((resolve) => {
			resolveWrite = resolve;
		});

		const resultPromise = runPtyScenario({
			command: "node",
			args: ["-e", "ready"],
			timeoutMs: 1_000,
			steps: [
				{ waitFor: ({ raw }) => raw.includes("ready") },
				{
					waitMs: 20,
					write: async ({ screen }) => {
						expect(screen).toContain("ready");
						markStarted?.();
						return write;
					},
				},
			],
		});

		await started;
		const child = ptyMock.spawn.mock.results.at(-1)?.value;
		expect(child?.write).not.toHaveBeenCalled();
		resolveWrite?.("\r");
		await resultPromise;
		expect(child?.write).toHaveBeenCalledWith("\r");
	});

	it("aborts while an asynchronous write resolver is pending", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");
		const controller = new AbortController();
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});

		const resultPromise = runPtyScenario({
			command: "node",
			args: ["-e", "ready"],
			timeoutMs: 1_000,
			signal: controller.signal,
			steps: [
				{
					waitFor: ({ screen }) => screen.includes("ready"),
					write: () => {
						markStarted?.();
						return new Promise<string | undefined>(() => {});
					},
				},
			],
		});

		await started;
		controller.abort(new Error("confirmation cancelled"));
		await expect(resultPromise).rejects.toMatchObject({
			name: "PtyScenarioError",
			timedOut: true,
			message: "confirmation cancelled",
		});
		expect(ptyMock.spawn.mock.results.at(-1)?.value.kill).toHaveBeenCalled();
	});

	it("enforces its timeout when a non-aborting external signal is present", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");
		const controller = new AbortController();

		const result = runPtyScenario({
			command: "node",
			args: ["-e", "ready"],
			timeoutMs: 20,
			signal: controller.signal,
			steps: [
				{
					waitFor: ({ screen }) => screen.includes("ready"),
					write: () => new Promise<string | undefined>(() => {}),
				},
			],
		});

		await expect(result).rejects.toMatchObject({
			name: "PtyScenarioError",
			timedOut: true,
			message: "PTY scenario timed out after 20ms.",
		});
		expect(controller.signal.aborted).toBe(false);
		expect(ptyMock.spawn.mock.results.at(-1)?.value.kill).toHaveBeenCalled();
	});

	it("marks a pending resolver timeout after the child exits as timed out", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");

		const result = runPtyScenario({
			command: "node",
			args: ["-e", "ready exit-early"],
			timeoutMs: 80,
			steps: [
				{
					waitFor: ({ screen }) => screen.includes("ready"),
					write: () => new Promise<string | undefined>(() => {}),
				},
			],
		});

		await expect(result).rejects.toMatchObject({
			name: "PtyScenarioError",
			timedOut: true,
			message: "PTY scenario timed out after 80ms.",
		});
		expect(ptyMock.spawn.mock.results.at(-1)?.value.kill).not.toHaveBeenCalled();
	});

	it("throws when required output does not arrive", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");

		await expect(
			runPtyScenario({
				command: "node",
				args: ["-e", "missing"],
				timeoutMs: 1_000,
				steps: [{ waitFor: "ready", waitForTimeoutMs: 10, capture: "ready" }],
			}),
		).rejects.toThrow("Timed out waiting for ready.");
	});

	it("includes debug artifacts when required output does not arrive", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");

		await expect(
			runPtyScenario({
				command: "node",
				args: ["-e", "ready"],
				timeoutMs: 1_000,
				steps: [
					{ waitMs: 20, capture: "ready" },
					{ waitFor: "missing", waitForTimeoutMs: 10, capture: "missing" },
				],
				debug: {
					enabled: true,
					includeRawOutput: true,
					includeScreenSnapshots: true,
				},
			}),
		).rejects.toMatchObject({
			name: "PtyScenarioError",
			raw: expect.stringContaining("ready"),
			debug: expect.arrayContaining([
				expect.objectContaining({ type: "raw-output", label: "pty.raw" }),
				expect.objectContaining({ type: "screen-snapshot", label: "ready" }),
				expect.objectContaining({ type: "screen-snapshot", label: "final" }),
			]),
		});
	});

	it("rejects timed out processes and kills them safely", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");

		await expect(
			runPtyScenario({
				command: "node",
				args: ["-e", "setInterval"],
				timeoutMs: 10,
				steps: [{ waitMs: 20 }],
				finalWaitMs: 0,
			}),
		).rejects.toMatchObject({
			name: "PtyScenarioError",
			timedOut: true,
			message: "PTY scenario timed out after 10ms.",
		});
	});

	it("uses an external abort signal to cancel the scenario", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");
		const controller = new AbortController();
		const result = runPtyScenario({
			command: "node",
			args: ["-e", "ready"],
			timeoutMs: 1_000,
			signal: controller.signal,
			steps: [{ waitMs: 1_000 }],
			debug: {
				enabled: true,
				includeRawOutput: true,
				includeScreenSnapshots: true,
			},
		});

		setTimeout(() => {
			controller.abort(new Error("external timeout"));
		}, 20);

		await expect(result).rejects.toMatchObject({
			name: "PtyScenarioError",
			timedOut: true,
			message: "external timeout",
			debug: expect.arrayContaining([
				expect.objectContaining({ type: "raw-output", label: "pty.raw" }),
				expect.objectContaining({ type: "screen-snapshot", label: "final" }),
			]),
		});
	});

	it("rejects spawn failures after terminal setup", async () => {
		const { runPtyScenario } = await import("../../../src/lib/usage/pty.js");

		await expect(
			runPtyScenario({
				command: "node",
				args: ["-e", "throw-spawn"],
				timeoutMs: 1_000,
				steps: [],
			}),
		).rejects.toMatchObject({
			name: "PtyScenarioError",
			message: "spawn failed",
		});
	});
});
