import { useEffect, useMemo, useState } from "react";

import { isQueryTooLong } from "@/shared/api/libraryQuestions";
import { fetchPlaylistFind } from "@/shared/api/playlists";
import type { StateDocument } from "@/shared/api/state";
import { EMPTY_COLUMNS } from "./fields";
import { meet } from "./finderSets";
import { inTurn, LIBRARY_ROLES } from "./libraryAsker";
import type { LibraryColumns } from "./libraryColumns";
import { announcedLibraryOf, isSettled, watchLibrary } from "./libraryHolds";
import type { Refs } from "./project";
import { useLibraryQuestion } from "./useLibraryQuestion";

const MAX_RESULTS = 60;

const FIND_TRACKS_ONLY = {
	limit: 0,
	entityLimit: 0,
	splitsCredits: false,
} as const;

export type FinderOver =
	| {
			kind: "library";
			origin: string | null;
			key: string | null;
			columns: LibraryColumns;
	  }
	| {
			kind: "playlist";
			origin: string;
			id: string;
			structure: string;
			revision: string;
			length: number;
	  };

const NO_LIBRARY = { origin: null, key: null, columns: EMPTY_COLUMNS };

const NO_POSITIONS = new Int32Array(0);

const SEARCHED_ROLES = [
	"title",
	"artist",
	"albumArtist",
	"album",
	"artistSort",
] as const;

const declaresSearchedRoles = (library: StateDocument["library"] | null) =>
	!!library?.ready &&
	SEARCHED_ROLES.every((role) => library.columns.includes(LIBRARY_ROLES[role]));

type PlaylistOver = Extract<FinderOver, { kind: "playlist" }>;

// A find waits on the library when the declaration the page last heard lacks the searched roles, when
// foo_jean has no snapshot yet (`202`), or when it refused the roles (`409`, which also answers a
// structure that moved, and that one the playlist's next `structure` re-asks).
type LibraryWait = "undeclared" | "building" | "refused";

function usePlaylistFind(over: PlaylistOver | null, query: string) {
	const [found, setFound] = useState<{
		key: string;
		positions: Int32Array;
	} | null>(null);
	const [retries, setRetries] = useState(0);
	const [waitingOn, setWaitingOn] = useState<LibraryWait | null>(null);
	const origin = over?.origin;
	const id = over?.id;
	const structure = over?.structure;
	const revision = over?.revision;
	const length = over?.length;
	const key = `${id}\n${structure}\n${revision}\n${query}`;

	// biome-ignore lint/correctness/useExhaustiveDependencies: a retry fires this rather than being read in it.
	useEffect(() => {
		if (query === "") return setWaitingOn(null);
		if (
			origin === undefined ||
			id === undefined ||
			structure === undefined ||
			revision === undefined ||
			length === undefined
		)
			return;

		if (!declaresSearchedRoles(announcedLibraryOf(origin)))
			return setWaitingOn("undeclared");

		let isCurrent = true;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const queued = new AbortController();
		void inTurn(origin, queued.signal, () =>
			isCurrent
				? fetchPlaylistFind(origin, id, {
						query,
						structure,
						roles: LIBRARY_ROLES,
						length,
					})
				: Promise.resolve(null),
		)
			.catch(() => null)
			.then((result) => {
				if (!isCurrent || !result) return;
				if (result.ok) {
					setWaitingOn(null);
					if (result.value.structure === structure)
						setFound({ key, positions: result.value.matched });
					return;
				}
				if (result.reason === "notReady") return setWaitingOn("building");
				if (result.reason !== "refused") return;
				if (result.status === 409) return setWaitingOn("refused");
				if (result.retryInMs !== null)
					timer = setTimeout(
						() => setRetries((count) => count + 1),
						result.retryInMs,
					);
			});

		return () => {
			isCurrent = false;
			queued.abort();
			if (timer !== null) clearTimeout(timer);
		};
	}, [origin, id, structure, revision, length, query, key, retries]);

	useEffect(() => {
		if (!origin || waitingOn === null) return;

		const stopWatching = watchLibrary(origin, {
			exported: () => setRetries((count) => count + 1),
			announced: (library) => {
				const isBack =
					waitingOn === "undeclared"
						? declaresSearchedRoles(library)
						: waitingOn === "building" && isSettled(library);
				if (isBack) setRetries((count) => count + 1);
			},
			answered: () => {},
		});
		return () => {
			stopWatching();
		};
	}, [origin, waitingOn]);

	return found?.key === key ? found.positions : null;
}

function useKeptLast(
	fresh: Int32Array | null,
	scope: string | null,
	isAsked: boolean,
) {
	const [shown, setShown] = useState<{
		scope: string;
		positions: Int32Array;
	} | null>(null);
	if (!isAsked) {
		if (shown) setShown(null);
	} else if (fresh && scope !== null && shown?.positions !== fresh)
		setShown({ scope, positions: fresh });
	return fresh ?? (isAsked && shown?.scope === scope ? shown.positions : null);
}

export function useFound(
	over: FinderOver | null,
	rowIndices: Refs | null,
	query: string,
	session: number,
): { matches: Int32Array | null; results: number[] } {
	const isAsked = over !== null && query.trim() !== "";
	const isTooLong = isAsked && isQueryTooLong(query);
	const library = over?.kind === "library" ? over : null;
	const playlist = over?.kind === "playlist" ? over : null;

	const question = useMemo(
		() =>
			library && isAsked && !isTooLong
				? ({ kind: "search", query, ...FIND_TRACKS_ONLY } as const)
				: null,
		[library, isAsked, isTooLong, query],
	);
	const { answer } = useLibraryQuestion(
		question,
		library ? { ...library, key: `${library.key}\n${session}` } : NO_LIBRARY,
		true,
	);
	const matched = isAsked ? (answer?.matched ?? null) : null;
	const libraryPositions = useMemo(
		() => (matched ? meet(matched, rowIndices) : null),
		[matched, rowIndices],
	);
	const playlistFound = usePlaylistFind(
		playlist,
		isAsked && !isTooLong ? query : "",
	);

	const playlistPositions = useKeptLast(
		playlistFound,
		playlist ? `${playlist.id}\n${playlist.structure}` : null,
		isAsked,
	);

	const positions = isTooLong
		? NO_POSITIONS
		: (libraryPositions ?? playlistPositions);

	return useMemo(
		() => ({
			matches: positions,
			results: positions ? Array.from(positions.subarray(0, MAX_RESULTS)) : [],
		}),
		[positions],
	);
}
