import { useCallback, useMemo, useState } from "react";
import { canChangePlaylists, usePermissions } from "@/domain/player/usePlayer";
import { findLibraryPlaylist } from "@/domain/track/jeanPlaylists";
import { librarySourceOf } from "@/domain/track/librarySource";
import type { PathTable } from "@/domain/track/pathTable";
import {
	componentLibraryKey,
	generationKey,
	libraryKey,
	playlistKey,
} from "@/domain/track/playlistStore";
import {
	useComponentLibraryItems,
	useLibraryItems,
	usePlaylistItems,
} from "@/domain/track/usePlaylistItems";
import { libraryOrigin } from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useLibraryInfo } from "./useLibrarySource";

export function useLibrary(playlists: PlaylistInfo[], { wanted = false } = {}) {
	const permissions = usePermissions();
	const { hasLibraryApi, info } = useLibraryInfo();
	const { discovery, isDiscovered, token } = useFooJean();

	const [requested, setRequested] = useState(false);
	const request = useCallback(() => setRequested(true), []);
	// A device with no token can never reach a `ready` discovery, so it has nothing to wait for.
	const sourcesAreKnown = isDiscovered || !token;
	const isWanted = (wanted || requested) && sourcesAreKnown;

	const canWrite = canChangePlaylists(permissions);

	// The component answers the library, and beefweb still has to act on it: filling the scratch
	// playlist, queueing a row and addressing its artwork all go through beefweb's own library
	// routes, which a player without them does not have.
	const origin = hasLibraryApi ? libraryOrigin(discovery) : null;
	const readsFromComponent = origin !== null;

	const playlist = useMemo(
		() =>
			readsFromComponent || (hasLibraryApi && canWrite)
				? null
				: findLibraryPlaylist(playlists),
		[readsFromComponent, hasLibraryApi, canWrite, playlists],
	);
	const readsFromApi =
		!readsFromComponent && hasLibraryApi && (canWrite || !playlist);
	const readsFromLibrary = readsFromComponent || readsFromApi;

	const viaComponent = useComponentLibraryItems(
		isWanted && readsFromComponent ? origin : null,
		discovery.token,
	);
	const viaApi = useLibraryItems(
		isWanted && readsFromApi ? info.itemCount : null,
	);
	const viaPlaylist = usePlaylistItems(
		isWanted && !readsFromLibrary ? playlist?.id : null,
		isWanted && !readsFromLibrary ? playlist?.itemCount : null,
	);
	const library = readsFromComponent
		? viaComponent
		: readsFromApi
			? viaApi
			: viaPlaylist;

	const key = readsFromComponent
		? generationKey(componentLibraryKey(origin), library.structure)
		: readsFromApi
			? libraryKey(info.itemCount)
			: playlist
				? playlistKey(playlist.id, playlist.itemCount)
				: null;

	const source = useMemo(
		() =>
			readsFromLibrary
				? librarySourceOf({
						kind: "library",
						paths: library.paths as PathTable,
						subsongs: library.subsongs as Int32Array,
					})
				: librarySourceOf({
						kind: "playlist",
						playlistId: playlist?.id as string,
					}),
		[readsFromLibrary, library.paths, library.subsongs, playlist?.id],
	);

	return {
		...library,
		snapshot: library,
		key,
		source,
		playlist,
		request,
		isWanted,
		canWrite,
		count: readsFromComponent
			? library.total
			: readsFromApi
				? info.itemCount
				: (playlist?.itemCount ?? 0),
		needsSetup: !readsFromLibrary && !playlist,
	};
}

export type Library = ReturnType<typeof useLibrary>;
