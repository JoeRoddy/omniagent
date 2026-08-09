export type BoundedTopKOffer = {
	retained: boolean;
	discarded: boolean;
};

/**
 * Retains the best values according to an Array.sort-style comparator. The least-preferred
 * retained value stays at the root so each new candidate costs O(log capacity) at worst.
 */
export class BoundedTopK<T> {
	readonly capacity: number;
	readonly #compare: (a: T, b: T) => number;
	readonly #items: T[] = [];

	constructor(capacity: number, compare: (a: T, b: T) => number) {
		if (!Number.isInteger(capacity) || capacity <= 0) {
			throw new RangeError("BoundedTopK capacity must be a positive integer.");
		}
		this.capacity = capacity;
		this.#compare = compare;
	}

	get size(): number {
		return this.#items.length;
	}

	offer(value: T): BoundedTopKOffer {
		if (this.#items.length < this.capacity) {
			this.#items.push(value);
			this.#siftUp(this.#items.length - 1);
			return { retained: true, discarded: false };
		}

		const worst = this.#items[0] as T;
		if (this.#compare(value, worst) >= 0) {
			return { retained: false, discarded: true };
		}

		this.#items[0] = value;
		this.#siftDown(0);
		return { retained: true, discarded: true };
	}

	toSortedArray(): T[] {
		return [...this.#items].sort(this.#compare);
	}

	#siftUp(start: number): void {
		let index = start;
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (this.#compare(this.#items[index] as T, this.#items[parent] as T) <= 0) {
				return;
			}
			this.#swap(index, parent);
			index = parent;
		}
	}

	#siftDown(start: number): void {
		let index = start;
		for (;;) {
			const left = index * 2 + 1;
			if (left >= this.#items.length) {
				return;
			}

			const right = left + 1;
			let worse = left;
			if (
				right < this.#items.length &&
				this.#compare(this.#items[right] as T, this.#items[left] as T) > 0
			) {
				worse = right;
			}

			if (this.#compare(this.#items[worse] as T, this.#items[index] as T) <= 0) {
				return;
			}
			this.#swap(index, worse);
			index = worse;
		}
	}

	#swap(left: number, right: number): void {
		[this.#items[left], this.#items[right]] = [this.#items[right] as T, this.#items[left] as T];
	}
}
