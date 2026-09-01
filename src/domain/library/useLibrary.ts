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

// The library, as one array in memory. Every view over it -- search, all music,
// a shelf -- is a filter producing a list of refs into this, which is why it
// lives here rather than inside any one of them.
//
// Two places it can come from: the media library API when the player has one,
// the autoplaylist otherwise. Both load through the same store and produce the
// same rows; what differs is how a row is addressed afterwards, which is what
// `source` carries.
export function useLibrary(playlists: PlaylistInfo[], { wanted = false } = {}) {
	const permissions = usePermissions();
	const { hasLibraryApi, info } = useLibraryInfo();

	// Megabytes, and most sessions never need it, so nothing is fetched until a
	// view that shows the library is open or something asks. `request` exists
	// because the search field is the one consumer the route cannot know about --
	// reaching for it is the ask.
	const [requested, setRequested] = useState(false);
	const request = useCallback(() => setRequested(true), []);
	const isWanted = wanted || requested;

	const canWrite = permissions.changePlaylists !== false;

	// Resolved only when it could actually be used. With a library API and the
	// permission to make a scratch playlist the autoplaylist is never read --
	// resolving one anyway had the idle screen announce a count from a playlist
	// while every row on screen came from the media library.
	//
	// The exception is why it is not simply dropped: playing a set always needs a
	// playlist to play it *in*, and there is no "play this library item". On a
	// player that refuses playlist writes the API can browse but never play,
	// while an autoplaylist can still be played in place.
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

	// Keyed per source and carrying the count either way, so an edited library
	// indexes afresh rather than inheriting rows that have moved.
	const key = useApi
		? libraryKey(info.itemCount)
		: playlist
			? playlistKey(playlist.id, playlist.itemCount)
			: null;

	// How to act on a row. The list machinery never sees this -- it holds integer
	// refs and nothing else -- but everything that plays, copies or draws artwork
	// goes through it.
	const source = useMemo(
		() =>
			useApi
				? librarySourceOf({
						kind: "library",
						// Non-null by construction: these are only ever read from a load
						// the media library produced, which is the only source that has
						// them.
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
		// The same rows, as the one object identity they arrive with. The spread
		// above is for reading a field; this is for depending on one. Everything
		// returned here is rebuilt every render, so a `useMemo` keyed on the
		// library never hits and re-runs its pass over every row -- which is a full
		// aggregation of the library on every SSE message, and silent, because an
		// exhaustive dependency array is exactly what the linter asks for.
		snapshot: library,
		key,
		source,
		playlist,
		request,
		isWanted,
		canWrite,
		// What to say before anything is loaded. `total` is the load's own
		// denominator and stays zero until a load starts, so it cannot answer "how
		// big is my library". Both sources can state that up front.
		count: useApi ? info.itemCount : (playlist?.itemCount ?? 0),
		// The setup screen is for players with no library API. With one there is
		// nothing to point Jean at and nothing to ask the user for.
		needsSetup: !useApi && !playlist,
	};
}

// The library as every consumer sees it. Inferred rather than declared, so it
// cannot drift from what the hook actually returns.
export type Library = ReturnType<typeof useLibrary>;
