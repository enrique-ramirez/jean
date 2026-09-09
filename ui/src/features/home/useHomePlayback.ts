import { useCallback } from "react";
import type { Library } from "@/domain/library/useLibrary";
import { usePlaySet } from "@/domain/library/usePlaySet";
import { usePlaybackOrder } from "@/domain/player/usePlayer";
import type { Album } from "@/domain/track/albums";
import { SCRATCH_KIND } from "@/domain/track/jeanPlaylists";
import type { Refs } from "@/domain/track/project";
import type { PlaylistInfo } from "@/shared/api/types";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { type FilledShelf, refsOfShelf } from "./shelves";

export function useHomePlayback({
	library,
	playlists,
	navigate,
}: {
	library: Library;
	playlists: PlaylistInfo[];
	navigate: (to: string) => void;
}) {
	const t = useTranslate();
	const { play, canPlaySets } = usePlaySet({ library, playlists });
	const order = usePlaybackOrder();

	const playShelf = useCallback(
		async (shelf: FilledShelf<Album>, album: Album) => {
			const refs = refsOfShelf(shelf);
			const position = Math.max(0, refs.indexOf(album.refs[0]));

			navigate(`/shelf/${shelf.id}`);
			await play({
				kind: SCRATCH_KIND.shelf,
				label: t(shelf.title),
				refs,
				position,
			});
		},
		[play, navigate, t],
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

	const playTrack = useCallback(
		(refs: Refs, ref: number) =>
			startEverything(refs, Math.max(0, refs.indexOf(ref))),
		[startEverything],
	);

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
