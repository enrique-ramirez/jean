import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
	announcedLibraryOf,
	type Hold,
	watchAnnounced,
} from "@/domain/track/libraryHolds";
import { librarySourceOf } from "@/domain/track/librarySource";
import {
	type WindowedState,
	windowedLibraryOf,
} from "@/domain/track/libraryWindows";
import type { PathTable } from "@/domain/track/pathTable";
import {
	componentLibraryKey,
	EMPTY_PLAYLIST,
	generationKey,
	playlistSnapshot,
	subscribePlaylist,
} from "@/domain/track/playlistEntries";
import {
	EMPTY_VIEW,
	type ListedRows,
	type Refs,
	type RowsViewport,
	windowedRows,
} from "@/domain/track/project";
import type { LibraryList, RowWindows } from "@/domain/track/rowWindows";
import { libraryOrigin } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { libraryStatusOf } from "./libraryStatus";
import { useMostPlayed } from "./useLibrarySummary";

const NO_PATHS: PathTable = { length: 0, at: () => "" };

const NO_SUBSONGS = new Int32Array(0);

const NO_HOLD: Hold = { kind: "none" };

const NOTHING_TO_RETRY = () => {};

const NOTHING = () => () => {};

export function useLibrary() {
	const { discovery, isDiscovered, recheck } = useFooJean();

	const origin = libraryOrigin(discovery);

	const entryKey = origin ? componentLibraryKey(origin) : null;
	const library = useSyncExternalStore(
		useCallback(
			(listener) =>
				entryKey ? subscribePlaylist(entryKey, listener) : NOTHING(),
			[entryKey],
		),
		useCallback(
			() => (entryKey ? playlistSnapshot(entryKey) : EMPTY_PLAYLIST),
			[entryKey],
		),
	);
	const announced = useSyncExternalStore(
		useCallback(
			(listener) => (origin ? watchAnnounced(origin, listener) : NOTHING()),
			[origin],
		),
		useCallback(() => (origin ? announcedLibraryOf(origin) : null), [origin]),
	);
	const windowed = useMemo(
		() => (origin ? windowedLibraryOf(origin) : null),
		[origin],
	);

	const hold = useSyncExternalStore(
		useCallback(
			(listener) => (windowed ? windowed.watchHold(listener) : NOTHING()),
			[windowed],
		),
		useCallback(() => (windowed ? windowed.hold() : NO_HOLD), [windowed]),
	);
	const retry = windowed ? windowed.retryNow : NOTHING_TO_RETRY;

	const key = origin
		? generationKey(componentLibraryKey(origin), library.structure)
		: null;

	const source = useMemo(
		() =>
			windowed?.source ??
			librarySourceOf({
				kind: "library",
				paths: NO_PATHS,
				subsongs: NO_SUBSONGS,
				artworkOrigin: null,
			}),
		[windowed],
	);

	const status = libraryStatusOf(
		isDiscovered ? discovery : null,
		announced,
		hold,
	);

	return {
		...library,
		snapshot: library,
		key,
		source,
		windowed,
		status,
		recheck,
		retry,
		origin,
	};
}

export type Library = ReturnType<typeof useLibrary>;

const EMPTY_STATE: WindowedState = {
	list: null,
	version: 0,
	runs: null,
	hasDiscs: false,
};

export function useWindowedRows(
	{
		windowed,
		origin,
		structure,
	}: Pick<Library, "windowed" | "origin" | "structure">,
	isShown: boolean,
): ListedRows {
	const mostPlayed = useMostPlayed({ origin, structure });
	const state = useSyncExternalStore(
		windowed && isShown ? windowed.subscribe : NOTHING,
		windowed && isShown ? windowed.state : () => EMPTY_STATE,
	);

	return useMemo(
		() =>
			windowed && state.list
				? windowedRows(
						windowed.windows,
						state.list,
						windowed.viewportOf(state.list),
						mostPlayed,
					)
				: EMPTY_VIEW,
		[windowed, state, mostPlayed],
	);
}

const besideViewports = new WeakMap<LibraryList, RowsViewport>();

function besideViewportOf(windows: RowWindows, list: LibraryList) {
	let viewport = besideViewports.get(list);
	if (!viewport) {
		viewport = {
			watch: (first, end, direction) =>
				windows.view(list, first, end, direction),
			leave: () => windows.leave(list),
		};
		besideViewports.set(list, viewport);
	}
	return viewport;
}

export function useSetRows(
	{
		windowed,
		snapshot,
		origin,
	}: Pick<Library, "windowed" | "snapshot" | "origin">,
	id: string,
	ordinals: Refs | null,
	{ isBeside = false }: { isBeside?: boolean } = {},
): ListedRows & { indices: Refs } {
	const watched = windowed && ordinals ? windowed : null;
	const state = useSyncExternalStore(
		watched ? watched.subscribe : NOTHING,
		watched ? watched.state : () => EMPTY_STATE,
	);
	const { structure } = snapshot;
	const mostPlayed = useMostPlayed({ origin, structure });

	const list = useMemo<LibraryList | null>(
		() =>
			ordinals
				? {
						kind: "library",
						id,
						structure,
						length: ordinals.length,
						ordinals,
					}
				: null,
		[id, structure, ordinals],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a moved version fires this rather than being read in it.
	return useMemo(
		() =>
			watched && list && ordinals
				? {
						...windowedRows(
							watched.windows,
							list,
							isBeside
								? besideViewportOf(watched.windows, list)
								: watched.viewportOf(list),
							mostPlayed,
						),
						indices: ordinals,
					}
				: EMPTY_VIEW,
		[watched, list, ordinals, isBeside, state, mostPlayed],
	);
}

export function useWatchedWhole(
	{ viewport, length }: Pick<ListedRows, "viewport" | "length">,
	isWatching = true,
) {
	useEffect(() => {
		if (!viewport || length === 0 || !isWatching) return undefined;
		viewport.watch(0, length, 0);
		return viewport.leave;
	}, [viewport, length, isWatching]);
}
