import { useSyncExternalStore } from "react";

import {
	readStoredState,
	writeStoredState,
} from "@/shared/hooks/useStoredState";
import { subscribers } from "@/shared/lib/store";
import { FIELD, resolvesAnywhere, TRACK_EXPRESSIONS } from "./fields";
import type { LibraryColumns } from "./libraryColumns";

export interface FieldAvailability {
	isAvailable: (field: number) => boolean;
	hasPlayCounts: boolean;
}

const STORAGE_KEY = "jean.fieldAvailability";

const NOTHING_RULED_OUT = ~0;

const NEVER_HIDDEN = 1 << FIELD.rating;

const answerFor = (resolved: number): FieldAvailability => ({
	isAvailable: (field) => (resolved & (1 << field)) !== 0,
	hasPlayCounts: (resolved & (1 << FIELD.playCount)) !== 0,
});

const listeners = subscribers();

const fieldByExpression = new Map(
	TRACK_EXPRESSIONS.map((expression, field) => [expression, field]),
);

const maskFromStoredNames = (names: unknown): number =>
	Array.isArray(names)
		? names.reduce((mask: number, name) => {
				const field = fieldByExpression.get(name as string);
				return field === undefined ? mask : mask | (1 << field);
			}, NEVER_HIDDEN)
		: NOTHING_RULED_OUT;

const storedNamesFor = (mask: number): string[] =>
	Object.values(FIELD)
		.filter((field) => (mask & (1 << field)) !== 0)
		.map((field) => TRACK_EXPRESSIONS[field]);

let resolved = maskFromStoredNames(readStoredState<unknown>(STORAGE_KEY, null));
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
	writeStoredState(STORAGE_KEY, storedNamesFor(next));
	listeners.notify();
}

export const useAvailableFields = () =>
	useSyncExternalStore(listeners.subscribe, () => answer);
