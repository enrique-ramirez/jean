import { tagKey } from "@/domain/track/fields";
import type { Album } from "./albums";

// Artists, aggregated off the album pass rather than off the rows, since everything said about one is already summed per album.
// Keyed loosely, so `5 Seconds Of Summer` and `5 Seconds of Summer` are one artist; the name shown is the spelling on the first record found.
export interface Artist<A extends Album = Album> {
	key: string;
	name: string;
	plays: number;
	albumCount: number;
	trackCount: number;
	/** The artist's most played record. Jean has no artist images, so a cover is the only picture there is. */
	cover: A;
}

const blank = <A extends Album>(key: string, album: A): Artist<A> => ({
	key,
	name: album.artist,
	plays: 0,
	albumCount: 0,
	trackCount: 0,
	cover: album,
});

export function artistsOf<A extends Album>(albums: A[]): Artist<A>[] {
	const byKey = albums.reduce((into, album) => {
		const key = tagKey(album.artist);
		const artist = into.get(key) ?? blank(key, album);

		artist.plays += album.plays;
		artist.albumCount += 1;
		artist.trackCount += album.trackCount;
		if (album.plays > artist.cover.plays) artist.cover = album;

		into.set(key, artist);
		return into;
	}, new Map<string, Artist<A>>());

	return [...byKey.values()];
}

/** The most played entry, or null where the player keeps no play counts. Not the one with the most records, which is a different claim. */
export const mostPlayed = <T extends { plays: number }>(
	entries: T[],
): T | null =>
	entries.reduce<T | null>(
		(best, entry) =>
			entry.plays > 0 && (best === null || entry.plays > best.plays)
				? entry
				: best,
		null,
	);
