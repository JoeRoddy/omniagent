import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OutputFile, OutputWriteCounts, OutputWriteResult } from "./types.js";

type OutputWriteSummary = {
	results: OutputWriteResult[];
	warnings: string[];
	errors: string[];
};

function normalizePathKey(value: string): string {
	return path.normalize(value).replace(/\\/g, "/").toLowerCase();
}

function isAgentsFile(filePath: string): boolean {
	return path.basename(filePath).toLowerCase() === "agents.md";
}

function emptyCounts(): OutputWriteCounts {
	return { created: 0, updated: 0, skipped: 0, failed: 0 };
}

export class OutputWriter {
	private outputs: OutputFile[] = [];
	private results = new Map<string, OutputWriteResult>();
	private globalWarnings: string[] = [];
	private globalErrors: string[] = [];

	addOutput(output: OutputFile): void {
		this.outputs.push(output);
	}

	recordWarning(targetId: string, message: string): void {
		const entry = this.ensureResult(targetId);
		entry.warnings.push(message);
	}

	recordError(targetId: string, message: string): void {
		const entry = this.ensureResult(targetId);
		entry.errors.push(message);
		entry.counts.failed += 1;
	}

	recordSkip(targetId: string): void {
		const entry = this.ensureResult(targetId);
		entry.counts.skipped += 1;
	}

	private ensureResult(targetId: string): OutputWriteResult {
		const existing = this.results.get(targetId);
		if (existing) {
			return existing;
		}
		const created: OutputWriteResult = {
			targetId,
			counts: emptyCounts(),
			warnings: [],
			errors: [],
		};
		this.results.set(targetId, created);
		return created;
	}

	private recordGlobalWarning(message: string): void {
		this.globalWarnings.push(message);
	}

	private recordGlobalError(message: string): void {
		this.globalErrors.push(message);
	}

	private async writeOutput(output: OutputFile): Promise<void> {
		const buffer =
			typeof output.content === "string" ? Buffer.from(output.content, "utf8") : output.content;
		let existing: Buffer | null = null;
		try {
			existing = await readFile(output.path);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") {
				throw error;
			}
		}

		const result = this.ensureResult(output.targetId);
		if (existing && existing.equals(buffer)) {
			result.counts.skipped += 1;
			return;
		}

		await mkdir(path.dirname(output.path), { recursive: true });
		await writeFile(output.path, buffer);
		if (existing) {
			result.counts.updated += 1;
		} else {
			result.counts.created += 1;
		}
	}

	async writeAll(): Promise<OutputWriteSummary> {
		const grouped = new Map<string, OutputFile[]>();
		for (const output of this.outputs) {
			const key = normalizePathKey(output.path);
			const list = grouped.get(key) ?? [];
			list.push(output);
			grouped.set(key, list);
		}

		const toWrite: OutputFile[] = [];
		for (const outputs of grouped.values()) {
			if (outputs.length === 0) {
				continue;
			}
			const outputPath = outputs[0].path;
			if (isAgentsFile(outputPath)) {
				const canonical = outputs.filter((output) => output.isCanonicalInstruction);
				const fallback = canonical.length > 0 ? canonical : outputs;
				const selected = fallback[0];
				toWrite.push(selected);
				for (const output of outputs) {
					if (output === selected) {
						continue;
					}
					if (!output.isCanonicalInstruction) {
						this.recordWarning(
							output.targetId,
							`Skipped AGENTS.md collision at ${output.path}; canonical output retained.`,
						);
					}
				}
				continue;
			}

			if (outputs.length > 1) {
				const message = `Output collision detected at ${outputPath}.`;
				this.recordGlobalError(message);
				for (const output of outputs) {
					this.recordError(output.targetId, message);
				}
				continue;
			}

			toWrite.push(outputs[0]);
		}

		for (const output of toWrite) {
			try {
				await this.writeOutput(output);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.recordError(output.targetId, `Failed to write ${output.path}: ${message}`);
			}
		}

		return {
			results: Array.from(this.results.values()),
			warnings: this.globalWarnings,
			errors: this.globalErrors,
		};
	}
}
