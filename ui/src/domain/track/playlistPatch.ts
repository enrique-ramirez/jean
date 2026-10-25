export function moveOrder(
	count: number,
	positions: readonly number[],
	to: number,
): Int32Array | null {
	const moved = [...new Set(positions)].sort((a, b) => a - b);
	if (moved.some((at) => !Number.isInteger(at) || at < 0 || at >= count))
		return null;
	if (!Number.isInteger(to) || to < 0 || to > count - moved.length) return null;

	const isMoved = new Set(moved);
	const rest: number[] = [];
	for (let at = 0; at < count; at += 1) if (!isMoved.has(at)) rest.push(at);
	return Int32Array.from([...rest.slice(0, to), ...moved, ...rest.slice(to)]);
}

export function keptOrder(
	count: number,
	removed: readonly number[],
): Int32Array | null {
	if (removed.some((at) => !Number.isInteger(at) || at < 0 || at >= count))
		return null;

	const isRemoved = new Set(removed);
	const kept: number[] = [];
	for (let at = 0; at < count; at += 1) if (!isRemoved.has(at)) kept.push(at);
	return Int32Array.from(kept);
}
