import type { Refs } from "./project";

export function meet(matched: Refs, set: Refs | null): Int32Array {
	if (set === null)
		return matched instanceof Int32Array ? matched : Int32Array.from(matched);

	let top = -1;
	for (const ordinal of matched) if (ordinal > top) top = ordinal;
	const isMatched = new Uint8Array(top + 1);
	for (const ordinal of matched) isMatched[ordinal] = 1;

	const positions = new Int32Array(set.length);
	let count = 0;
	for (let position = 0; position < set.length; position += 1)
		if (isMatched[set[position]] === 1) {
			positions[count] = position;
			count += 1;
		}
	return positions.slice(0, count);
}

export function isMatch(
	positions: Int32Array | null | undefined,
	position: number,
) {
	if (!positions) return false;

	let low = 0;
	let high = positions.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const at = positions[middle];
		if (at === position) return true;
		if (at < position) low = middle + 1;
		else high = middle - 1;
	}
	return false;
}
