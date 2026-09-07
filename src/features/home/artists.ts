import type { Album } from "@/domain/track/albums";
import { tagKey } from "@/domain/track/fields";

export interface AlbumArtist<A extends Album = Album> {
	key: string;
	name: string;
	plays: number;
	albumCount: number;
	trackCount: number;
	cover: A;
}

const blank = <A extends Album>(key: string, album: A): AlbumArtist<A> => ({
	key,
	name: album.artist,
	plays: 0,
	albumCount: 0,
	trackCount: 0,
	cover: album,
});

// Keyed on an album's own artist tag, not the artist index: a doubled tag like `Foo Fighters, Foo
// Fighters` becomes two entries here. `domain/track/artists.ts` reads credits per track instead;
// use that one where the count has to be right about who an artist is.
export function albumArtistsOf<A extends Album>(albums: A[]): AlbumArtist<A>[] {
	const byKey = albums.reduce((into, album) => {
		const key = tagKey(album.artist);
		const artist = into.get(key) ?? blank(key, album);

		artist.plays += album.plays;
		artist.albumCount += 1;
		artist.trackCount += album.trackCount;
		if (album.plays > artist.cover.plays) artist.cover = album;

		into.set(key, artist);
		return into;
	}, new Map<string, AlbumArtist<A>>());

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
