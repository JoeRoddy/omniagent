import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { BaseItem, ConvertContext, ResolvedTargetDefinition } from "./types.js";

function applyTemplate(
	value: string,
	options: {
		repoRoot: string;
		homeDir: string;
		target: ResolvedTargetDefinition;
		item?: BaseItem | null;
	},
): string {
	const replacements: Record<string, string> = {
		repo: options.repoRoot,
		home: options.homeDir,
		target: options.target.id,
		targetId: options.target.id,
		targetName: options.target.displayName,
	};

	if (options.item) {
		replacements.item = options.item.name;
		replacements.itemName = options.item.name;
		replacements.itemType = options.item.itemType;
		replacements.sourcePath = options.item.sourcePath;
	}

	return value.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
		const replacement = replacements[key];
		return replacement !== undefined ? replacement : match;
	});
}

export function createConvertContext(options: {
	repoRoot: string;
	target: ResolvedTargetDefinition;
	flags?: Record<string, unknown>;
	homeDir?: string;
}): ConvertContext {
	const repoRoot = options.repoRoot;
	const homeDir = options.homeDir ?? os.homedir();
	const target = options.target;
	const flags = options.flags ?? {};

	return {
		repo: repoRoot,
		home: homeDir,
		target,
		flags,
		template: (value, templateOptions) =>
			applyTemplate(value, {
				repoRoot,
				homeDir,
				target,
				item: templateOptions?.item ?? null,
			}),
		resolvePath: (value, templateOptions) => {
			const templated = applyTemplate(value, {
				repoRoot,
				homeDir,
				target,
				item: templateOptions?.item ?? null,
			});
			if (!templated.trim()) {
				return "";
			}
			const absolute = path.isAbsolute(templated)
				? templated
				: path.resolve(repoRoot, templated);
			return path.normalize(absolute);
		},
		hash: (value) => createHash("sha256").update(value).digest("hex"),
	};
}
