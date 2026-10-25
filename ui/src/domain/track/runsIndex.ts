import { type AlbumSpan, discsOf } from "./grouping";
import type { TrackRows } from "./project";

const startsHeld = new WeakMap<ArrayLike<number>, Int32Array>();

export function runStartsOf(lengths: ArrayLike<number>): Int32Array {
	const held = startsHeld.get(lengths);
	if (held) return held;

	const starts = new Int32Array(lengths.length);
	let next = 0;
	for (let run = 0; run < lengths.length; run += 1) {
		starts[run] = next;
		next += lengths[run];
	}
	startsHeld.set(lengths, starts);
	return starts;
}

export function runIndexAt(starts: Int32Array, position: number): number {
	if (starts.length === 0) return -1;

	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (starts[middle] <= position) low = middle;
		else high = middle - 1;
	}
	return low;
}

interface RunLengths {
	lengths: ArrayLike<number>;
	covers?: ArrayLike<number>;
}

export function hasDiscsInSight(
	runs: RunLengths,
	rows: TrackRows,
	first: number,
	end: number,
): boolean {
	const starts = runStartsOf(runs.lengths);
	const last = Math.min(end, rows.length);
	for (
		let run = Math.max(0, runIndexAt(starts, first));
		run >= 0 && run < starts.length && starts[run] < last;
		run += 1
	) {
		const group: AlbumSpan = {
			kind: "span",
			key: "",
			start: starts[run],
			count: runs.lengths[run],
			cover: runs.covers?.[run] ?? starts[run],
		};
		if (discsOf(group, rows) !== null) return true;
	}
	return false;
}
