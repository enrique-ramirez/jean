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

export function useLibrary(playlists: PlaylistInfo[], { wanted = false } = {}) {
	const permissions = usePermissions();
	const { hasLibraryApi, info } = useLibraryInfo();

	const [requested, setRequested] = useState(false);
	const request = useCallback(() => setRequested(true), []);
	const isWanted = wanted || requested;

	const canWrite = canChangePlaylists(permissions);

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
		snapshot: library,
		key,
		source,
		playlist,
		request,
		isWanted,
		canWrite,
		count: readsFromApi ? info.itemCount : (playlist?.itemCount ?? 0),
		needsSetup: !readsFromApi && !playlist,
	};
}

export type Library = ReturnType<typeof useLibrary>;
