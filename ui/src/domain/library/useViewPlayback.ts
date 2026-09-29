import { useCallback } from "react";
import type { ScratchKind } from "@/domain/track/jeanPlaylists";
import type { Refs } from "@/domain/track/project";
import type { PlaylistInfo } from "@/shared/api/types";
import { useActivePosition } from "./useActivePosition";
import type { Library } from "./useLibrary";
import { usePlaySet } from "./usePlaySet";

export function useViewPlayback({
	library,
	playlists,
	kind,
	label,
	indices,
}: {
	library: Library;
	playlists: PlaylistInfo[];
	kind: ScratchKind;
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
