import { createReadStream } from "node:fs";

const DEFAULT_HIGH_WATER_MARK = 1 << 20;
/** A single line above this is dropped rather than buffered. Real transcripts peak near 3 MB. */
const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export type JsonlCounters = {
	scannedBytes: number;
	oversizedLines: number;
};

export type ReadJsonlOptions = {
	/**
	 * Gate applied to the decoded line before it is yielded. This is where the engine skips
	 * ~99.98% of lines without ever calling JSON.parse, so it must stay cheap.
	 */
	prefilter?: (line: string) => boolean;
	signal?: AbortSignal;
	counters?: JsonlCounters;
	highWaterMark?: number;
	maxLineBytes?: number;
};

export type JsonlLine = {
	text: string;
	/** 0-based ordinal of this line in the file, counting lines the prefilter dropped. */
	index: number;
};

/**
 * Streams a JSONL file line by line without ever holding more than one line in memory.
 *
 * Deliberately hand-rolled rather than using `node:readline`: benchmarked over the real 1.6 GB
 * corpus, manual chunk splitting is ~3.4x faster. Equally deliberate is decoding each line to a
 * string before testing it — a byte-level scan that avoids decoding measured ~2.7x *slower*,
 * because `String.prototype.toLowerCase`/`includes` are SIMD intrinsics and a JS byte loop is not.
 * Please benchmark before "optimizing" either choice.
 */
export async function* readJsonlLines(
	filePath: string,
	options: ReadJsonlOptions = {},
): AsyncGenerator<JsonlLine> {
	const {
		prefilter,
		signal,
		counters,
		highWaterMark = DEFAULT_HIGH_WATER_MARK,
		maxLineBytes = DEFAULT_MAX_LINE_BYTES,
	} = options;

	const stream = createReadStream(filePath, { highWaterMark });
	let remainder = Buffer.alloc(0);
	let index = 0;
	// True while discarding the tail of an over-length line; cleared at the next newline.
	let overflowing = false;

	const take = (buffer: Buffer): JsonlLine | null => {
		const current = index;
		index += 1;
		const end =
			buffer.length > 0 && buffer[buffer.length - 1] === CARRIAGE_RETURN
				? buffer.length - 1
				: buffer.length;
		if (end === 0) {
			return null;
		}
		const text = buffer.toString("utf8", 0, end);
		if (prefilter && !prefilter(text)) {
			return null;
		}
		return { text, index: current };
	};

	try {
		for await (const chunk of stream) {
			if (signal?.aborted) {
				return;
			}
			const buffer = chunk as Buffer;
			if (counters) {
				counters.scannedBytes += buffer.length;
			}

			const data = remainder.length > 0 ? Buffer.concat([remainder, buffer]) : buffer;
			let start = 0;
			for (;;) {
				const newline = data.indexOf(NEWLINE, start);
				if (newline === -1) {
					break;
				}
				if (overflowing) {
					overflowing = false;
					start = newline + 1;
					continue;
				}
				const lineBuffer = data.subarray(start, newline);
				if (lineBuffer.length > maxLineBytes) {
					if (counters) {
						counters.oversizedLines += 1;
					}
					index += 1;
				} else {
					const line = take(lineBuffer);
					if (line) {
						yield line;
					}
				}
				start = newline + 1;
				if (signal?.aborted) {
					return;
				}
			}

			const rest = data.subarray(start);
			if (overflowing) {
				remainder = Buffer.alloc(0);
			} else if (rest.length > maxLineBytes) {
				if (counters) {
					counters.oversizedLines += 1;
				}
				index += 1;
				overflowing = true;
				remainder = Buffer.alloc(0);
			} else {
				remainder = Buffer.from(rest);
			}
		}

		// A file being appended to right now ends mid-record. Yield it anyway and let the caller's
		// JSON.parse fail into the malformed counter — that is EOF, not an error.
		if (!overflowing && remainder.length > 0 && !signal?.aborted) {
			const line = take(remainder);
			if (line) {
				yield line;
			}
		}
	} finally {
		stream.destroy();
	}
}
