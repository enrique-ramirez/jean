import { useMemo } from "react";
import { usePlayingPlaylist } from "@/domain/player/playlistJoin";
import { useAudiblePlayer } from "@/domain/player/usePlayer";
import type { LibrarySource } from "@/domain/track/librarySource";
import type { Refs } from "@/domain/track/project";
import { readTrack } from "@/shared/api/beefweb";
import type { useScratchPlaylist } from "./useScratchPlaylist";

export function useActivePosition({
	source,
	indices,
	scratch,
	holdsThisView,
}: {
	source: LibrarySource;
	indices: Refs;
	scratch: ReturnType<typeof useScratchPlaylist>;
	holdsThisView: boolean;
}) {
	const snapshot = useAudiblePlayer();

	const activeItem = snapshot?.player?.activeItem;
	const playing = readTrack(snapshot?.player);

	// Read by value: a player message arrives for every volume nudge, each carrying a new `activeItem` object, and the memo below sweeps every ref in the view.
	const path = playing?.path ?? null;
	const subsong = playing?.subsong ?? 0;
	const playlistId =
		usePlayingPlaylist(activeItem?.playlistGuid ?? null) ?? null;
	const index = activeItem?.index ?? -1;
	const scratchId = scratch.playlist?.id ?? null;

	return useMemo(
		() =>
			holdsThisView && playlistId === scratchId
				? index
				: source.playingPosition(
						indices,
						{ path, subsong },
						{ playlistId, index },
					),
		[
			holdsThisView,
			scratchId,
			source,
			indices,
			path,
			subsong,
			playlistId,
			index,
		],
	);
}
