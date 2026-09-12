import { useCallback } from "react";
import type { Refs } from "@/domain/track/project";
import { playItem } from "@/shared/api/beefweb";
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
	// The scratch playlist is filled through the component's own route rather than beefweb's, so it
	// is `foo_jean` being reachable that playing a set asks for rather than beefweb's `changePlaylists`.
	const canPlaySets = discovery.state.kind === "ready";
	const scratch = useScratchPlaylist({
		playlists,
		canEdit: canPlaySets,
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
			try {
				const id = await scratch.ensure({
					kind,
					label,
					refs,
					source: library.source,
				});
				return id ? playItem(id, position) : null;
			} catch {
				// foo_jean answers a fill it refuses or cannot attempt with a non-2xx status, most often
				// a 409 for a structure that moved under it, rather than an empty result: there is
				// nothing here to play until whatever asked for this tries again.
				return null;
			}
		},
		[scratch, library.source],
	);

	return { play, scratch, canPlaySets };
}
