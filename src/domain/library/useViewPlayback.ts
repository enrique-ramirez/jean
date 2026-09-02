import { useCallback } from "react";
import type { Refs } from "@/domain/track/project";
import type { PlaylistInfo } from "@/shared/api/types";
import { useActivePosition } from "./useActivePosition";
import type { Library } from "./useLibrary";
import { usePlaySet } from "./usePlaySet";

// A library view that plays into the scratch playlist: what starts a track, and
// which row of the view the player is on.
//
// These are three questions with one answer between them. `holdsView` decides
// whether the scratch currently *is* this set, `useActivePosition` needs that to
// read the player's index straight off it rather than sweeping every ref, and
// `play` is the thing that makes it true. All three are keyed on the same
// `(kind, label, count)`, so a caller wiring them up itself is a caller that can
// pass three different answers to one question and get a view that marks the
// wrong row.
export function useViewPlayback({
	library,
	playlists,
	kind,
	label,
	indices,
}: {
	library: Library;
	playlists: PlaylistInfo[];
	// What the scratch playlist is named for, and what tells one filled set from
	// another: a shelf, a search, all music.
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
