import { useCallback, useRef, useState } from "react";

import { setLineText } from "./lyricDraft";
import type { Moment } from "./useLyricDraft";

export interface LineField {
	index: number;
	value: string;
}

export function useLineField(
	change: (edit: (from: Moment) => Moment | null) => void,
) {
	const [field, setFieldState] = useState<LineField | null>(null);
	const fieldRef = useRef<LineField | null>(null);

	const setField = useCallback((next: LineField | null) => {
		fieldRef.current = next;
		setFieldState(next);
	}, []);

	const isOpen = useCallback(() => fieldRef.current !== null, []);

	const open = useCallback(
		(index: number, value: string) => setField({ index, value }),
		[setField],
	);

	const type = useCallback(
		(value: string) => {
			if (fieldRef.current) setField({ ...fieldRef.current, value });
		},
		[setField],
	);

	const close = useCallback(() => setField(null), [setField]);

	const commit = useCallback(() => {
		const held = fieldRef.current;
		if (!held) return;
		setField(null);
		change((from) => {
			const line = from.draft.lines[held.index];
			if (!line || line.text === held.value) return null;
			return {
				draft: setLineText(from.draft, held.index, held.value),
				selection: from.selection,
			};
		});
	}, [change, setField]);

	return { field, isOpen, open, type, close, commit };
}
