import { useMemo } from "react";
import { useAudiblePlayer } from "@/domain/player/usePlayer";
import type { LibrarySource } from "@/domain/track/librarySource";
import type { Refs } from "@/domain/track/project";
import { readTrack } from "@/shared/api/beefweb";
import type { useScratchPlaylist } from "./useScratchPlaylist";

// Which row of this view the player is on. The scratch playlist holds this view in this order, so when it is the one playing its index answers directly.
// Everything else goes through the source, which matches on `(path, subsong)` and so still finds a track playing from some other playlist.
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

	// By value, not by object: a player message arrives for every volume nudge, each with a new `activeItem`, and the source's answer sweeps every ref in the view.
	const path = playing?.path ?? null;
	const subsong = playing?.subsong ?? 0;
	const playlistId = activeItem?.playlistId ?? null;
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
