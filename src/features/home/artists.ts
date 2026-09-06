import { tagKey } from "@/domain/track/fields";
import type { Album } from "./albums";

export interface Artist<A extends Album = Album> {
	key: string;
	name: string;
	plays: number;
	albumCount: number;
	trackCount: number;
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
