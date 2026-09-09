import { useCallback } from "react";
import { canChangePlaylists, usePermissions } from "@/domain/player/usePlayer";
import type { Refs } from "@/domain/track/project";
import { playItem } from "@/shared/api/beefweb";
import type { PlaylistInfo } from "@/shared/api/types";
import type { Library } from "./useLibrary";
import { useScratchPlaylist } from "./useScratchPlaylist";

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
		canEdit: canChangePlaylists(permissions),
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

			if (library.playlist)
				return playItem(library.playlist.id, refs[position]);
			return null;
		},
		[scratch, library.source, library.playlist],
	);

	const canPlaySets =
		canChangePlaylists(permissions) || Boolean(library.playlist);

	return { play, scratch, canPlaySets };
}
