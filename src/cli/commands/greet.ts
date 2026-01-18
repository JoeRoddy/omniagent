import type { CommandModule } from "yargs";

type GreetArgs = {
	name?: string;
	uppercase?: boolean;
};

export const greetCommand: CommandModule<Record<string, never>, GreetArgs> = {
	command: "greet <name>",
	describe: "Greet someone by name",
	builder: (yargs) =>
		yargs
			.positional("name", {
				type: "string",
				describe: "Name to greet",
			})
			.option("uppercase", {
				alias: "u",
				type: "boolean",
				default: false,
				describe: "Output in uppercase",
			}),
	handler: (argv) => {
		if (!argv.name) {
			console.error("Error: Name is required.");
			process.exit(1);
			return;
		}

		const greeting = `Hello, ${argv.name}!`;
		if (argv.uppercase ?? false) {
			console.log(greeting.toUpperCase());
			return;
		}

		console.log(greeting);
	},
};
