import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
	EMPTY_PLAYLIST,
	libraryKey,
	loadLibrary,
	loadPlaylist,
	type PlaylistSnapshot,
	playlistKey,
	playlistSnapshot,
	subscribePlaylist,
} from "./playlistStore";

const stayUnsubscribed = () => () => {};

// A window onto one load in the store; the work happens once in there, however many components look at it.
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
	playlistId: string | null | undefined,
	itemCount: number | null | undefined,
) {
	const isReady = Boolean(playlistId) && itemCount != null;

	return useLoadedRows(
		isReady ? playlistKey(playlistId as string, itemCount as number) : null,
		useCallback(
			() => loadPlaylist(playlistId as string, itemCount as number),
			[playlistId, itemCount],
		),
	);
}

export function useLibraryItems(itemCount: number | null | undefined) {
	return useLoadedRows(
		itemCount == null ? null : libraryKey(itemCount),
		useCallback(() => loadLibrary(itemCount as number), [itemCount]),
	);
}
