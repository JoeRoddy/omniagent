import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentsDir, validateAgentsDir } from "../../src/lib/agents-dir.js";

async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omniagent-agents-dir-"));
	try {
		await fn(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const skipPermissions =
	process.platform === "win32" || (typeof process.getuid === "function" && process.getuid() === 0);
const permissionTest = skipPermissions ? it.skip : it;

describe("agents dir helpers", () => {
	it("resolves default agents dir when override is empty", async () => {
		await withTempDir(async (root) => {
			const expected = path.resolve(root, "agents");
			const inputs: Array<string | null | undefined> = [undefined, null, "", "   "];
			for (const input of inputs) {
				const result = resolveAgentsDir(root, input ?? undefined);
				expect(result.requestedPath).toBeNull();
				expect(result.resolvedPath).toBe(expected);
				expect(result.source).toBe("default");
				expect(result.isDefault).toBe(true);
			}
		});
	});

	it("resolves relative overrides from the repo root", async () => {
		await withTempDir(async (root) => {
			const result = resolveAgentsDir(root, " ./custom/agents/ ");

			expect(result.requestedPath).toBe("./custom/agents/");
			expect(result.resolvedPath).toBe(path.resolve(root, "custom/agents"));
			expect(result.source).toBe("override");
			expect(result.isDefault).toBe(false);
		});
	});

	it("preserves absolute override paths", async () => {
		await withTempDir(async (root) => {
			const absolute = path.join(root, "absolute-agents");
			const result = resolveAgentsDir(root, absolute);

			expect(result.requestedPath).toBe(absolute);
			expect(result.resolvedPath).toBe(absolute);
			expect(result.source).toBe("override");
			expect(result.isDefault).toBe(false);
		});
	});

	it("normalizes relative override paths", async () => {
		await withTempDir(async (root) => {
			const result = resolveAgentsDir(root, "./custom/../custom/agents");

			expect(result.resolvedPath).toBe(path.resolve(root, "custom/agents"));
		});
	});

	it("validates existing directories", async () => {
		await withTempDir(async (root) => {
			await mkdir(path.join(root, "custom", "agents"), { recursive: true });

			const result = await validateAgentsDir(root, "custom/agents");

			expect(result.validationStatus).toBe("valid");
			expect(result.errorMessage).toBeNull();
		});
	});

	it("reports missing directories", async () => {
		await withTempDir(async (root) => {
			const result = await validateAgentsDir(root, "missing-dir");

			expect(result.validationStatus).toBe("missing");
			expect(result.errorMessage).toContain("Agents directory not found");
			expect(result.errorMessage).toContain(path.join(root, "missing-dir"));
		});
	});

	it("reports when the override path is a file", async () => {
		await withTempDir(async (root) => {
			const filePath = path.join(root, "custom", "agents");
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, "not a directory", "utf8");

			const result = await validateAgentsDir(root, "custom/agents");

			expect(result.validationStatus).toBe("notDirectory");
			expect(result.errorMessage).toContain("not a directory");
			expect(result.errorMessage).toContain(filePath);
		});
	});

	it("reports when a parent segment is a file", async () => {
		await withTempDir(async (root) => {
			const parentFile = path.join(root, "custom");
			const expectedPath = path.join(root, "custom", "agents");
			await writeFile(parentFile, "not a directory", "utf8");

			const result = await validateAgentsDir(root, "custom/agents");

			expect(result.validationStatus).toBe("notDirectory");
			expect(result.errorMessage).toContain("not a directory");
			expect(result.errorMessage).toContain(expectedPath);
		});
	});

	permissionTest("reports permission denied when stat cannot access the directory", async () => {
		await withTempDir(async (root) => {
			const restrictedRoot = path.join(root, "restricted");
			const agentsDir = path.join(restrictedRoot, "agents");
			await mkdir(agentsDir, { recursive: true });
			await chmod(restrictedRoot, 0o000);

			try {
				const result = await validateAgentsDir(root, "restricted/agents");

				expect(result.validationStatus).toBe("permissionDenied");
				expect(result.errorMessage).toContain("not accessible");
				expect(result.errorMessage).toContain(agentsDir);
			} finally {
				await chmod(restrictedRoot, 0o700);
			}
		});
	});

	permissionTest(
		"reports permission denied when directory is not readable, writable, or searchable",
		async () => {
			await withTempDir(async (root) => {
				const agentsDir = path.join(root, "custom", "agents");
				await mkdir(agentsDir, { recursive: true });
				await chmod(agentsDir, 0o500);

				try {
					const result = await validateAgentsDir(root, "custom/agents");

					expect(result.validationStatus).toBe("permissionDenied");
					expect(result.errorMessage).toContain("not readable, writable, or searchable");
					expect(result.errorMessage).toContain(agentsDir);
				} finally {
					await chmod(agentsDir, 0o700);
				}
			});
		},
	);

	permissionTest("reports permission denied when directory is not searchable", async () => {
		await withTempDir(async (root) => {
			const agentsDir = path.join(root, "custom", "agents");
			await mkdir(agentsDir, { recursive: true });
			await chmod(agentsDir, 0o600);

			try {
				const result = await validateAgentsDir(root, "custom/agents");

				expect(result.validationStatus).toBe("permissionDenied");
				expect(result.errorMessage).toContain("not readable, writable, or searchable");
				expect(result.errorMessage).toContain(agentsDir);
			} finally {
				await chmod(agentsDir, 0o700);
			}
		});
	});
});
