import { useCallback, useMemo, useState } from "react";
import { canChangePlaylists, usePermissions } from "@/domain/player/usePlayer";
import { findLibraryPlaylist } from "@/domain/track/jeanPlaylists";
import { librarySourceOf } from "@/domain/track/librarySource";
import type { PathTable } from "@/domain/track/pathTable";
import { libraryKey, playlistKey } from "@/domain/track/playlistStore";
import {
	useLibraryItems,
	usePlaylistItems,
} from "@/domain/track/usePlaylistItems";
import type { PlaylistInfo } from "@/shared/api/types";
import { useLibraryInfo } from "./useLibrarySource";

// The library as one array in memory, from either source. Every view over it is a filter producing refs into this.
export function useLibrary(playlists: PlaylistInfo[], { wanted = false } = {}) {
	const permissions = usePermissions();
	const { hasLibraryApi, info } = useLibraryInfo();

	// Megabytes, and most sessions never need it. `request` exists because the search field is the one consumer the route cannot know about.
	const [requested, setRequested] = useState(false);
	const request = useCallback(() => setRequested(true), []);
	const isWanted = wanted || requested;

	const canWrite = canChangePlaylists(permissions);

	// Not simply dropped when there is an API: playing a set always needs a playlist to play it in, so a player that refuses playlist writes browses through the API but plays through the autoplaylist.
	const playlist = useMemo(
		() => (hasLibraryApi && canWrite ? null : findLibraryPlaylist(playlists)),
		[hasLibraryApi, canWrite, playlists],
	);
	const readsFromApi = hasLibraryApi && (canWrite || !playlist);

	const viaApi = useLibraryItems(
		isWanted && readsFromApi ? info.itemCount : null,
	);
	const viaPlaylist = usePlaylistItems(
		isWanted && !readsFromApi ? playlist?.id : null,
		isWanted && !readsFromApi ? playlist?.itemCount : null,
	);
	const library = readsFromApi ? viaApi : viaPlaylist;

	// Carries the count, so an edited library indexes afresh rather than inheriting rows that have moved.
	const key = readsFromApi
		? libraryKey(info.itemCount)
		: playlist
			? playlistKey(playlist.id, playlist.itemCount)
			: null;

	const source = useMemo(
		() =>
			readsFromApi
				? librarySourceOf({
						kind: "library",
						// Non-null by construction: only the media library load has them.
						paths: library.paths as PathTable,
						subsongs: library.subsongs as number[],
					})
				: librarySourceOf({
						kind: "playlist",
						playlistId: playlist?.id as string,
					}),
		[readsFromApi, library.paths, library.subsongs, playlist?.id],
	);

	return {
		...library,
		// Depend on this, not on the returned object: that is rebuilt every render, so a `useMemo` keyed on it never hits and re-runs its pass over every row.
		snapshot: library,
		key,
		source,
		playlist,
		request,
		isWanted,
		canWrite,
		// `total` stays zero until a load starts, so it cannot answer how big the library is before anything has arrived.
		count: readsFromApi ? info.itemCount : (playlist?.itemCount ?? 0),
		needsSetup: !readsFromApi && !playlist,
	};
}

export type Library = ReturnType<typeof useLibrary>;
