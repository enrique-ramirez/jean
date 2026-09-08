export interface RowBox {
	top: number;
	height: number;
}

export interface Reorder {
	tops: RowBox[];
	from: number;
	to: number;
	offset: number;
}

const centreOf = (tops: RowBox[], index: number) =>
	tops[index].top + tops[index].height / 2;

export function targetFor(
	{ tops, from }: Pick<Reorder, "tops" | "from">,
	offset: number,
): number {
	const centre = tops[from].top + offset + tops[from].height / 2;

	const above = tops.findIndex(
		(_, index) => index < from && centre < centreOf(tops, index),
	);
	if (above >= 0) return above;

	return tops.reduce(
		(target, _, index) =>
			index > from && centre > centreOf(tops, index) ? index : target,
		from,
	);
}

// Going down, the row lands against the target's bottom edge: with uneven heights the tops do not
// line up and the two branches cannot be collapsed.
export function landingOffset({
	tops,
	from,
	to,
}: Pick<Reorder, "tops" | "from" | "to">): number {
	if (to > from)
		return tops[to].top + tops[to].height - tops[from].height - tops[from].top;
	return tops[to].top - tops[from].top;
}

export function offsetFor(
	{ tops, from, to, offset }: Reorder,
	index: number,
): number {
	if (index === from) return offset;
	if (from < to && index > from && index <= to)
		return tops[index - 1].top - tops[index].top;
	if (from > to && index >= to && index < from)
		return tops[index + 1].top - tops[index].top;
	return 0;
}

const ZONE_PX = 56;
const MAX_STEP_PX = 14;

export function autoscrollStep(
	{ top, bottom }: { top: number; bottom: number },
	y: number,
): number {
	const above = y - top;
	const below = bottom - y;
	if (above < ZONE_PX) return -MAX_STEP_PX * (1 - above / ZONE_PX);
	if (below < ZONE_PX) return MAX_STEP_PX * (1 - below / ZONE_PX);
	return 0;
}
