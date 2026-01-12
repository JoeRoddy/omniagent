import { runCli } from "../../src/cli/index.js";

const joinOutput = (calls: Array<[unknown]>) => calls.map(([arg]) => String(arg)).join("\n");

describe("hello command", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	it("prints the default greeting", async () => {
		await runCli(["node", "agentctrl", "hello"]);

		expect(logSpy).toHaveBeenCalledWith("Hello, World!");
	});

	it("shows help output", async () => {
		await runCli(["node", "agentctrl", "hello", "--help"]);

		const output = joinOutput(logSpy.mock.calls);
		expect(output).toContain("agentctrl hello");
		expect(output).toContain("Options");
	});
});
