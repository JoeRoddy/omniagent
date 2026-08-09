import { InvalidFilterError, parseWhen } from "../../../src/lib/history/filters.js";

describe("parseWhen", () => {
	it("rejects calendar dates that roll into another month", () => {
		expect(() => parseWhen("2026-02-31", { flag: "--since" })).toThrow(InvalidFilterError);
		expect(() => parseWhen("2026-13-01", { flag: "--until" })).toThrow(InvalidFilterError);
	});

	it("rejects relative durations outside the Date range", () => {
		expect(() => parseWhen("999999999999999999999d", { flag: "--since" })).toThrow(
			InvalidFilterError,
		);
	});

	it("still accepts a valid leap day", () => {
		const parsed = parseWhen("2028-02-29", { flag: "--since" });

		expect(parsed.getFullYear()).toBe(2028);
		expect(parsed.getMonth()).toBe(1);
		expect(parsed.getDate()).toBe(29);
	});
});
