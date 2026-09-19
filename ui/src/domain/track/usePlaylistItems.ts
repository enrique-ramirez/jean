import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
	componentLibraryKey,
	EMPTY_PLAYLIST,
	loadComponentLibrary,
	loadPlaylist,
	type PlaylistSnapshot,
	playlistKey,
	playlistSnapshot,
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
	token: string | null,
	playlistId: string | null | undefined,
	itemCount: number | null | undefined,
) {
	const isReady =
		Boolean(origin) &&
		Boolean(token) &&
		Boolean(playlistId) &&
		itemCount != null;

	return useLoadedRows(
		isReady ? playlistKey(playlistId as string, itemCount as number) : null,
		useCallback(
			() =>
				loadPlaylist(
					origin as string,
					token as string,
					playlistId as string,
					itemCount as number,
				),
			[origin, token, playlistId, itemCount],
		),
	);
}

export function useComponentLibraryItems(
	origin: string | null,
	token: string | null,
) {
	const isReady = Boolean(origin) && Boolean(token);

	return useLoadedRows(
		isReady ? componentLibraryKey(origin as string) : null,
		useCallback(
			() => loadComponentLibrary(origin as string, token as string),
			[origin, token],
		),
	);
}
