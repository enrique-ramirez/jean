import { useCallback } from "react";
import type { Refs } from "@/domain/track/project";
import type { PlaylistInfo } from "@/shared/api/types";
import { useActivePosition } from "./useActivePosition";
import type { Library } from "./useLibrary";
import { usePlaySet } from "./usePlaySet";

// A library view that plays into the scratch playlist: what starts a track, and which row of the view the player is on.
// `holdsView`, `useActivePosition` and `play` must be keyed on the same `(kind, label, count)`, so they are wired up here rather than by each caller.
export function useViewPlayback({
	library,
	playlists,
	kind,
	label,
	indices,
}: {
	library: Library;
	playlists: PlaylistInfo[];
	// What the scratch playlist is named for, and what tells one filled set from another: a shelf, a search, all music.
	kind: string;
	label: string | null;
	indices: Refs;
}): {
	playAt: (position: number) => Promise<unknown>;
	activeIndex: number;
	scratch: ReturnType<typeof usePlaySet>["scratch"];
	holdsThisView: boolean;
	canPlaySets: boolean;
} {
	const { play, scratch, canPlaySets } = usePlaySet({ library, playlists });

	const holdsThisView = scratch.holdsView(kind, label, indices.length);

	const activeIndex = useActivePosition({
		source: library.source,
		indices,
		scratch,
		holdsThisView,
	});

	const playAt = useCallback(
		(position: number) => play({ kind, label, refs: indices, position }),
		[play, kind, label, indices],
	);

	return {
		playAt,
		activeIndex,
		scratch,
		holdsThisView,
		canPlaySets,
	};
}
