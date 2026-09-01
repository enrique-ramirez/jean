import { useCallback } from "react";

import { playItem } from "../api/beefweb";
import type { PlaylistInfo } from "../api/types";
import { usePermissions } from "../player/usePlayer";
import type { Refs } from "./project";
import type { Library } from "./useLibrary";
import { useScratchPlaylist } from "./useScratchPlaylist";

// Playing a set of library rows: write the set to the scratch playlist, then
// play a position in it. What differs between callers is only which set and
// which position -- a shelf starting at the album you clicked, the whole library
// starting somewhere at random, a row in a view.
//
// One implementation because the failure modes are shared and nasty: a set
// filled in the wrong order plays the wrong track, and a player that refuses
// playlist writes has to degrade rather than do nothing.
export function usePlaySet({
	library,
	playlists,
}: {
	library: Library;
	playlists: PlaylistInfo[];
}) {
	const permissions = usePermissions();
	const scratch = useScratchPlaylist({
		playlists,
		canEdit: permissions.changePlaylists !== false,
	});

	const play = useCallback(
		async ({
			kind,
			label,
			refs,
			position,
		}: {
			kind: string;
			label: string | null;
			refs: Refs;
			position: number;
		}) => {
			const id = await scratch.ensure({
				kind,
				label,
				refs,
				source: library.source,
			});
			if (id) return playItem(id, position);

			// No scratch playlist means a player that will not let Jean make one. The
			// track still plays, in place, and what follows it is the library's
			// business rather than this set's -- degraded, and honestly so.
			if (library.playlist)
				return playItem(library.playlist.id, refs[position]);
			return null;
		},
		[scratch, library.source, library.playlist],
	);

	// Whether there is anything to play a set *in*. Playing a set always needs a
	// playlist to hold it, so a player that refuses playlist writes can only do
	// this if an autoplaylist is already there to play in place.
	const canPlaySets =
		permissions.changePlaylists !== false || Boolean(library.playlist);

	return { play, scratch, canPlaySets };
}
