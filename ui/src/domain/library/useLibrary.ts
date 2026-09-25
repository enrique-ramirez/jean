import { useMemo } from "react";
import { librarySourceOf } from "@/domain/track/librarySource";
import type { PathTable } from "@/domain/track/pathTable";
import {
	componentLibraryKey,
	generationKey,
} from "@/domain/track/playlistStore";
import { useComponentLibraryItems } from "@/domain/track/usePlaylistItems";
import { libraryOrigin } from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";

export function useLibrary() {
	const { discovery } = useFooJean();

	const origin = libraryOrigin(discovery);

	const library = useComponentLibraryItems(origin);

	const key = origin
		? generationKey(componentLibraryKey(origin), library.structure)
		: null;

	const source = useMemo(
		() =>
			librarySourceOf({
				kind: "library",
				paths: library.paths as PathTable,
				subsongs: library.subsongs as Int32Array,
				artworkOrigin: origin,
			}),
		[library.paths, library.subsongs, origin],
	);

	return {
		...library,
		snapshot: library,
		key,
		source,
	};
}

export type Library = ReturnType<typeof useLibrary>;
