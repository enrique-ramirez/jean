import type { SessionReport } from "@/shared/api/sessions";
import { fetchLibraryTrack } from "@/shared/api/tracks";
import { FIELD, readValue, TRACK_EXPRESSIONS } from "./fields";
import { afterLastSeparator } from "./pathTable";

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

const fileNameOf = (path: string) => path.slice(afterLastSeparator(path));

export const nameOfTrack = async (
	origin: string | null,
	track: PlayedTrack,
): Promise<string> =>
	(origin !== null && track.libraryPath !== null
		? await libraryTitleOf(origin, track.libraryPath, track.subsong)
		: null) ?? fileNameOf(track.path);
