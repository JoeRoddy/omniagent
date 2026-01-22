import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const TS_BUILD_INFO = path.join(REPO_ROOT, "tsconfig.tsbuildinfo");

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

async function runTypecheck(): Promise<void> {
	const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
	await new Promise<void>((resolve, reject) => {
		const child = spawn(npmCmd, ["run", "typecheck"], {
			cwd: REPO_ROOT,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(stderr || `typecheck failed with exit code ${code}`));
		});
	});
}

describe.sequential("typecheck command", () => {
	it("runs successfully without emitting build artifacts", async () => {
		const existedBefore = await pathExists(TS_BUILD_INFO);

		await runTypecheck();

		const existsAfter = await pathExists(TS_BUILD_INFO);
		if (!existedBefore && existsAfter) {
			await rm(TS_BUILD_INFO, { force: true });
		}

		expect(existsAfter).toBe(existedBefore);
	});
});
