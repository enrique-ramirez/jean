import { fetchPlaylistRows } from "@/shared/api/playlists";
import { fetchLibraryTrack } from "@/shared/api/tracks";
import type { TrackAddress, TrackColumns } from "@/shared/api/types";

export async function readTrackColumns(
	origin: string,
	address: TrackAddress,
	columns: readonly string[],
) {
	const answer =
		address.kind === "playlist"
			? await fetchPlaylistRows(
					origin,
					address.playlist,
					{ offset: address.index, count: 1 },
					columns,
				)
			: await fetchLibraryTrack(origin, address, columns);
	if (!answer.ok) return answer;

	const row: TrackColumns | undefined =
		"items" in answer.value
			? answer.value.items[0]?.columns
			: answer.value.columns;
	return { ok: true as const, columns: row ?? null };
}
