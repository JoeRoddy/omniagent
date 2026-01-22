import { runCli } from "../../src/cli/index.js";

describe("echo command", () => {
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

	it("echoes a message once by default", async () => {
		await runCli(["node", "omniagent", "echo", "test"]);

		expect(logSpy).toHaveBeenCalledWith("test");
	});

	it("repeats the message when --times is provided", async () => {
		await runCli(["node", "omniagent", "echo", "hi", "--times", "3"]);

		expect(logSpy).toHaveBeenCalledWith("hi\nhi\nhi");
	});

	it("adds a prefix when --prefix is provided", async () => {
		await runCli(["node", "omniagent", "echo", "msg", "--prefix", "> "]);

		expect(logSpy).toHaveBeenCalledWith("> msg");
	});

	it("errors on invalid --times values", async () => {
		await runCli(["node", "omniagent", "echo", "x", "--times", "-1"]);

		expect(errorSpy).toHaveBeenCalledWith(
			"Error: Invalid value for --times: must be positive integer",
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
