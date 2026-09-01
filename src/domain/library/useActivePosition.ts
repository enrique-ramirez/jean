import { useMemo } from "react";
import { usePlayer } from "@/domain/player/usePlayer";
import type { LibrarySource } from "@/domain/track/librarySource";
import type { Refs } from "@/domain/track/project";
import { readTrack } from "@/shared/api/beefweb";
import type { useScratchPlaylist } from "./useScratchPlaylist";

// Which row of this view the player is on.
//
// Two playlists are in play at once and they must not be confused: reading
// stays with the library -- the rows, their artwork, their heat all come from
// it -- while playback moves into the scratch playlist, whose contents are this
// view in this order. So the scratch is asked first, and it answers for free: a
// position there is a position here.
//
// Everything else goes through the source, which is the only thing that knows
// what identifies a row. That is what makes the mark exact rather than
// best-effort -- the library source matches on `(path, subsong)`, so a track
// playing from some *other* playlist is still found here, in its own position.
// Asking by playlist index could only answer while the player happened to be
// inside the one playlist being read, and with a library API there is no such
// playlist at all.
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

	// Depended on by value, not by object: a player message arrives for every
	// volume nudge and pause, each with a new `activeItem`, and the library
	// source's answer is a sweep of every ref in the view. Pay it when the track
	// changes, not whenever the player says anything at all.
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
