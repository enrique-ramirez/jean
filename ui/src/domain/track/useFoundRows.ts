import { useMemo } from "react";
import { useSetRows, useWatchedWhole } from "@/domain/library/useLibrary";
import type { TrackRows } from "./project";
import type { FinderOver } from "./useFound";
import { usePlaylistSetRows } from "./usePlaylistItems";

const NO_LIBRARY = { windowed: null, structure: 0, origin: null } as const;

export function useFoundRows(
	over: FinderOver | null,
	rows: TrackRows,
	results: number[],
): TrackRows {
	const library = over?.kind === "library" ? over : null;
	const playlist = over?.kind === "playlist" ? over : null;

	const ordinals = useMemo(
		() =>
			library && results.length > 0
				? Int32Array.from(results, (position) => rows.ref(position))
				: null,
		[library, rows, results],
	);
	const libraryRows = useSetRows(library ?? NO_LIBRARY, "finder", ordinals, {
		isBeside: true,
	});

	const positions = useMemo(
		() => (playlist && results.length > 0 ? Int32Array.from(results) : null),
		[playlist, results],
	);
	const playlistRows = usePlaylistSetRows(
		playlist?.windowed ?? null,
		playlist?.structure ?? null,
		positions,
	);

	const found = library ? libraryRows : playlistRows;
	useWatchedWhole(found);
	return found;
}
