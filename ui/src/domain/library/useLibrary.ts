import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
	announcedLibraryOf,
	type Hold,
	watchAnnounced,
} from "@/domain/track/libraryHolds";
import { windowedSourceOf } from "@/domain/track/librarySource";
import {
	EMPTY_WINDOWED_STATE,
	windowedLibraryOf,
} from "@/domain/track/libraryWindows";
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
import { useStoreOr } from "@/shared/hooks/useStoreOr";
import { NO_SUBSCRIPTION } from "@/shared/lib/store";
import { libraryStatusOf } from "./libraryStatus";
import { useMostPlayed } from "./useLibrarySummary";

const NO_HOLD: Hold = { kind: "none" };

const NOTHING_TO_RETRY = () => {};

const NO_SOURCE = windowedSourceOf({
	windows: { at: () => null },
	origin: null,
	listNow: () => null,
	coverOf: () => null,
});

export function useLibrary() {
	const { discovery, isDiscovered, recheck } = useFooJean();

	const origin = libraryOrigin(discovery);

	const announced = useSyncExternalStore(
		useCallback(
			(listener) =>
				origin ? watchAnnounced(origin, listener) : NO_SUBSCRIPTION(),
			[origin],
		),
		useCallback(() => (origin ? announcedLibraryOf(origin) : null), [origin]),
	);
	const windowed = useMemo(
		() => (origin ? windowedLibraryOf(origin) : null),
		[origin],
	);
	const list = useSyncExternalStore(
		useCallback(
			(listener) =>
				windowed ? windowed.subscribe(listener) : NO_SUBSCRIPTION(),
			[windowed],
		),
		useCallback(() => (windowed ? windowed.state().list : null), [windowed]),
	);

	const hold = useSyncExternalStore(
		useCallback(
			(listener) =>
				windowed ? windowed.watchHold(listener) : NO_SUBSCRIPTION(),
			[windowed],
		),
		useCallback(() => (windowed ? windowed.hold() : NO_HOLD), [windowed]),
	);
	const retry = windowed ? windowed.retryNow : NOTHING_TO_RETRY;

	const structure = list?.structure ?? 0;
	const trackCount = list?.length ?? 0;
	const key = origin ? `${origin}:s${structure}` : null;

	const status = libraryStatusOf(
		isDiscovered ? discovery : null,
		announced,
		hold,
	);

	return {
		structure,
		trackCount,
		key,
		source: windowed?.source ?? NO_SOURCE,
		windowed,
		status,
		recheck,
		retry,
		origin,
	};
}

export type Library = ReturnType<typeof useLibrary>;

export function useWindowedRows(
	{
		windowed,
		origin,
		structure,
	}: Pick<Library, "windowed" | "origin" | "structure">,
	isShown: boolean,
): ListedRows {
	const mostPlayed = useMostPlayed({ origin, structure });
	const state = useStoreOr(
		windowed && isShown ? windowed : null,
		EMPTY_WINDOWED_STATE,
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
		structure,
		origin,
	}: Pick<Library, "windowed" | "structure" | "origin">,
	id: string,
	ordinals: Refs | null,
	{ isBeside = false }: { isBeside?: boolean } = {},
): ListedRows & { indices: Refs } {
	const watched = windowed && ordinals ? windowed : null;
	const state = useStoreOr(watched, EMPTY_WINDOWED_STATE);
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
