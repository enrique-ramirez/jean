import { useEffect, useMemo } from "react";
import { libraryOrigin } from "@/shared/api/discovery";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useStoreOr } from "@/shared/hooks/useStoreOr";
import { useFieldFactsKnown } from "./fieldAvailability";
import { type AlbumSpan, groupsFromRuns, NO_GROUPS } from "./grouping";
import { announcedLibraryOf } from "./libraryHolds";
import { windowedLibraryOf } from "./libraryWindows";
import { EMPTY_PLAYLIST_STATE, type WindowedPlaylist } from "./playlistLoader";
import { windowedPlaylistRows } from "./playlistRows";
import { EMPTY_VIEW, type ListedRows, type Refs } from "./project";
import type { PlaylistList } from "./rowWindows";
import { type HeaderStats, statsOfFigures } from "./stats";

export function usePlaylistState(windowed: WindowedPlaylist | null) {
	return useStoreOr(windowed, EMPTY_PLAYLIST_STATE);
}

export function usePlaylistWindows(
	playlistId: string | null | undefined,
): WindowedPlaylist | null {
	const { discovery } = useFooJean();
	const { origin } = discovery;

	return useMemo(
		() =>
			origin && playlistId
				? windowedLibraryOf(origin).playlistOf(playlistId)
				: null,
		[origin, playlistId],
	);
}

export function usePlaylistSetRows(
	windowed: WindowedPlaylist | null,
	structure: string | null,
	positions: Refs | null,
): ListedRows {
	const watched = windowed && structure !== null && positions ? windowed : null;
	const state = usePlaylistState(watched);
	const id = windowed?.source.playlistId ?? null;
	const list = useMemo<PlaylistList | null>(
		() =>
			id !== null && structure !== null && positions
				? {
						kind: "playlist",
						id,
						structure,
						length: positions.length,
						positions,
					}
				: null,
		[id, structure, positions],
	);
	const mostPlays = state.runs?.runs.mostPlays ?? 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: a moved version fires this rather than being read in it.
	return useMemo(
		() =>
			watched && list
				? windowedPlaylistRows(
						watched.windows,
						list,
						watched.besideViewportOf(list),
						mostPlays,
					)
				: EMPTY_VIEW,
		[watched, list, state.version, mostPlays],
	);
}

export interface DrawnList {
	structure: string;
	length: number;
}

function fittedTo(lengths: number[], length: number): number[] {
	let sum = 0;
	for (const run of lengths) sum += run;
	if (sum === length) return lengths;

	const fitted: number[] = [];
	let left = length;
	for (const run of lengths) {
		if (left <= 0) break;
		fitted.push(Math.min(run, left));
		left -= run;
	}
	if (left > 0) fitted.push(left);
	return fitted;
}

export interface PlaylistItems {
	list: PlaylistList | null;
	isOpening: boolean;
	failure: string | null;
	rows: ListedRows;
	groups: AlbumSpan[];
	hasDiscs: boolean;
	stats: HeaderStats | null;
}

export function usePlaylistItems(
	windowed: WindowedPlaylist | null,
	playlist: PlaylistInfo | null,
	drawn: DrawnList | null,
): PlaylistItems {
	const state = usePlaylistState(windowed);

	const { discovery } = useFooJean();
	const readsLibrary = libraryOrigin(discovery) !== null;

	const id = playlist?.id;
	const structure = drawn?.structure ?? playlist?.structure;
	const counted =
		state.total && state.total.structure === structure
			? state.total.rows
			: undefined;
	const length = drawn?.length ?? counted ?? playlist?.itemCount;
	const areFactsKnown = useFieldFactsKnown();
	const library = discovery.origin
		? announcedLibraryOf(discovery.origin)
		: null;
	const isAwaitingFacts =
		readsLibrary &&
		!areFactsKnown &&
		(library === null || (library.ready && !library.halted));
	const isOpening = (!state.isOpened || isAwaitingFacts) && (length ?? 0) > 0;
	const announcedStructure = playlist?.structure;
	const revision = playlist?.revision;

	const list = useMemo<PlaylistList | null>(
		() =>
			id !== undefined && structure !== undefined && length !== undefined
				? { kind: "playlist", id, structure, length, positions: null }
				: null,
		[id, structure, length],
	);

	useEffect(() => {
		windowed?.show(list, readsLibrary);
	}, [windowed, list, readsLibrary]);

	useEffect(() => () => windowed?.show(null, false), [windowed]);

	useEffect(() => {
		if (announcedStructure !== undefined && revision !== undefined)
			windowed?.announce(announcedStructure, revision);
	}, [windowed, announcedStructure, revision]);

	const held = state.runs;
	const mostPlays = held?.runs.mostPlays ?? 0;

	// biome-ignore lint/correctness/useExhaustiveDependencies: a moved version fires this rather than being read in it.
	const rows = useMemo(
		() =>
			windowed && list && !isOpening
				? windowedPlaylistRows(
						windowed.windows,
						list,
						windowed.viewportOf(list),
						mostPlays,
					)
				: EMPTY_VIEW,
		[windowed, list, isOpening, state.version, mostPlays],
	);

	const groups = useMemo(() => {
		if (!held || length === undefined) return NO_GROUPS;
		const { lengths } = held.runs;
		const fitted = fittedTo(lengths, length);
		return groupsFromRuns(
			fitted === lengths ? held.runs : { lengths: fitted },
			null,
		);
	}, [held, length]);

	const stats = useMemo(
		() =>
			held && length !== undefined
				? { ...statsOfFigures(held.runs), trackCount: length }
				: null,
		[held, length],
	);

	return {
		list,
		isOpening,
		failure: isOpening ? state.failure : null,
		rows,
		groups,
		hasDiscs: state.hasDiscs,
		stats,
	};
}
