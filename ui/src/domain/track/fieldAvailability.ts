import { useSyncExternalStore } from "react";

import { subscribers } from "@/shared/lib/store";
import { FIELD, resolvesAnywhere } from "./fields";
import type { LibraryColumns } from "./libraryColumns";

export interface FieldAvailability {
	isAvailable: (field: number) => boolean;
	hasPlayCounts: boolean;
}

const NOTHING_RULED_OUT = ~0;

const NEVER_HIDDEN = 1 << FIELD.rating;

const answerFor = (resolved: number): FieldAvailability => ({
	isAvailable: (field) => (resolved & (1 << field)) !== 0,
	hasPlayCounts: (resolved & (1 << FIELD.playCount)) !== 0,
});

const listeners = subscribers();

let resolved = NOTHING_RULED_OUT;
let answer = answerFor(resolved);

export function recordFieldAvailability(columns: LibraryColumns) {
	const next = Object.values(FIELD).reduce(
		(mask, field) =>
			resolvesAnywhere(columns, field) ? mask | (1 << field) : mask,
		NEVER_HIDDEN,
	);
	if (next === resolved) return;

	resolved = next;
	answer = answerFor(next);
	listeners.notify();
}

export const useAvailableFields = () =>
	useSyncExternalStore(listeners.subscribe, () => answer);
