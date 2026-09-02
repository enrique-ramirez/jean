import { tagKey } from "@/domain/track/fields";
import type { Album } from "./albums";

// Artists, aggregated off the album pass rather than off the rows: an artist is
// their records, and everything the front door says about one -- how much of it
// there is, how often it is played, which sleeve stands for it -- is already
// summed per album.
//
// Keyed loosely, because these are counts rather than labels: `5 Seconds Of
// Summer` and `5 Seconds of Summer` are one artist. The name shown is still the
// spelling on the first record found.
// Generic in the album, so an artist aggregated from covered albums still hands
// back a covered one: the header draws its most played record, and a `cover`
// typed as a bare `Album` would have lost the artwork url on the way through.
export interface Artist<A extends Album = Album> {
	key: string;
	name: string;
	plays: number;
	albumCount: number;
	trackCount: number;
	// The artist's most played record, which is the sleeve that stands for them.
	// Jean has no artist images and will not get any -- the obvious source sends
	// no CORS header -- so a cover is the only picture there is.
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

// The one this library is *about*, or null where the player keeps no play
// counts. Not "the one with the most records": that is a fact about how a
// collection was filled rather than about what is listened to, and a card
// captioned "most played" has to mean it.
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
