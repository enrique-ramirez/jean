import { useCallback, useState } from "react";

import { type LyricDraft, sameDraft } from "./lyricDraft";

export interface Selection {
	cursor: number | null;
	isAll: boolean;
}

export interface Moment {
	draft: LyricDraft;
	selection: Selection;
}

interface History {
	now: Moment;
	past: Moment[];
}

export function useLyricDraft(opened: () => Moment) {
	const [history, setHistory] = useState<History>(() => ({
		now: opened(),
		past: [],
	}));

	const change = useCallback((edit: (from: Moment) => Moment | null) => {
		setHistory((held) => {
			const next = edit(held.now);
			if (next === null) return held;
			if (sameDraft(next.draft, held.now.draft)) return { ...held, now: next };
			return { now: next, past: [...held.past, held.now] };
		});
	}, []);

	const select = useCallback((selection: Selection) => {
		setHistory((held) => ({ ...held, now: { ...held.now, selection } }));
	}, []);

	const undo = useCallback(() => {
		setHistory((held) => {
			const back = held.past.at(-1);
			return back ? { now: back, past: held.past.slice(0, -1) } : held;
		});
	}, []);

	return {
		draft: history.now.draft,
		selection: history.now.selection,
		changes: history.past.length,
		change,
		select,
		undo,
	};
}
