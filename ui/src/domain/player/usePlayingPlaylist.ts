// Stopgap: joins foo_jean's playlist GUID to beefweb's id, since the playlist list itself is still
// beefweb's. ARCHITECTURE.md, "Where state lives", has why and when this goes away.
import { useMemo } from "react";

import { usePlaylistAnnotations } from "./useAutoPlaylists";
import { usePlaylists } from "./usePlayer";

export function usePlayingPlaylist(guid: string | null): string | null {
	const { data: playlists = [] } = usePlaylists();
	const annotations = usePlaylistAnnotations();

	return useMemo(() => {
		if (!guid) return null;
		const entry = annotations.find((annotation) => annotation.id === guid);
		if (!entry) return null;
		return (
			entry.beefwebId ??
			playlists.find((playlist) => playlist.index === entry.index)?.id ??
			null
		);
	}, [annotations, playlists, guid]);
}
