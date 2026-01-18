import type { CommandModule } from "yargs";

type EchoArgs = {
	message?: string;
	times?: number;
	prefix?: string;
};

export const echoCommand: CommandModule<Record<string, never>, EchoArgs> = {
	command: "echo [message]",
	describe: "Echo a message with optional repetition and prefix",
	builder: (yargs) =>
		yargs
			.positional("message", {
				type: "string",
				describe: "Message to echo",
				default: "",
			})
			.option("times", {
				alias: "t",
				type: "number",
				default: 1,
				describe: "Number of times to repeat",
			})
			.option("prefix", {
				alias: "p",
				type: "string",
				default: "",
				describe: "Prefix for each line",
			}),
	handler: (argv) => {
		const times = Number(argv.times ?? 1);
		if (!Number.isInteger(times) || times <= 0) {
			console.error("Error: Invalid value for --times: must be positive integer");
			process.exit(1);
			return;
		}

		const message = argv.message ?? "";
		const prefix = argv.prefix ?? "";
		const lines = Array.from({ length: times }, () => `${prefix}${message}`);
		const output = lines.join("\n");

		if (output.length > 0) {
			console.log(output);
		}
	},
};
