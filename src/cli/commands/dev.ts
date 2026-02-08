import type { CommandModule } from "yargs";
import { resetStateCommand } from "./reset-state.js";

export const devCommand: CommandModule = {
	command: "dev <command>",
	describe: "Developer utilities",
	builder: (yargs) =>
		yargs.command(resetStateCommand).demandCommand(1, "Specify a dev command.").strictCommands(),
	handler: () => {
		// Subcommand handlers perform all work.
	},
};
