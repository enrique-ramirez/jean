import type { TrackColumns } from "@/shared/api/types";

// Which rows an action applies to, given where the pointer went down.
//
// The file-manager rule, shared by the context menu and by dragging because they
// must never disagree. Rows are found through the DOM rather than per-row
// handlers: the list is virtualised and its rows must not each carry a closure.
export function targetsFrom(
	event: { target: EventTarget | null },
	rows: TrackColumns[],
	selection: Set<number>,
): { index: number; positions: number[] } | null {
	const element = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(
		"[data-row]",
	);
	if (!element) return null;

	const index = Number(element.dataset.row);
	if (!Number.isInteger(index) || !rows[index]) return null;

	const positions =
		selection.has(index) && selection.size > 1
			? [...selection].sort((a, b) => a - b)
			: [index];

	return { index, positions };
}
