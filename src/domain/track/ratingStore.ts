import { useCallback, useSyncExternalStore } from "react";

import type { TrackColumns } from "@/shared/api/types";
import { subscribers } from "@/shared/lib/store";

// What a rating write put on a row: beefweb never pushes a tag change, so nothing else will.
// Keyed by the row array itself, so the entry dies with the load it patches and there is no
// invalidation to get wrong.
const written = new WeakMap<TrackColumns, string>();

const listeners = subscribers();

export function setWrittenRating(row: TrackColumns, raw: string) {
	written.set(row, raw);
	listeners.notify();
}

export function clearWrittenRating(row: TrackColumns) {
	if (!written.delete(row)) return;
	listeners.notify();
}

export const writtenRatingOf = (row: TrackColumns) => written.get(row);

export function useWrittenRating(
	row: TrackColumns | undefined,
): string | undefined {
	return useSyncExternalStore(
		listeners.subscribe,
		useCallback(() => (row ? written.get(row) : undefined), [row]),
	);
}
