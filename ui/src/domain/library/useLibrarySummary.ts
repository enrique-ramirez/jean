import { useCallback, useEffect, useSyncExternalStore } from "react";
import { LIBRARY_ROLES } from "@/domain/track/libraryAsker";
import {
	announcedLibraryOf,
	declaredAgain,
	holdAfterResult,
	holdsDeclaration,
	isDue,
	isWaitingOnTime,
	reportedReady,
	type Waiting,
	watchLibrary,
} from "@/domain/track/libraryHolds";
import {
	fetchLibrarySummary,
	type LibrarySummary,
	type SummaryRoles,
} from "@/shared/api/librarySummary";
import { readFailed } from "@/shared/api/readFailure";
import type { StateDocument } from "@/shared/api/state";
import { type Subscribers, subscribers } from "@/shared/lib/store";
import type { Library } from "./useLibrary";

const {
	artists: _artists,
	artistIds: _artistIds,
	albumArtists: _albumArtists,
	albumArtistIds: _albumArtistIds,
	artistSort: _artistSort,
	...SENT
} = LIBRARY_ROLES;

export const SUMMARY_ROLES: SummaryRoles = SENT;

interface Held extends Waiting {
	origin: string;
	withGenres: boolean;
	summary: LibrarySummary | null;
	tag: string | null;
	listeners: Subscribers;
	controller: AbortController | null;
	askers: number;
	detach: (() => void) | null;
}

const held = new Map<string, Held>();

const heldFor = (origin: string, withGenres = false) => {
	const key = `${origin}\n${withGenres}`;
	let one = held.get(key);
	if (!one) {
		one = {
			origin,
			withGenres,
			summary: null,
			tag: null,
			listeners: subscribers(),
			controller: null,
			askers: 0,
			detach: null,
			pair: null,
			hold: { kind: "none" },
			announced: null,
		};
		held.set(key, one);
	}
	return one;
};

export const summaryOf = (origin: string, withGenres = false) =>
	held.get(`${origin}\n${withGenres}`)?.summary ?? null;

export const subscribeSummary = (
	origin: string,
	listener: () => void,
	withGenres = false,
) => heldFor(origin, withGenres).listeners.subscribe(listener);

export const atStructure = (
	summary: LibrarySummary | null,
	structure: number,
) => (summary?.structure === structure ? summary : null);

async function ask(one: Held): Promise<void> {
	const library = announcedLibraryOf(one.origin);
	if (!library) return;

	one.controller?.abort();
	const controller = new AbortController();
	one.controller = controller;
	one.pair = { structure: library.structure, revision: library.revision };
	one.announced = null;

	const result = await fetchLibrarySummary(
		one.origin,
		SUMMARY_ROLES,
		one.tag,
		controller.signal,
		one.withGenres,
	).catch(() => readFailed("unreachable"));
	if (controller.signal.aborted) return;

	one.controller = null;
	if (holdAfterResult(one, result)) return ask(one);
	if (result.ok && result.kind === "summary") {
		one.tag = result.tag;
		one.summary = result.summary;
		one.listeners.notify();
	}
}

// foo_jean answers a summary of roles nobody declared with a 409.
function follow(one: Held, library: StateDocument["library"]) {
	if (reportedReady(one, library)) return void ask(one);
	if (!holdsDeclaration(library)) return;

	const { pair } = one;
	if (
		pair?.structure === library.structure &&
		pair.revision === library.revision
	)
		return;
	if (!isWaitingOnTime(one)) one.hold = { kind: "none" };
	if (isDue(one)) void ask(one);
}

function startAsking(one: Held) {
	const stopWatching = watchLibrary(one.origin, {
		exported: () => {
			if (declaredAgain(one)) void ask(one);
		},
		announced: (library) => follow(one, library),
		answered: () => {
			if (!one.controller && isWaitingOnTime(one) && isDue(one)) void ask(one);
		},
	});
	one.detach = () => {
		stopWatching();
		if (one.controller) {
			one.controller.abort();
			one.controller = null;
			one.pair = null;
		}
		one.detach = null;
	};

	const library = announcedLibraryOf(one.origin);
	if (library) follow(one, library);
}

// React's StrictMode unmounts and remounts in one task, so a last asker leaving and another arriving
// keeps the question in flight.
export function keepAsking(origin: string, withGenres: boolean) {
	const one = heldFor(origin, withGenres);
	one.askers += 1;
	if (!one.detach) startAsking(one);

	return () => {
		one.askers -= 1;
		if (one.askers > 0) return;
		queueMicrotask(() => {
			if (one.askers === 0) one.detach?.();
		});
	};
}

const NOTHING = () => () => {};

export function useLibrarySummary(
	{ origin }: Pick<Library, "origin">,
	{
		withGenres = false,
		isWanted = true,
	}: { withGenres?: boolean; isWanted?: boolean } = {},
) {
	useEffect(
		() => (origin && isWanted ? keepAsking(origin, withGenres) : undefined),
		[origin, withGenres, isWanted],
	);

	const subscribe = useCallback(
		(listener: () => void) =>
			origin ? subscribeSummary(origin, listener, withGenres) : NOTHING(),
		[origin, withGenres],
	);
	return useSyncExternalStore(subscribe, () =>
		origin ? summaryOf(origin, withGenres) : null,
	);
}

export function useMostPlayed({
	origin,
	structure,
}: Pick<Library, "origin" | "structure">) {
	const summary = useLibrarySummary({ origin }, { isWanted: false });
	return atStructure(summary, structure)?.topTracks[0]?.plays ?? 0;
}
