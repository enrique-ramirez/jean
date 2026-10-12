import { useCallback, useEffect, useRef, useState } from "react";

const DOUBLE_CLICK_MS = 300;

export function useEditorRows({
	cursor,
	selectedId,
	isFieldOpen,
}: {
	cursor: number | null;
	selectedId: number | null;
	isFieldOpen: () => boolean;
}) {
	const rows = useRef<(HTMLDivElement | null)[]>([]);
	const hasPlaced = useRef(false);

	// A browser drops the focus to the page when the focused element is removed.
	const seen = useRef({ id: selectedId, index: cursor });
	const refocus = useRef(false);
	if (seen.current.id !== selectedId) {
		refocus.current =
			(rows.current[seen.current.index ?? -1]?.contains(
				document.activeElement,
			) ??
				false) &&
			!(document.activeElement instanceof HTMLInputElement);
		seen.current = { id: selectedId, index: cursor };
	}

	const fromPointer = useRef(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new selection fires this, it is not read here
	useEffect(() => {
		const row = rows.current[cursor ?? -1];
		const reveal = () =>
			row?.scrollIntoView({ block: hasPlaced.current ? "nearest" : "center" });
		const wasPointer = fromPointer.current;
		fromPointer.current = false;
		if (refocus.current && !isFieldOpen())
			row?.querySelector("button")?.focus();
		refocus.current = false;
		if (!wasPointer) {
			reveal();
			hasPlaced.current = true;
			return undefined;
		}
		hasPlaced.current = true;
		const timer = setTimeout(reveal, DOUBLE_CLICK_MS);
		return () => clearTimeout(timer);
	}, [selectedId, cursor]);

	const [ghosts, setGhosts] = useState<Record<number, number>>({});
	const dropGhost = useCallback(
		(id: number) =>
			setGhosts((current) => {
				const { [id]: _gone, ...rest } = current;
				return rest;
			}),
		[],
	);

	const pointerChose = useCallback(
		(index: number, chosenId: number | undefined) => {
			const left = seen.current;
			const tools =
				rows.current[left.index ?? -1]?.querySelector<HTMLElement>(
					"[data-tools]",
				);
			if (tools && left.id !== null && index !== left.index) {
				const { id } = left;
				setGhosts((current) => ({ ...current, [id]: tools.offsetHeight }));
			}
			if (chosenId !== undefined) dropGhost(chosenId);
			fromPointer.current = index !== left.index;
		},
		[dropGhost],
	);

	const placeRow = useCallback(
		(index: number, element: HTMLDivElement | null) => {
			rows.current[index] = element;
		},
		[],
	);

	return { ghosts, dropGhost, pointerChose, placeRow };
}
