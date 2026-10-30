export interface RoveOptions {
	wrap?: boolean;
	columns?: number;
	horizontal?: boolean;
	ends?: boolean;
}

function stepOf(key: string, columns: number, horizontal: boolean) {
	switch (key) {
		case "ArrowDown":
			return columns;
		case "ArrowUp":
			return -columns;
		case "ArrowRight":
			return horizontal ? 1 : 0;
		case "ArrowLeft":
			return horizontal ? -1 : 0;
		default:
			return 0;
	}
}

export function rovedIndex(
	key: string,
	at: number,
	count: number,
	{
		wrap = false,
		columns = 1,
		horizontal = false,
		ends = false,
	}: RoveOptions = {},
): number | null {
	if (count === 0) return null;
	if (ends && key === "Home") return 0;
	if (ends && key === "End") return count - 1;

	const step = stepOf(key, columns, horizontal);
	if (step === 0) return null;
	if (at < 0) return step > 0 ? 0 : count - 1;

	const next = at + step;
	return wrap ? (next + count) % count : Math.min(Math.max(next, 0), count - 1);
}

export function steppedOption(active: number, by: number, count: number) {
	const next = active + by;
	return next < -1 ? count - 1 : next >= count ? -1 : next;
}
