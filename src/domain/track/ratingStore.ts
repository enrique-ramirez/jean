import { useCallback, useSyncExternalStore } from "react";

import type { TrackColumns } from "@/shared/api/types";
import { subscribers } from "@/shared/lib/store";

// What a rating write put on a row, until a fresher load replaces it. beefweb
// never pushes a tag change, so nothing else will.
//
// Keyed by the row array itself, so the entry dies with the load it patches and
// there is no invalidation to get wrong.
const written = new WeakMap<TrackColumns, string>();

const listeners = subscribers();

// The raw tag value as sent, so an optimistic row reads through exactly the same
// path as one off the player. `''` is a cleared rating, not a zero.
export function setWrittenRating(row: TrackColumns, raw: string) {
	written.set(row, raw);
	listeners.notify();
}

// Only for rolling back a refused write. A write that timed out keeps its value:
// the player may still be finishing it.
export function clearWrittenRating(row: TrackColumns) {
	if (!written.delete(row)) return;
	listeners.notify();
}

// The same value the hook below reports, for a caller outside React.
export const writtenRatingOf = (row: TrackColumns) => written.get(row);

// `undefined` means the row's own value stands. A primitive snapshot, so only the
// row that changed re-renders.
export function useWrittenRating(
	row: TrackColumns | undefined,
): string | undefined {
	return useSyncExternalStore(
		listeners.subscribe,
		useCallback(() => (row ? written.get(row) : undefined), [row]),
	);
}
