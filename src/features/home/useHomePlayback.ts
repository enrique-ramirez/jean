import { useCallback } from "react";
import type { Library } from "@/domain/library/useLibrary";
import { usePlaySet } from "@/domain/library/usePlaySet";
import { usePlaybackOrder } from "@/domain/player/usePlayer";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import type { Refs } from "@/domain/track/project";
import type { PlaylistInfo } from "@/shared/api/types";
import type { Album } from "./albums";
import { type FilledShelf, refsOfShelf } from "./shelves";

// The two things the home screen can start. Both navigate as well as play, to the view of the set they started.
export function useHomePlayback({
	library,
	playlists,
	navigate,
}: {
	library: Library;
	playlists: PlaylistInfo[];
	navigate: (to: string) => void;
}) {
	const { play, canPlaySets } = usePlaySet({ library, playlists });
	const order = usePlaybackOrder();

	// Clicking an album plays the shelf, starting at that album: playing the album alone leaves playback falling out into whatever the player finds next.
	const playShelf = useCallback(
		async (shelf: FilledShelf<Album>, album: Album) => {
			const refs = refsOfShelf(shelf);
			const position = Math.max(0, refs.indexOf(album.refs[0]));

			// Navigate first: the fill is a round trip, and the view it opens already follows whatever ends up playing.
			navigate(`/shelf/${shelf.id}`);
			await play({
				kind: SCRATCH_KIND.shelf,
				label: shelf.title,
				refs,
				position,
			});
		},
		[play, navigate],
	);

	const startEverything = useCallback(
		async (refs: Refs, position: number) => {
			if (refs.length === 0) return;
			navigate("/all");
			await play({ kind: SCRATCH_KIND.all, label: "", refs, position });
		},
		[play, navigate],
	);

	const playEverything = useCallback(
		(refs: Refs) => startEverything(refs, 0),
		[startEverything],
	);

	// The position is searched for rather than assumed equal to the ref: the whole library happens to be ascending, and anything else passed here would not be.
	const playTrack = useCallback(
		(refs: Refs, ref: number) =>
			startEverything(refs, Math.max(0, refs.indexOf(ref))),
		[startEverything],
	);

	// The mode first, then a track. Play never turns shuffle back off: playback order is global player state and the status bar owns it.
	const shuffleEverything = useCallback(
		(refs: Refs) => {
			if (refs.length === 0) return undefined;
			order.enableShuffle();
			return startEverything(refs, Math.floor(Math.random() * refs.length));
		},
		[startEverything, order],
	);

	return {
		playShelf,
		playTrack,
		playEverything,
		shuffleEverything,
		canPlay: canPlaySets,
		canShuffle: order.canShuffle && canPlaySets,
	};
}
