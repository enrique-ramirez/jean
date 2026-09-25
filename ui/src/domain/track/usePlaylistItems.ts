import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
	componentLibraryKey,
	EMPTY_PLAYLIST,
	loadComponentLibrary,
	loadPlaylist,
	type PlaylistSnapshot,
	playlistKey,
	playlistSnapshot,
	recheckPlaylist,
	subscribePlaylist,
} from "./playlistStore";

const stayUnsubscribed = () => () => {};

function useLoadedRows(
	key: string | null,
	start: () => void,
): PlaylistSnapshot {
	useEffect(() => {
		if (key) start();
	}, [key, start]);

	return useSyncExternalStore(
		useCallback(
			(listener) =>
				key ? subscribePlaylist(key, listener) : stayUnsubscribed(),
			[key],
		),
		useCallback(() => (key ? playlistSnapshot(key) : EMPTY_PLAYLIST), [key]),
	);
}

export function usePlaylistItems(
	origin: string | null,
	playlistId: string | null | undefined,
	structure: string | null | undefined,
	revision: string | null | undefined,
	itemCount: number | null | undefined,
) {
	const isReady =
		Boolean(origin) &&
		Boolean(playlistId) &&
		structure != null &&
		itemCount != null;

	const snapshot = useLoadedRows(
		isReady ? playlistKey(playlistId as string, structure as string) : null,
		useCallback(
			() =>
				loadPlaylist(
					origin as string,
					playlistId as string,
					structure as string,
					itemCount as number,
				),
			[origin, playlistId, structure, itemCount],
		),
	);

	useEffect(() => {
		if (!isReady || revision == null) return;
		void recheckPlaylist(origin as string, playlistId as string, {
			structure: structure as string,
			revision,
		});
	}, [isReady, origin, playlistId, structure, revision]);

	return snapshot;
}

export function useComponentLibraryItems(origin: string | null) {
	const isReady = Boolean(origin);

	return useLoadedRows(
		isReady ? componentLibraryKey(origin as string) : null,
		useCallback(() => loadComponentLibrary(origin as string), [origin]),
	);
}
