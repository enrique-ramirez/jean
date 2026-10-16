import {
	decodeJlib,
	type JlibDelta,
	type JlibSpine,
	type JlibSplice,
} from "@/shared/api/jlib";
import { TRACK_EXPRESSIONS } from "./fields";
import type { LibraryColumns } from "./libraryColumns";
import {
	columnsOfSnapshot,
	patchedColumns,
	splicedColumns,
	splicedSpine,
	withLatePart,
} from "./librarySnapshot";
import type { StoredEvent } from "./libraryStore";

export interface ReplayedLibrary {
	columns: LibraryColumns;
	spine: JlibSpine;
	structure: number;
	revision: number;
	snapshotId: string;
}

export function withDelta(
	held: ReplayedLibrary,
	delta: JlibDelta,
): ReplayedLibrary | null {
	const columns = patchedColumns(held.columns, delta, TRACK_EXPRESSIONS);
	if (!columns) return null;
	return {
		...held,
		columns,
		revision: delta.revision,
		snapshotId: delta.snapshotId,
	};
}

export function withSplice(
	held: ReplayedLibrary,
	splice: JlibSplice,
): ReplayedLibrary | null {
	const columns = splicedColumns(held.columns, splice, TRACK_EXPRESSIONS);
	const spine = splicedSpine(held.spine, splice);
	if (!columns || !spine) return null;
	return {
		columns,
		spine,
		structure: splice.structure,
		revision: splice.revision,
		snapshotId: splice.snapshotId,
	};
}

export function replayedLibrary(
	events: readonly StoredEvent[],
): ReplayedLibrary | null {
	try {
		let held = null as ReplayedLibrary | null;

		for (let at = 0; at < events.length; at += 1) {
			const { kind, bytes } = events[at];
			const decoded = decodeJlib(bytes);

			if (kind === "load") {
				if (decoded.kind !== "snapshot") return null;
				held = {
					columns: columnsOfSnapshot(decoded, TRACK_EXPRESSIONS),
					spine: decoded.spine,
					structure: decoded.structure,
					revision: decoded.revision,
					snapshotId: decoded.snapshotId,
				};
				continue;
			}
			if (!held) return null;

			if (kind === "delta") {
				if (decoded.kind !== "delta") return null;
				held = withDelta(held, decoded);
				if (!held) return null;
			} else if (kind === "splice") {
				if (decoded.kind !== "splice") return null;
				held = withSplice(held, decoded);
				if (!held) return null;
			} else if (kind === "part") {
				if (decoded.kind !== "snapshot") return null;
				let part: LibraryColumns | null = columnsOfSnapshot(
					decoded,
					TRACK_EXPRESSIONS,
				);
				while (events[at + 1]?.kind === "partPatch" && part) {
					at += 1;
					const patch = decodeJlib(events[at].bytes);
					part =
						patch.kind === "delta"
							? patchedColumns(part, patch, TRACK_EXPRESSIONS)
							: null;
				}
				const columns: LibraryColumns | null =
					part && withLatePart(held.columns, part);
				if (!columns) return null;
				held = { ...held, columns };
			} else return null;
		}

		return held;
	} catch {
		return null;
	}
}
