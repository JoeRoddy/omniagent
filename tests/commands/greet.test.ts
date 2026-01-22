import { runCli } from "../../src/cli/index.js";

describe("greet command", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("prints a personalized greeting", async () => {
		await runCli(["node", "omniagent", "greet", "Alice"]);

		expect(logSpy).toHaveBeenCalledWith("Hello, Alice!");
	});

	it("prints an uppercase greeting", async () => {
		await runCli(["node", "omniagent", "greet", "Bob", "--uppercase"]);

		expect(logSpy).toHaveBeenCalledWith("HELLO, BOB!");
	});

	it("errors when name is missing", async () => {
		await runCli(["node", "omniagent", "greet"]);

		expect(errorSpy).toHaveBeenCalledWith("Error: Missing required argument: name");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
