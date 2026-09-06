import type { TrackColumns } from "@/shared/api/types";
import { fold } from "@/shared/lib/text";
import { FIELD, sameTagValue, value } from "./fields";

export function rowHaystack(row: TrackColumns) {
	const artist = value(row, FIELD.artist);
	const albumArtist = value(row, FIELD.albumArtist);

	return fold(
		[
			value(row, FIELD.title),
			artist,
			sameTagValue(artist, albumArtist) ? null : albumArtist,
			value(row, FIELD.album),
		]
			.filter(Boolean)
			.join(" "),
	);
}
