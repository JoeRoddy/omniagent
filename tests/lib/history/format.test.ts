import {
	collapseText,
	formatResumeCommand,
	sanitizeTerminalText,
} from "../../../src/lib/history/format.js";

describe("terminal-safe formatting", () => {
	it("removes VT and control sequences from displayed transcript text", () => {
		const text = "before\x1b]52;c;YXR0YWNr\x07after\x1b[31mred\x1b[0m";
		const sanitized = sanitizeTerminalText(text);

		expect(sanitized).not.toContain("\x1b");
		expect(sanitized).not.toContain("\x07");
		expect(collapseText(text)).not.toContain("\x1b");
	});

	it("shell-quotes resume commands and project paths", () => {
		expect(
			formatResumeCommand(
				{ command: "claude", args: ["--resume", "abc"], cwd: "/tmp/project with spaces" },
				"/tmp/else",
				"/Users/demo",
			),
		).toBe("cd '/tmp/project with spaces' && claude --resume abc");
		expect(
			formatResumeCommand(
				{ command: "demo; touch /tmp/pwned", args: ["a'b"], cwd: null },
				"/tmp/else",
				"/Users/demo",
			),
		).toBe(`'demo; touch /tmp/pwned' 'a'"'"'b'`);
		expect(
			formatResumeCommand(
				{ command: "X=1", args: ["touch", "/tmp/pwned"], cwd: null },
				"/tmp/else",
				"/Users/demo",
			),
		).toBe("'X=1' touch /tmp/pwned");
	});

	it("keeps home shortening valid when the path needs quotes", () => {
		expect(
			formatResumeCommand(
				{
					command: "codex",
					args: ["resume", "abc"],
					cwd: "/Users/demo/project with spaces",
				},
				"/tmp/else",
				"/Users/demo",
			),
		).toBe("cd ~/'project with spaces' && codex resume abc");
	});

	it("leaves an exact home path unquoted so the shell expands it", () => {
		expect(
			formatResumeCommand(
				{ command: "codex", args: ["resume", "abc"], cwd: "/Users/demo" },
				"/tmp/else",
				"/Users/demo",
			),
		).toBe("cd ~ && codex resume abc");
	});

	it("renders a PowerShell-safe command on Windows", () => {
		expect(
			formatResumeCommand(
				{
					command: "demo agent",
					args: ["resume", "a'b"],
					cwd: "C:\\Project With Spaces",
				},
				"C:\\Elsewhere",
				"C:\\Users\\demo",
				"win32",
			),
		).toBe(
			"Set-Location -LiteralPath 'C:\\Project With Spaces'; if ($?) { & 'demo agent' 'resume' 'a''b' }",
		);
	});
});
