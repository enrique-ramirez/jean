import { useCallback, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";
import type { LibraryColumns } from "./libraryColumns";

const written = new WeakMap<object, Map<number, string>>();

const listeners = subscribers();

export function setWrittenRating(
	columns: LibraryColumns,
	ref: number,
	raw: string,
) {
	const overlay = written.get(columns.load) ?? new Map<number, string>();
	written.set(columns.load, overlay);
	overlay.set(ref, raw);
	listeners.notify();
}

export function clearWrittenRating(columns: LibraryColumns, ref: number) {
	if (!written.get(columns.load)?.delete(ref)) return;
	listeners.notify();
}

export const writtenRatingOf = (columns: LibraryColumns, ref: number) =>
	written.get(columns.load)?.get(ref);

export function useWrittenRating(
	columns: LibraryColumns,
	ref: number | undefined,
): string | undefined {
	return useSyncExternalStore(
		listeners.subscribe,
		useCallback(
			() => (ref === undefined ? undefined : writtenRatingOf(columns, ref)),
			[columns, ref],
		),
	);
}
