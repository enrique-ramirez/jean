import { useCallback } from "react";
import type { ScratchKind } from "@/domain/track/jeanPlaylists";
import type { LibrarySource } from "@/domain/track/librarySource";
import { type Refs, wholeRefs } from "@/domain/track/project";
import type { PlaylistInfo } from "@/shared/api/types";
import { useActivePosition } from "./useActivePosition";
import type { Library } from "./useLibrary";
import { usePlaySet } from "./usePlaySet";

export function useViewPlayback({
	library,
	source = library.source,
	playlists,
	kind,
	label,
	indices,
	length = indices?.length ?? 0,
}: {
	library: Library;
	source?: Extract<LibrarySource, { kind: "library" }>;
	playlists: PlaylistInfo[];
	kind: ScratchKind;
	label: string | null;
	indices: Refs | null;
	length?: number;
}): {
	playAt: (position: number) => Promise<unknown>;
	activeIndex: number;
	scratch: ReturnType<typeof usePlaySet>["scratch"];
	holdsThisView: boolean;
	canPlaySets: boolean;
} {
	const { play, scratch, canPlaySets } = usePlaySet({ source, playlists });

	const holdsThisView = scratch.holdsView(kind, label, length);

	const activeIndex = useActivePosition({
		source,
		indices,
		scratch,
		holdsThisView,
	});

	const playAt = useCallback(
		(position: number) =>
			play({
				kind,
				label,
				refs: indices ?? wholeRefs(length),
				position,
			}),
		[play, kind, label, indices, length],
	);

	return {
		playAt,
		activeIndex,
		scratch,
		holdsThisView,
		canPlaySets,
	};
}
