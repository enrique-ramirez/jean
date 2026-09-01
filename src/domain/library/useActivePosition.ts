import { useMemo } from "react";
import { usePlayer } from "@/domain/player/usePlayer";
import type { LibrarySource } from "@/domain/track/librarySource";
import type { Refs } from "@/domain/track/project";
import { readTrack } from "@/shared/api/beefweb";
import type { useScratchPlaylist } from "./useScratchPlaylist";

// Which row of this view the player is on.
//
// Two playlists are in play: reading stays with the library, while playback
// moves into the scratch playlist, whose contents are this view in this order.
// So the scratch is asked first and answers for free.
//
// Everything else goes through the source, the only thing that knows what
// identifies a row. That is what makes the mark exact: the library source
// matches on `(path, subsong)`, so a track playing from some other playlist is
// still found here.
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
	const { data: snapshot } = usePlayer();

	const activeItem = snapshot?.player?.activeItem;
	const playing = readTrack(snapshot?.player);

	// By value, not by object: a player message arrives for every volume nudge, each
	// with a new `activeItem`, and the source's answer sweeps every ref in the view.
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
