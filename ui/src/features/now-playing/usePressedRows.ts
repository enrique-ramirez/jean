import { useCallback, useMemo, useState } from "react";

import type { ListedSession } from "@/domain/player/sessionList";

interface EndedAt {
	session: ListedSession;
	index: number;
}

interface DrawnSession {
	session: ListedSession;
	hasEnded: boolean;
	isRefused: boolean;
}

const NONE_ENDED: ReadonlyMap<string, EndedAt> = new Map();
const NONE_REFUSED: ReadonlySet<string> = new Set();

function withEndedByIndex(
	ended: ReadonlyMap<string, EndedAt>,
	session: ListedSession,
	index: number,
): ReadonlyMap<string, EndedAt> {
	const next = new Map(ended);
	next.set(session.document.id, { session, index });
	return new Map([...next].sort(([, a], [, b]) => a.index - b.index));
}

export function usePressedRows(listed: readonly ListedSession[]) {
	const [ended, setEnded] = useState(NONE_ENDED);
	const [refused, setRefused] = useState(NONE_REFUSED);
	const markEnded = useCallback(
		(session: ListedSession, index: number) =>
			setEnded((held) => withEndedByIndex(held, session, index)),
		[],
	);
	const markRefused = useCallback(
		(session: ListedSession, isRefused: boolean) =>
			setRefused((held) => {
				const { id } = session.document;
				if (held.has(id) === isRefused) return held;
				const next = new Set(held);
				if (isRefused) next.add(id);
				else next.delete(id);
				return next;
			}),
		[],
	);
	const rows = useMemo(() => {
		const drawn: DrawnSession[] = listed
			.filter((session) => !ended.has(session.document.id))
			.map((session) => ({
				session,
				hasEnded: false,
				isRefused: refused.has(session.document.id),
			}));
		for (const { session, index } of ended.values())
			drawn.splice(index, 0, { session, hasEnded: true, isRefused: false });
		return drawn;
	}, [listed, ended, refused]);
	return { rows, markEnded, markRefused };
}
