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
			return id ? playItem(id, position) : null;
		},
		[scratch, library.source],
	);

	const canPlaySets = canChangePlaylists(permissions);

	return { play, scratch, canPlaySets };
}
