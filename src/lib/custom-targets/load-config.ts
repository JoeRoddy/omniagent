import { readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { OmniagentConfig } from "./types.js";

const CONFIG_FILENAMES = [
	"omniagent.config.ts",
	"omniagent.config.mts",
	"omniagent.config.cts",
	"omniagent.config.js",
	"omniagent.config.mjs",
	"omniagent.config.cjs",
];

type LoadedConfig = {
	configPath: string;
	config: OmniagentConfig;
};

let defineConfigStubPath: string | null = null;

async function resolveExistingConfigPath(repoRoot: string, configPath?: string | null) {
	if (configPath) {
		return path.isAbsolute(configPath) ? configPath : path.resolve(repoRoot, configPath);
	}
	for (const fileName of CONFIG_FILENAMES) {
		const candidate = path.join(repoRoot, fileName);
		try {
			const stats = await stat(candidate);
			if (stats.isFile()) {
				return candidate;
			}
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") {
				throw error;
			}
		}
	}
	return null;
}

async function ensureDefineConfigStub(): Promise<string> {
	if (defineConfigStubPath) {
		return defineConfigStubPath;
	}
	const stubName = `omniagent-define-config-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2)}.mjs`;
	const stubPath = path.join(os.tmpdir(), stubName);
	const contents =
		"export const defineConfig = (config) => config;\n" +
		"const api = { defineConfig };\n" +
		"export default api;\n";
	await writeFile(stubPath, contents, "utf8");
	defineConfigStubPath = stubPath;
	return stubPath;
}

async function loadTypeScript() {
	try {
		return await import("typescript");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`TypeScript runtime is required to load omniagent.config.ts. ${message}`,
		);
	}
}

function rewriteOmniagentImports(contents: string, stubUrl: string): string {
	const fromRegex = /from\s+["']omniagent["']/g;
	const dynamicRegex = /import\(\s*["']omniagent["']\s*\)/g;
	const requireRegex = /require\(\s*["']omniagent["']\s*\)/g;
	return contents
		.replace(fromRegex, `from \"${stubUrl}\"`)
		.replace(dynamicRegex, `import(\"${stubUrl}\")`)
		.replace(requireRegex, `require(\"${stubUrl}\")`);
}

async function transpileConfig(configPath: string): Promise<string> {
	const ts = await loadTypeScript();
	const source = await readFile(configPath, "utf8");
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ES2022,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
		},
		fileName: configPath,
	});

	const stubPath = await ensureDefineConfigStub();
	const stubUrl = pathToFileURL(stubPath).href;
	return rewriteOmniagentImports(output.outputText, stubUrl);
}

async function importConfigModule(modulePath: string): Promise<OmniagentConfig> {
	const url = pathToFileURL(modulePath).href;
	const mod = await import(url);
	const config = mod?.default ?? mod?.config ?? mod;
	if (!config || typeof config !== "object") {
		throw new Error("omniagent.config did not export a configuration object.");
	}
	return config as OmniagentConfig;
}

export async function loadConfig(options: {
	repoRoot: string;
	configPath?: string | null;
}): Promise<LoadedConfig | null> {
	const configPath = await resolveExistingConfigPath(options.repoRoot, options.configPath);
	if (!configPath) {
		return null;
	}

	const extension = path.extname(configPath).toLowerCase();
	if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
		const config = await importConfigModule(configPath);
		return { configPath, config };
	}

	const compiled = await transpileConfig(configPath);
	const tempName = `.omniagent.config.${Date.now()}-${Math.random()
		.toString(36)
		.slice(2)}.mjs`;
	const tempPath = path.join(path.dirname(configPath), tempName);
	try {
		await writeFile(tempPath, compiled, "utf8");
		const config = await importConfigModule(tempPath);
		return { configPath, config };
	} finally {
		await rm(tempPath, { force: true });
	}
}
