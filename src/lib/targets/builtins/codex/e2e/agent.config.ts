export const agentConfig = {
	agentId: "codex",
	cliCommand: "codex",
	model: process.env.OA_E2E_CODEX_MODEL ?? "gpt-5.1-codex-mini",
	passthroughDefaults: ["-c", 'model_reasoning_effort="high"'],
	passthroughArgs: ["--version"],
};

export const expectedDir = new URL("./expected/", import.meta.url);
