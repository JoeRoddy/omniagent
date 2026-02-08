import type { CommandModule } from "yargs";
import { findRepoRoot } from "../../lib/repo-root.js";
import { resetProjectState } from "../../lib/state-reset.js";

export const resetStateCommand: CommandModule = {
	command: "reset-state",
	describe: "Reset omniagent project state for the current repository",
	handler: async () => {
		const startDir = process.cwd();
		const repoRoot = await findRepoRoot(startDir);
		if (!repoRoot) {
			console.error("Error: Could not find a project root from the current directory.");
			process.exit(1);
			return;
		}

		const result = await resetProjectState(repoRoot);
		if (result.removedPaths.length === 0) {
			console.log(`No project state found for: ${repoRoot}`);
			return;
		}

		console.log(`Reset project state for: ${repoRoot}`);
		console.log(`Removed ${result.removedPaths.length} path(s).`);
	},
};
