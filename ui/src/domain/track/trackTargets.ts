export function targetsFrom(
	event: { target: EventTarget | null },
	length: number,
	selection: Set<number>,
): { index: number; positions: number[] } | null {
	const element = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(
		"[data-row]",
	);
	if (!element) return null;

	const index = Number(element.dataset.row);
	if (!Number.isInteger(index) || index < 0 || index >= length) return null;

	const positions =
		selection.has(index) && selection.size > 1
			? [...selection].sort((a, b) => a - b)
			: [index];

	return { index, positions };
}
