import { runCli } from "../../src/cli/index.js";

const joinOutput = (calls: Array<[unknown]>) => calls.map(([arg]) => String(arg)).join("\n");

describe("CLI root command", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		process.exitCode = undefined;
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
		process.exitCode = undefined;
	});

	it("prints the default greeting", async () => {
		await runCli(["node", "omniagent"]);

		expect(logSpy).toHaveBeenCalledWith("Hello from omniagent!");
		expect(errorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it("supports --help output at the root level", async () => {
		await runCli(["node", "omniagent", "--help"]);

		const output = joinOutput(logSpy.mock.calls);
		expect(output).toContain("omniagent CLI");
		expect(output).toContain("Commands:");
		expect(output).toContain("Options:");
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it("supports --version output at the root level", async () => {
		await runCli(["node", "omniagent", "--version"]);

		const output = joinOutput(logSpy.mock.calls).trim();
		expect(output).toMatch(/\d+\.\d+\.\d+/);
		expect(exitSpy).not.toHaveBeenCalled();
	});
});
