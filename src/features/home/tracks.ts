import { FIELD, playCountOf, value } from "@/domain/track/fields";
import type { TrackColumns } from "@/shared/api/types";
import type { Translate } from "@/shared/i18n/locale";

// Not named `topTracks.ts`: a case-insensitive filesystem cannot tell it from `TopTracks.tsx`, and `'./TopTracks'` would resolve to whichever the compiler probes first.
export interface TopTrack {
	ref: number;
	title: string;
	artist: string | null;
	plays: number;
	artworkUrl: string;
}

export function topTracksOf(
	rows: TrackColumns[],
	limit: number,
	artworkUrl: (ref: number) => string,
	t: Translate,
): TopTrack[] {
	const played = rows.reduce<{ ref: number; plays: number }[]>(
		(into, row, ref) => {
			const plays = playCountOf(row) ?? 0;
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
			title: value(rows[ref], FIELD.title) ?? t("track.unknownTitle"),
			artist:
				value(rows[ref], FIELD.artist) ?? value(rows[ref], FIELD.albumArtist),
			plays,
			artworkUrl: artworkUrl(ref),
		}));
}
