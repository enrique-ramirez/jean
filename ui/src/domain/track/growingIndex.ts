import type { TrackColumns } from "@/shared/api/types";

/**
 * An index over the whole library, extended in place as it arrives and never cached on its key alone:
 * **the key carries the total count the player reported, so it does not change while rows are still
 * streaming in**. Cached on it and nothing else, an index answers from whatever the first chunk
 * happened to hold and never notices the rest -- an artist the user has half of, or has not reached
 * yet, is simply absent for the session.
 *
 * One library at a time, and nothing is built until something asks, so a session that never searches
 * never builds one.
 */
export function growingIndex<Draft, T>(
	absorb: (
		byKey: Map<string, Draft>,
		rows: TrackColumns[],
		from: number,
	) => void,
	derive: (byKey: Map<string, Draft>) => T[],
) {
	let held: {
		key: string;
		counted: number;
		drafts: Map<string, Draft>;
		entries: T[];
	} | null = null;

	return (key: string, rows: TrackColumns[]): T[] => {
		if (held?.key !== key)
			held = { key, counted: 0, drafts: new Map(), entries: [] };

		if (held.counted !== rows.length) {
			absorb(held.drafts, rows, held.counted);
			held.counted = rows.length;
			held.entries = derive(held.drafts);
		}

		return held.entries;
	};
}
