import { useCallback, useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";
import type { LibraryColumns } from "./libraryColumns";
import { landingOf } from "./project";

interface Written {
	raw: string;
	landed: object | null;
	isSettled: boolean;
}

const written = new WeakMap<object, Map<number, Written>>();

const listeners = subscribers();

export function setWrittenRating(
	columns: LibraryColumns,
	ref: number,
	raw: string,
	isSettled: boolean,
) {
	const overlay = written.get(columns.load) ?? new Map<number, Written>();
	written.set(columns.load, overlay);
	overlay.set(ref, {
		raw,
		landed: isSettled ? landingOf(columns, ref) : null,
		isSettled,
	});
	listeners.notify();
}

export function clearWrittenRating(columns: LibraryColumns, ref: number) {
	if (!written.get(columns.load)?.delete(ref)) return;
	listeners.notify();
}

export const writtenRatingOf = (columns: LibraryColumns, ref: number) => {
	const overlay = written.get(columns.load);
	const entry = overlay?.get(ref);
	if (!entry) return undefined;
	if (!entry.isSettled) return entry.raw;
	const now = landingOf(columns, ref);
	if (now === null) return entry.raw;
	if (entry.landed === null) entry.landed = now;
	if (now === entry.landed) return entry.raw;
	overlay?.delete(ref);
	return undefined;
};

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
