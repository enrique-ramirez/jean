import type { SessionReport } from "@/shared/api/sessions";
import { fetchLibraryTrack } from "@/shared/api/tracks";
import { FIELD, readValue, TRACK_EXPRESSIONS } from "./fields";

type PlayedTrack = Pick<SessionReport, "path" | "subsong" | "libraryPath">;

async function libraryTitleOf(
	origin: string,
	libraryPath: string,
	subsong: number,
): Promise<string | null> {
	const read = await fetchLibraryTrack(
		origin,
		{ kind: "library", track: libraryPath, subsong },
		[TRACK_EXPRESSIONS[FIELD.title]],
	);
	return read.ok ? readValue(read.value.columns[0]) : null;
}

// The player reports library paths forward-slashed and its own paths with the platform separator, so
// the split takes whichever came last rather than a configured one.
const afterLastSeparator = (path: string) =>
	Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;

const fileNameOf = (path: string) => path.slice(afterLastSeparator(path));

export const nameOfTrack = async (
	origin: string | null,
	track: PlayedTrack,
): Promise<string> =>
	(origin !== null && track.libraryPath !== null
		? await libraryTitleOf(origin, track.libraryPath, track.subsong)
		: null) ?? fileNameOf(track.path);
