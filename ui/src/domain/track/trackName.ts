import type { SessionReport } from "@/shared/api/sessions";
import { FIELD, value } from "./fields";
import { rowAt } from "./libraryColumns";
import { afterLastSeparator } from "./pathTable";
import { componentLibraryKey, playlistSnapshot } from "./playlistEntries";

type PlayedTrack = Pick<SessionReport, "path" | "subsong" | "libraryPath">;

// Linear in the library: `foo_jean` reports only a track a session could not decode, and keeps at
// most eight reports a session, so a pass is rare and holds nothing past the call.
function libraryTitleOf(
	origin: string,
	libraryPath: string,
	subsong: number,
): string | null {
	const { paths, subsongs, columns } = playlistSnapshot(
		componentLibraryKey(origin),
	);
	if (!paths || !subsongs) return null;
	for (let row = 0; row < paths.length; row += 1)
		if (subsongs[row] === subsong && paths.at(row) === libraryPath)
			return value(rowAt(columns, row), FIELD.title);
	return null;
}

const fileNameOf = (path: string) => path.slice(afterLastSeparator(path));

export const nameOfTrack = (origin: string | null, track: PlayedTrack) =>
	(origin !== null && track.libraryPath !== null
		? libraryTitleOf(origin, track.libraryPath, track.subsong)
		: null) ?? fileNameOf(track.path);
