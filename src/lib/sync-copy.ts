import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { applyAgentTemplating } from "./agent-templating.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function decodeUtf8(buffer: Buffer): string | null {
	try {
		return utf8Decoder.decode(buffer);
	} catch {
		return null;
	}
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
	await mkdir(destination, { recursive: true });
	await cp(source, destination, { recursive: true, force: true });
}

export async function copyDirectoryWithTemplating(options: {
	source: string;
	destination: string;
	target: string;
	validAgents: string[];
}): Promise<void> {
	await mkdir(options.destination, { recursive: true });
	const entries = await readdir(options.source, { withFileTypes: true });

	for (const entry of entries) {
		const sourcePath = path.join(options.source, entry.name);
		const destinationPath = path.join(options.destination, entry.name);
		if (entry.isDirectory()) {
			await copyDirectoryWithTemplating({
				...options,
				source: sourcePath,
				destination: destinationPath,
			});
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}

		const buffer = await readFile(sourcePath);
		const decoded = decodeUtf8(buffer);
		if (decoded === null) {
			await mkdir(path.dirname(destinationPath), { recursive: true });
			await writeFile(destinationPath, buffer);
			continue;
		}

		const output = applyAgentTemplating({
			content: decoded,
			target: options.target,
			validAgents: options.validAgents,
			sourcePath,
		});
		await mkdir(path.dirname(destinationPath), { recursive: true });
		await writeFile(destinationPath, output, "utf8");
	}
}
