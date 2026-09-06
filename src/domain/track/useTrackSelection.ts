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

const rangeBetween = (from: number, to: number) => {
	const [start, end] = from <= to ? [from, to] : [to, from];
	return new Set(
		Array.from({ length: end - start + 1 }, (_, at) => start + at),
	);
};

export function useTrackSelection(total: number, viewKey: string) {
	const [cursor, setCursor] = useState(() => cursors.get(viewKey) ?? 0);
	const [selection, setSelection] = useState<Set<number>>(() => new Set());
	const anchor = useRef(0);

	const cursorRef = useRef(cursor);
	cursorRef.current = cursor;

	// Saved on the way out rather than on every move: the cleanup runs with the key it was registered
	// under, so the value cannot land under the new one.
	useEffect(() => () => remember(viewKey, cursorRef.current), [viewKey]);

	useEffect(() => {
		const restored = cursors.get(viewKey) ?? 0;
		anchor.current = restored;
		setCursor(restored);
		setSelection(new Set());
	}, [viewKey]);

	// Clamp only: rows arrive in chunks, so `total` grows several times during a load and resetting
	// here would throw away the cursor on every chunk.
	useEffect(() => {
		setCursor((current) => clamp(current, 0, Math.max(total - 1, 0)));
	}, [total]);

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

	const selectAll = useCallback(
		() =>
			setSelection(new Set(Array.from({ length: total }, (_, index) => index))),
		[total],
	);

	const clear = useCallback(() => setSelection(new Set()), []);

	// Memoised: a fresh object would change identity every render and defeat the memo on every row.
	return useMemo(
		() => ({
			cursor,
			selection,
			selectFromEvent,
			moveCursor,
			moveCursorTo,
			selectAll,
			clear,
		}),
		[
			cursor,
			selection,
			selectFromEvent,
			moveCursor,
			moveCursorTo,
			selectAll,
			clear,
		],
	);
}
