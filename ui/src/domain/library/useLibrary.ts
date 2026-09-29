import { useMemo } from "react";
import { librarySourceOf } from "@/domain/track/librarySource";
import type { PathTable } from "@/domain/track/pathTable";
import {
	componentLibraryKey,
	EMPTY_PLAYLIST,
	generationKey,
} from "@/domain/track/playlistStore";
import { useComponentLibraryItems } from "@/domain/track/usePlaylistItems";
import { libraryOrigin } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import type { LibraryStatus } from "./libraryStatus";

export function useLibrary() {
	const { discovery, isDiscovered, recheck } = useFooJean();

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

	const status: LibraryStatus = !isDiscovered
		? { kind: "checking" }
		: discovery.state.kind === "unreachable"
			? { kind: "unreachable" }
			: !discovery.state.capabilities.canReadLibrary
				? { kind: "olderPlayer" }
				: library.failure
					? { kind: "failed", failure: library.failure }
					: library.isLoading || library === EMPTY_PLAYLIST
						? {
								kind: "reading",
								loaded: library.loaded,
								total: library.total,
							}
						: { kind: "ready" };

	return {
		...library,
		snapshot: library,
		key,
		source,
		status,
		recheck,
		origin,
	};
}

export type Library = ReturnType<typeof useLibrary>;
