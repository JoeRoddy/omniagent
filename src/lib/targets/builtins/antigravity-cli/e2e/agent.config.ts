export const agentConfig = {
	agentId: "agy",
	cliCommand: "agy",
	model: process.env.OA_E2E_AGY_MODEL ?? "Gemini 3.5 Flash (Low)",
	timeoutMs: 360_000,
	passthroughArgs: ["--version"],
};

export const expectedDir = new URL("./expected/", import.meta.url);
