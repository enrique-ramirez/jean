export type Sweep<T> = Generator<void, T, void>;

export type SweepResult<S> = S extends Sweep<infer T> ? T : never;

export const CHUNK = 10_000;

export const runToEnd = <T>(sweep: Sweep<T>): T => {
	for (;;) {
		const step = sweep.next();
		if (step.done) return step.value;
	}
};

// Node runs an immediate once the I/O waiting on the loop has had its turn, which a timer does not
// promise; a page, where the demo runs this, has only timers.
const turn = () =>
	new Promise<void>((resume) => {
		const immediate = (
			globalThis as { setImmediate?: (callback: () => void) => unknown }
		).setImmediate;
		if (immediate) immediate(resume);
		else setTimeout(resume, 0);
	});

export async function runYielding<T>(
	sweep: Sweep<T>,
	isAbandoned: () => boolean = () => false,
): Promise<T> {
	for (;;) {
		const step = sweep.next();
		if (step.done) return step.value;
		await turn();
		if (isAbandoned()) await new Promise<never>(() => undefined);
	}
}

export function* mapped<T, U>(
	items: readonly T[],
	each: (item: T, at: number) => U,
): Sweep<U[]> {
	const made = new Array<U>(items.length);
	for (let at = 0; at < items.length; at += 1) {
		made[at] = each(items[at], at);
		if (at % CHUNK === CHUNK - 1) yield;
	}
	return made;
}

export function* sorted<T>(
	items: readonly T[],
	compare: (a: T, b: T) => number,
): Sweep<T[]> {
	if (items.length <= CHUNK) return items.slice().sort(compare);

	let runs: T[][] = [];
	for (let from = 0; from < items.length; from += CHUNK) {
		runs.push(items.slice(from, from + CHUNK).sort(compare));
		yield;
	}

	while (runs.length > 1) {
		const merged: T[][] = [];
		for (let at = 0; at < runs.length; at += 2) {
			if (at + 1 === runs.length) {
				merged.push(runs[at]);
				continue;
			}
			const left = runs[at];
			const right = runs[at + 1];
			const out = new Array<T>(left.length + right.length);
			let l = 0;
			let r = 0;
			let o = 0;
			while (l < left.length && r < right.length) {
				out[o++] = compare(right[r], left[l]) < 0 ? right[r++] : left[l++];
				if (o % CHUNK === 0) yield;
			}
			while (l < left.length) out[o++] = left[l++];
			while (r < right.length) out[o++] = right[r++];
			merged.push(out);
			yield;
		}
		runs = merged;
	}
	return runs[0] ?? [];
}
