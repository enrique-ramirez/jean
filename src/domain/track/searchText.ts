import type { TrackColumns } from "@/shared/api/types";
import { fold } from "@/shared/lib/text";
import { FIELD, sameTagValue, value } from "./fields";

// One folded haystack per row, so a keystroke costs a single includes() rather
// than several case conversions. It is a per-track-unique string -- the thing
// the loading rules say not to hold -- so it is only built for a list somebody
// is actually searching.
//
// The album artist is merged in only when it differs from the track artist. On
// most rows it is the same string twice, and at library size that repetition is
// the difference between an index worth keeping and one worth regretting.
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
