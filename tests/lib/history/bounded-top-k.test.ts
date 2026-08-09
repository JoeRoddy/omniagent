import { BoundedTopK } from "../../../src/lib/history/bounded-top-k.js";

describe("BoundedTopK", () => {
	it("retains only the best values and reports every capacity discard", () => {
		const values = new BoundedTopK<number>(3, (a, b) => a - b);

		expect(values.offer(5)).toEqual({ retained: true, discarded: false });
		expect(values.offer(1)).toEqual({ retained: true, discarded: false });
		expect(values.offer(3)).toEqual({ retained: true, discarded: false });
		expect(values.offer(7)).toEqual({ retained: false, discarded: true });
		expect(values.offer(2)).toEqual({ retained: true, discarded: true });
		expect(values.offer(3)).toEqual({ retained: false, discarded: true });

		expect(values.size).toBe(3);
		expect(values.toSortedArray()).toEqual([1, 2, 3]);
	});

	it("rejects invalid capacities", () => {
		expect(() => new BoundedTopK(0, (a: number, b: number) => a - b)).toThrow(RangeError);
		expect(() => new BoundedTopK(1.5, (a: number, b: number) => a - b)).toThrow(RangeError);
	});

	it("scales by heap depth instead of repeatedly sorting the retained set", () => {
		let comparisons = 0;
		const values = new BoundedTopK<number>(10_000, (a, b) => {
			comparisons += 1;
			return a - b;
		});

		for (let value = 20_000; value > 0; value -= 1) {
			values.offer(value);
		}
		const retained = values.toSortedArray();

		expect(retained).toHaveLength(10_000);
		expect(retained[0]).toBe(1);
		expect(retained.at(-1)).toBe(10_000);
		expect(comparisons).toBeLessThan(1_000_000);
	});
});
