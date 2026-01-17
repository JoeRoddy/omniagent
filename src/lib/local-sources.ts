import path from "node:path";

export type LocalCategory = "skills" | "commands" | "agents" | "instructions";
export type SourceType = "shared" | "local";
export type LocalMarkerType = "path" | "suffix";

export type SourceMetadata = {
	sourceType: SourceType;
	markerType?: LocalMarkerType;
	isLocalFallback: boolean;
};

const LOCAL_DIRNAME = ".local";
const LOCAL_SUFFIX = ".local";

export function resolveSharedCategoryRoot(repoRoot: string, category: LocalCategory): string {
	if (category === "instructions") {
		return path.join(repoRoot, "agents");
	}
	return path.join(repoRoot, "agents", category);
}

export function resolveLocalCategoryRoot(repoRoot: string, category: LocalCategory): string {
	if (category === "instructions") {
		return path.join(repoRoot, "agents", LOCAL_DIRNAME);
	}
	return path.join(repoRoot, "agents", LOCAL_DIRNAME, category);
}

export function buildSourceMetadata(sourceType: "shared", markerType?: undefined): SourceMetadata;
export function buildSourceMetadata(
	sourceType: "local",
	markerType: LocalMarkerType,
): SourceMetadata;
export function buildSourceMetadata(
	sourceType: SourceType,
	markerType?: LocalMarkerType,
): SourceMetadata {
	if (sourceType === "local") {
		if (!markerType) {
			throw new Error("Local sources must include a marker type.");
		}
		return {
			sourceType,
			markerType,
			isLocalFallback: markerType === "suffix",
		};
	}
	return {
		sourceType,
		isLocalFallback: false,
	};
}

export function stripLocalSuffix(
	fileName: string,
	extension: string,
): {
	baseName: string;
	outputFileName: string;
	hadLocalSuffix: boolean;
} {
	const nameLower = fileName.toLowerCase();
	const extensionLower = extension.toLowerCase();
	if (!nameLower.endsWith(extensionLower)) {
		return { baseName: fileName, outputFileName: fileName, hadLocalSuffix: false };
	}

	const extensionStart = fileName.length - extension.length;
	const rawBase = fileName.slice(0, extensionStart);
	if (rawBase.toLowerCase().endsWith(LOCAL_SUFFIX)) {
		const trimmedBase = rawBase.slice(0, -LOCAL_SUFFIX.length);
		const extensionSuffix = fileName.slice(extensionStart);
		return {
			baseName: trimmedBase,
			outputFileName: `${trimmedBase}${extensionSuffix}`,
			hadLocalSuffix: true,
		};
	}

	return {
		baseName: rawBase,
		outputFileName: fileName,
		hadLocalSuffix: false,
	};
}

export function stripLocalPathSuffix(pathName: string): {
	baseName: string;
	hadLocalSuffix: boolean;
} {
	const nameLower = pathName.toLowerCase();
	if (!nameLower.endsWith(LOCAL_SUFFIX)) {
		return { baseName: pathName, hadLocalSuffix: false };
	}
	return {
		baseName: pathName.slice(0, -LOCAL_SUFFIX.length),
		hadLocalSuffix: true,
	};
}

export function isLocalSuffixFile(fileName: string, extension: string): boolean {
	return stripLocalSuffix(fileName, extension).hadLocalSuffix;
}
