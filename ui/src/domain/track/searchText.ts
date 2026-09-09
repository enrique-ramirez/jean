import type { TrackColumns } from "@/shared/api/types";
import { fold } from "@/shared/lib/text";
import { FIELD, sameTagValue, value } from "./fields";

// One string per field, not one joined haystack: ranking scores per field and needs to tell them apart.
export interface RowText {
	title: string;
	artist: string;
	album: string;
}

export function rowText(row: TrackColumns): RowText {
	const artist = value(row, FIELD.artist);
	const albumArtist = value(row, FIELD.albumArtist);

	return {
		title: fold(value(row, FIELD.title) ?? ""),
		artist: fold(
			[artist, sameTagValue(artist, albumArtist) ? null : albumArtist]
				.filter(Boolean)
				.join(" "),
		),
		album: fold(value(row, FIELD.album) ?? ""),
	};
}

// A token never holds a space, so it cannot span two fields; checking them separately is enough.
export const rowMatches = (text: RowText, tokens: string[]) =>
	tokens.every(
		(token) =>
			text.title.includes(token) ||
			text.artist.includes(token) ||
			text.album.includes(token),
	);
