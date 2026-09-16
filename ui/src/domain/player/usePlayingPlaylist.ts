// Stopgap: joins foo_jean's playlist GUID to beefweb's id, since the playlist list itself is still
// beefweb's. ARCHITECTURE.md, "Where state lives", has why and when this goes away.
import { useMemo } from "react";

import { usePlaylistAnnotations } from "./useAutoPlaylists";
import { usePlaylists } from "./usePlayer";

export function usePlayingPlaylist(
	guid: string | null,
): string | null | undefined {
	const { data: playlists = [] } = usePlaylists();
	const { entries, isKnown } = usePlaylistAnnotations();

	return useMemo(() => {
		if (!guid) return null;
		if (!isKnown) return undefined;
		const entry = entries.find((annotation) => annotation.id === guid);
		if (!entry) return null;
		return (
			entry.beefwebId ??
			playlists.find((playlist) => playlist.index === entry.index)?.id ??
			null
		);
	}, [entries, isKnown, playlists, guid]);
}
