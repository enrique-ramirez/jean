import { finished, type Steps } from "@/shared/lib/idle";
import { type LibraryColumns, someFieldMoved } from "./libraryColumns";
import { type TrackRows, trackRows } from "./project";

export function growingIndex<Key, Draft, T>(
	fields: readonly number[],
	absorb: (
		byKey: Map<Key, Draft>,
		rows: TrackRows,
		from: number,
	) => Steps<void>,
	derive: (byKey: Map<Key, Draft>) => T[],
) {
	interface Held {
		key: string;
		columns: LibraryColumns;
		counted: number;
		drafts: Map<Key, Draft>;
		entries: T[];
		absorbing: Steps<void> | null;
		failure: { error: unknown } | null;
	}
	const byColumns = new WeakMap<LibraryColumns, Held>();
	let latest: Held | null = null;

	const fresh = (key: string, columns: LibraryColumns): Held => ({
		key,
		columns,
		counted: 0,
		drafts: new Map<Key, Draft>(),
		entries: [],
		absorbing: null,
		failure: null,
	});

	const isUsable = (held: Held | null | undefined, key: string): held is Held =>
		!!held && held.key === key && held.failure === null;

	const heldFor = (key: string, columns: LibraryColumns): Held => {
		const known = byColumns.get(columns);
		if (isUsable(known, key)) return known;

		const base = latest;
		let next: Held;
		if (!isUsable(base, key)) next = fresh(key, columns);
		else if (
			base.counted === base.columns.trackCount &&
			base.columns.trackCount === columns.trackCount &&
			!someFieldMoved(fields, base.columns, columns)
		)
			next = base;
		else next = fresh(key, columns);

		byColumns.set(columns, next);
		return next;
	};

	function* steps(key: string, columns: LibraryColumns): Steps<T[]> {
		const current = heldFor(key, columns);
		latest = current;

		if (current.counted !== columns.trackCount) {
			current.absorbing ??= absorb(
				current.drafts,
				trackRows(columns),
				current.counted,
			);
			const { absorbing } = current;
			for (;;) {
				if (current.failure) throw current.failure.error;
				let next: IteratorResult<void>;
				try {
					next = absorbing.next();
				} catch (error) {
					current.failure = { error };
					if (latest === current) latest = null;
					throw error;
				}
				if (next.done) break;
				yield;
			}
			if (current.counted !== columns.trackCount) {
				current.absorbing = null;
				current.counted = columns.trackCount;
				current.entries = derive(current.drafts);
			}
		}

		return current.entries;
	}

	return Object.assign(
		(key: string, columns: LibraryColumns): T[] =>
			finished(steps(key, columns)),
		{ steps },
	);
}
