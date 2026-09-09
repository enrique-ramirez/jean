import type { TrackColumns } from "@/shared/api/types";

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
