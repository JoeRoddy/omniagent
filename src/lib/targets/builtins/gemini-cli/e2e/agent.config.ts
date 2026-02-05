export const agentConfig = {
	agentId: "gemini",
	cliCommand: "gemini",
	model: process.env.OA_E2E_GEMINI_MODEL ?? "gemini-2.5-flash-lite",
	timeoutMs: 360_000,
	passthroughArgs: ["--version"],
};

export const expectedDir = new URL("./expected/", import.meta.url);
