import { FIELD, number, value } from "@/domain/track/fields";
import type { TrackColumns } from "@/shared/api/types";

// Not named `topTracks.ts`: a case-insensitive filesystem cannot tell it from `TopTracks.tsx`, and `'./TopTracks'` would resolve to whichever the compiler probes first.
export interface TopTrack {
	ref: number;
	title: string;
	artist: string | null;
	plays: number;
	artworkUrl: string;
}

/** The most played tracks. Rows with no play count are dropped rather than sorted last, so a player that keeps no statistics yields an empty list. */
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
