// The arithmetic of a drag, shared by both drag primitives: where the rows of a list being
// reordered sit while the gesture is in flight, and how fast a container under the pointer scrolls.
// Pure -- the pointer, the elements and the state belong to whoever calls this.

/** Where a row sat when the drag began, in viewport coordinates. */
export interface RowBox {
	top: number;
	height: number;
}

/** The row that was picked up, the slot it is over, and how far it has travelled from its own top. */
export interface Reorder {
	tops: RowBox[];
	from: number;
	to: number;
	offset: number;
}

const centreOf = (tops: RowBox[], index: number) =>
	tops[index].top + tops[index].height / 2;

// Compared against each resting row's midpoint, so the swap happens when they visually cross rather than when they merely touch.
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

// Going down, the row lands against the target row's bottom: with uneven heights the tops do not line up.
export function landingOffset({
	tops,
	from,
	to,
}: Pick<Reorder, "tops" | "from" | "to">): number {
	if (to > from)
		return tops[to].top + tops[to].height - tops[from].height - tops[from].top;
	return tops[to].top - tops[from].top;
}

// The dragged row follows the pointer; every row between its start and its landing slides into the slot the one next to it just left.
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

// One ramp for every drag, held here rather than passed in: nothing distinguishes the gestures, and
// a parameter is an invitation to a third pair of numbers.
const ZONE_PX = 56;
const MAX_STEP_PX = 14;

// How fast a container scrolls while the pointer rests near one of its edges: nothing through the
// middle, ramping to full speed at the edge itself. Positive is downwards, so a caller adds it to
// `scrollTop`. The top wins where a container is shorter than two zones.
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
