const FRONTMATTER_MARKER = "---";

export function stripFrontmatterFields(contents: string, keysToRemove: Set<string>): string {
	const lines = contents.split(/\r?\n/);
	if (lines[0]?.trim() !== FRONTMATTER_MARKER) {
		return contents;
	}

	let endIndex = -1;
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i].trim() === FRONTMATTER_MARKER) {
			endIndex = i;
			break;
		}
	}

	if (endIndex === -1) {
		return contents;
	}

	const normalizedKeys = new Set(Array.from(keysToRemove).map((key) => key.toLowerCase()));
	const frontmatterLines = lines.slice(1, endIndex);
	const filtered: string[] = [];
	let skippingList = false;

	for (const line of frontmatterLines) {
		const trimmed = line.trim();
		const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);

		if (skippingList) {
			if (match && !normalizedKeys.has(match[1].toLowerCase())) {
				skippingList = false;
			} else if (!match) {
				const shouldSkip = trimmed === "" || trimmed.startsWith("-") || trimmed.startsWith("#");
				if (shouldSkip) {
					continue;
				}
				skippingList = false;
			} else {
				continue;
			}
		}

		if (match) {
			const [, key, rawValue] = match;
			if (normalizedKeys.has(key.toLowerCase())) {
				const rest = rawValue.trim();
				if (!rest || rest.startsWith("#")) {
					skippingList = true;
				}
				continue;
			}
		}

		if (!skippingList) {
			filtered.push(line);
		}
	}

	const eol = contents.includes("\r\n") ? "\r\n" : "\n";
	const outputLines = [lines[0], ...filtered, ...lines.slice(endIndex)];
	return outputLines.join(eol);
}
