export const agentConfig = {
	agentId: "claude",
	cliCommand: "claude",
	model: process.env.OA_E2E_CLAUDE_MODEL ?? "haiku",
	passthroughArgs: ["--version"],
};

export const expectedDir = new URL("./expected/", import.meta.url);
