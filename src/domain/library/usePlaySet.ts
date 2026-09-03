import { useCallback } from "react";
import { usePermissions } from "@/domain/player/usePlayer";
import type { Refs } from "@/domain/track/project";
import { playItem } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import type { Library } from "./useLibrary";
import { useScratchPlaylist } from "./useScratchPlaylist";

// Write the set to the scratch playlist, then play a position in it. One implementation, because a set filled in the wrong order plays the wrong track and a player that refuses playlist writes has to degrade rather than do nothing.
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

			// No scratch playlist means a player that will not let Jean make one, so the track plays in place instead.
			if (library.playlist)
				return playItem(library.playlist.id, refs[position]);
			return null;
		},
		[scratch, library.source, library.playlist],
	);

	// Playing a set always needs a playlist to hold it, so a player that refuses writes can only do this with an autoplaylist already there.
	const canPlaySets =
		permissions.changePlaylists !== false || Boolean(library.playlist);

	return { play, scratch, canPlaySets };
}
