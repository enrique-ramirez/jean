import { FIELD, number, value } from "@/domain/track/fields";
import type { TrackColumns } from "@/shared/api/types";

// Not `topTracks.ts`, beside `TopTracks.tsx`: a case-insensitive filesystem
// cannot tell the two apart, so `'./TopTracks'` resolves to whichever the
// compiler probes first and the import lands silently on the wrong one. The
// same family as naming a store after the component beside it -- see the root
// CLAUDE.md. It sits with `albums.ts` and `artists.ts` instead, which is where
// it belonged anyway.
//
// A ranked list rather than a shelf of covers, and that is the point of it:
// GrooveGraph's top-tracks column is ten rows in the space one row of sleeves
// takes, and a numbered list needs no artist photograph -- which Jean does not
// have and is not going to get.
export interface TopTrack {
	ref: number;
	title: string;
	artist: string | null;
	plays: number;
	artworkUrl: string;
}

// Unlike an album, a track is a single row, so there is nothing to average and
// nothing to reconcile: the play count is the play count. Rows with none are
// dropped rather than sorted to the bottom -- a library the player keeps no
// statistics for gets no list at all, by the same rule the shelves follow.
export function topTracksOf(
	rows: TrackColumns[],
	limit: number,
	artworkUrl: (ref: number) => string,
): TopTrack[] {
	const played = rows.reduce<{ ref: number; plays: number }[]>(
		(into, row, ref) => {
			const plays = number(row, FIELD.playCount) ?? 0;
			if (plays > 0) into.push({ ref, plays });
			return into;
		},
		[],
	);

	return played
		.sort((a, b) => b.plays - a.plays)
		.slice(0, limit)
		.map(({ ref, plays }) => ({
			ref,
			title: value(rows[ref], FIELD.title) ?? "Unknown track",
			artist:
				value(rows[ref], FIELD.artist) ?? value(rows[ref], FIELD.albumArtist),
			plays,
			artworkUrl: artworkUrl(ref),
		}));
}
