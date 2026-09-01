import { useCallback, useMemo, useState } from "react";
import { usePermissions } from "@/domain/player/usePlayer";
import { findLibraryPlaylist } from "@/domain/track/jeanPlaylists";
import { librarySourceOf } from "@/domain/track/librarySource";
import { libraryKey, playlistKey } from "@/domain/track/playlistStore";
import {
	useLibraryItems,
	usePlaylistItems,
} from "@/domain/track/usePlaylistItems";
import type { PlaylistInfo } from "@/shared/api/types";
import { useLibraryInfo } from "./useLibrarySource";

// The library as one array in memory, from either source. Every view over it is
// a filter producing refs into this.
export function useLibrary(playlists: PlaylistInfo[], { wanted = false } = {}) {
	const permissions = usePermissions();
	const { hasLibraryApi, info } = useLibraryInfo();

	// Megabytes, and most sessions never need it. `request` exists because the
	// search field is the one consumer the route cannot know about.
	const [requested, setRequested] = useState(false);
	const request = useCallback(() => setRequested(true), []);
	const isWanted = wanted || requested;

	const canWrite = permissions.changePlaylists !== false;

	// Not simply dropped when there is an API: playing a set always needs a
	// playlist to play it *in*, so a player that refuses playlist writes can
	// browse through the API but only play through the autoplaylist.
	const playlist = useMemo(
		() => (hasLibraryApi && canWrite ? null : findLibraryPlaylist(playlists)),
		[hasLibraryApi, canWrite, playlists],
	);
	const useApi = hasLibraryApi && (canWrite || !playlist);

	const viaApi = useLibraryItems(isWanted && useApi ? info.itemCount : null);
	const viaPlaylist = usePlaylistItems(
		isWanted && !useApi ? playlist?.id : null,
		isWanted && !useApi ? playlist?.itemCount : null,
	);
	const library = useApi ? viaApi : viaPlaylist;

	// Carries the count, so an edited library indexes afresh rather than
	// inheriting rows that have moved.
	const key = useApi
		? libraryKey(info.itemCount)
		: playlist
			? playlistKey(playlist.id, playlist.itemCount)
			: null;

	const source = useMemo(
		() =>
			useApi
				? librarySourceOf({
						kind: "library",
						// Non-null by construction: only the media library load has them.
						paths: library.paths as string[],
						subsongs: library.subsongs as number[],
					})
				: librarySourceOf({
						kind: "playlist",
						playlistId: playlist?.id as string,
					}),
		[useApi, library.paths, library.subsongs, playlist?.id],
	);

	return {
		...library,
		// Depend on this, not on the returned object: that is rebuilt every render,
		// so a `useMemo` keyed on it never hits and re-runs its pass over every row.
		snapshot: library,
		key,
		source,
		playlist,
		request,
		isWanted,
		canWrite,
		// What to say before anything is loaded: `total` stays zero until a load
		// starts, so it cannot answer "how big is my library".
		count: useApi ? info.itemCount : (playlist?.itemCount ?? 0),
		needsSetup: !useApi && !playlist,
	};
}

// Inferred rather than declared, so it cannot drift from the hook.
export type Library = ReturnType<typeof useLibrary>;
