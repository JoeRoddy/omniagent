import {
	buildSourceMetadata,
	isLocalSuffixFile,
	stripLocalPathSuffix,
	stripLocalSuffix,
} from "../../src/lib/local-sources.js";

describe("local source helpers", () => {
	it("strips .local suffix and preserves extension", () => {
		const result = stripLocalSuffix("SKILL.local.md", ".md");

		expect(result).toEqual({
			baseName: "SKILL",
			outputFileName: "SKILL.md",
			hadLocalSuffix: true,
		});
	});

	it("detects local suffix files case-insensitively", () => {
		expect(isLocalSuffixFile("deploy.LOCAL.md", ".md")).toBe(true);
		expect(isLocalSuffixFile("deploy.md", ".md")).toBe(false);
	});

	it("strips .local suffix from path segments", () => {
		expect(stripLocalPathSuffix("review-helper.local")).toEqual({
			baseName: "review-helper",
			hadLocalSuffix: true,
		});
		expect(stripLocalPathSuffix("review-helper")).toEqual({
			baseName: "review-helper",
			hadLocalSuffix: false,
		});
	});

	it("builds metadata for shared and local sources", () => {
		const shared = buildSourceMetadata("shared");
		const localPath = buildSourceMetadata("local", "path");
		const localSuffix = buildSourceMetadata("local", "suffix");

		expect(shared).toEqual({ sourceType: "shared", isLocalFallback: false });
		expect(localPath).toEqual({
			sourceType: "local",
			markerType: "path",
			isLocalFallback: false,
		});
		expect(localSuffix).toEqual({
			sourceType: "local",
			markerType: "suffix",
			isLocalFallback: true,
		});
	});

	it("throws when local metadata is missing a marker", () => {
		const unsafeBuild = buildSourceMetadata as (
			sourceType: "local",
			markerType?: "path" | "suffix",
		) => ReturnType<typeof buildSourceMetadata>;
		expect(() => unsafeBuild("local")).toThrow("Local sources must include a marker type.");
	});
});
