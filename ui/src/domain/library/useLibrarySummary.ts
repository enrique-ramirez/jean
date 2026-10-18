import { useSyncExternalStore } from "react";
import { LIBRARY_ROLES } from "@/domain/track/libraryAsker";
import type { LibrarySummary, SummaryRoles } from "@/shared/api/librarySummary";
import { type Subscribers, subscribers } from "@/shared/lib/store";
import type { Library } from "./useLibrary";

const {
	artists: _artists,
	artistIds: _artistIds,
	albumArtists: _albumArtists,
	albumArtistIds: _albumArtistIds,
	...SENT
} = LIBRARY_ROLES;

export const SUMMARY_ROLES: SummaryRoles = SENT;

interface Held {
	summary: LibrarySummary | null;
	listeners: Subscribers;
}

const held = new Map<string, Held>();

const heldFor = (origin: string) => {
	let one = held.get(origin);
	if (!one) {
		one = { summary: null, listeners: subscribers() };
		held.set(origin, one);
	}
	return one;
};

export const summaryOf = (origin: string) => held.get(origin)?.summary ?? null;

export const subscribeSummary = (origin: string, listener: () => void) =>
	heldFor(origin).listeners.subscribe(listener);

export function keepSummary(origin: string, summary: LibrarySummary) {
	const one = heldFor(origin);
	one.summary = summary;
	one.listeners.notify();
}

export const atStructure = (
	summary: LibrarySummary | null,
	structure: number,
) => (summary?.structure === structure ? summary : null);

const NOTHING = () => () => {};

export function useLibrarySummary({ origin }: Pick<Library, "origin">) {
	return useSyncExternalStore(
		origin ? (listener) => subscribeSummary(origin, listener) : NOTHING,
		() => (origin ? summaryOf(origin) : null),
	);
}
