import { columnReader, FIELD, readNumber, value } from "@/domain/track/fields";
import type { TrackRows } from "@/domain/track/project";
import type { Translate } from "@/shared/i18n/locale";

export interface TopTrack {
	ref: number;
	title: string;
	artist: string | null;
	plays: number;
	artworkUrl: string | null;
}

export function topTracksOf(
	rows: TrackRows,
	limit: number,
	artworkUrl: (ref: number) => string | null,
	t: Translate,
): TopTrack[] {
	const playsOf = columnReader(rows.columns, FIELD.playCount, readNumber);

	const played: { position: number; plays: number }[] = [];
	for (let position = 0; position < rows.length; position += 1) {
		const plays = playsOf(rows.ref(position)) ?? 0;
		if (plays > 0) played.push({ position, plays });
	}

	return played
		.sort((a, b) => b.plays - a.plays)
		.slice(0, limit)
		.map(({ position, plays }) => {
			const row = rows.at(position);
			return {
				ref: rows.ref(position),
				title: value(row, FIELD.title) ?? t("track.unknownTitle"),
				artist: value(row, FIELD.artist) ?? value(row, FIELD.albumArtist),
				plays,
				artworkUrl: artworkUrl(rows.ref(position)),
			};
		});
}
