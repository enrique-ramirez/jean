import { type LibraryColumns, someFieldMoved } from "./libraryColumns";
import { type TrackRows, trackRows } from "./project";

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
export function growingIndex<Key, Draft, T>(
	fields: readonly number[],
	absorb: (byKey: Map<Key, Draft>, rows: TrackRows, from: number) => void,
	derive: (byKey: Map<Key, Draft>) => T[],
) {
	let held: {
		key: string;
		columns: LibraryColumns;
		counted: number;
		drafts: Map<Key, Draft>;
		entries: T[];
	} | null = null;

	return (key: string, columns: LibraryColumns): T[] => {
		if (held?.key !== key || someFieldMoved(fields, held.columns, columns))
			held = { key, columns, counted: 0, drafts: new Map(), entries: [] };

		if (held.counted !== columns.trackCount) {
			absorb(held.drafts, trackRows(columns), held.counted);
			held.counted = columns.trackCount;
			held.entries = derive(held.drafts);
		}

		held.columns = columns;
		return held.entries;
	};
}
