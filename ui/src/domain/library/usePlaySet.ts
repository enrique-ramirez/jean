import { useCallback } from "react";
import { reportPlaybackRefusal } from "@/domain/player/playerWrite";
import { usePlayItem } from "@/domain/player/useTransport";
import type { ScratchKind } from "@/domain/track/jeanPlaylists";
import type { Refs } from "@/domain/track/project";
import { isFooJeanReady, permitsPlaybackControl } from "@/shared/api/discovery";
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
	const { discovery, recheck } = useFooJean();
	const canPlaySets = isFooJeanReady(discovery);
	const canControlPlayback = permitsPlaybackControl(discovery);
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
			kind: ScratchKind;
			label: string | null;
			refs: Refs;
			position: number;
		}) => {
			if (!canControlPlayback) return null;
			let id: string | null;
			try {
				id = await scratch.ensure({
					kind,
					label,
					refs,
					source: library.source,
				});
			} catch (error) {
				reportPlaybackRefusal(error, recheck);
				// foo_jean answers a fill it refuses or cannot attempt with a non-2xx status, most often
				// a 409 for a structure that moved under it, rather than an empty result: there is
				// nothing here to play until whatever asked for this tries again.
				return null;
			}
			// `usePlayItem`'s own mutation already reports a playback refusal through the same helper,
			// so this swallows only to keep a mutation's rejection from reaching a caller that never
			// reads it, not to answer for it a second time.
			return id
				? playItem
						.mutateAsync({ playlistId: id, index: position })
						.catch(() => null)
				: null;
		},
		[
			scratch,
			library.source,
			playItem.mutateAsync,
			recheck,
			canControlPlayback,
		],
	);

	return { play, scratch, canPlaySets };
}
