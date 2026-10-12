import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clamp } from "@/shared/lib/math";

type SelectionModifiers = Pick<MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">;

// Bounded: a live search mints a new view key on every keystroke.
const MAX_REMEMBERED = 50;
const cursors = new Map<string, number>();

function remember(key: string | null | undefined, cursor: number) {
	if (!key) return;
	cursors.set(key, cursor);
	if (cursors.size > MAX_REMEMBERED)
		cursors.delete(cursors.keys().next().value as string);
}

const rememberedCursor = (key: string) => cursors.get(key) ?? 0;

const rangeBetween = (from: number, to: number) => {
	const [start, end] = from <= to ? [from, to] : [to, from];
	return new Set(
		Array.from({ length: end - start + 1 }, (_, at) => start + at),
	);
};

export function useTrackSelection(total: number, viewKey: string) {
	const [shownKey, setShownKey] = useState(viewKey);
	const [cursor, setCursor] = useState(() => rememberedCursor(viewKey));
	const [selection, setSelection] = useState<Set<number>>(() => new Set());
	const anchor = useRef(0);
	const lastRow = Math.max(total - 1, 0);

	if (shownKey !== viewKey) {
		setShownKey(viewKey);
		setCursor(rememberedCursor(viewKey));
		setSelection(new Set());
	} else if (cursor > lastRow) {
		setCursor(lastRow);
	}

	useEffect(() => remember(viewKey, cursor), [viewKey, cursor]);

	useEffect(() => {
		anchor.current = rememberedCursor(viewKey);
	}, [viewKey]);

	const moveCursorTo = useCallback(
		(index: number) => {
			const next = clamp(index, 0, Math.max(total - 1, 0));
			anchor.current = next;
			setCursor(next);
			setSelection(new Set([next]));
		},
		[total],
	);

	const selectFromEvent = useCallback(
		(index: number, event: SelectionModifiers) => {
			if (event.shiftKey) {
				setSelection(rangeBetween(anchor.current, index));
				setCursor(index);
				return;
			}

			anchor.current = index;
			setCursor(index);

			if (event.metaKey || event.ctrlKey) {
				setSelection((current) => {
					const next = new Set(current);
					if (!next.delete(index)) next.add(index);
					return next;
				});
			} else {
				setSelection(new Set([index]));
			}
		},
		[],
	);

	const moveCursor = useCallback(
		(delta: number, { extend = false }: { extend?: boolean } = {}) => {
			setCursor((current) => {
				const next = clamp(current + delta, 0, Math.max(total - 1, 0));
				if (extend) {
					setSelection(rangeBetween(anchor.current, next));
				} else {
					anchor.current = next;
					setSelection(new Set([next]));
				}
				return next;
			});
		},
		[total],
	);

	const selectBlock = useCallback(
		(first: number, last: number, cursorAt: number) => {
			anchor.current = first;
			setCursor(cursorAt);
			setSelection(rangeBetween(first, last));
		},
		[],
	);

	const selectAll = useCallback(
		() =>
			setSelection(new Set(Array.from({ length: total }, (_, index) => index))),
		[total],
	);

	const clear = useCallback(() => setSelection(new Set()), []);

	return useMemo(
		() => ({
			cursor,
			selection,
			selectFromEvent,
			moveCursor,
			moveCursorTo,
			selectBlock,
			selectAll,
			clear,
		}),
		[
			cursor,
			selection,
			selectFromEvent,
			moveCursor,
			moveCursorTo,
			selectBlock,
			selectAll,
			clear,
		],
	);
}
