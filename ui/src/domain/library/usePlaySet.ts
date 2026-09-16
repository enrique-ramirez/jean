import { useCallback } from "react";
import { usePlayItem } from "@/domain/player/usePlayer";
import type { Refs } from "@/domain/track/project";
import { isFooJeanReady } from "@/shared/api/fooJean";
import type { PlaylistInfo } from "@/shared/api/types";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { Library } from "./useLibrary";
import { useScratchPlaylist } from "./useScratchPlaylist";

export function usePlaySet({
	library,
	playlists,
}: {
	library: Library;
	playlists: PlaylistInfo[];
}) {
	const { discovery } = useFooJean();
	const canPlaySets = isFooJeanReady(discovery);
	const scratch = useScratchPlaylist({
		playlists,
		canEdit: canPlaySets,
	});
	const playItem = usePlayItem();

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
			try {
				const id = await scratch.ensure({
					kind,
					label,
					refs,
					source: library.source,
				});
				return id
					? playItem.mutateAsync({ playlistId: id, index: position })
					: null;
			} catch {
				// foo_jean answers a fill it refuses or cannot attempt with a non-2xx status, most often
				// a 409 for a structure that moved under it, rather than an empty result: there is
				// nothing here to play until whatever asked for this tries again.
				return null;
			}
		},
		[scratch, library.source, playItem.mutateAsync],
	);

	return { play, scratch, canPlaySets };
}
