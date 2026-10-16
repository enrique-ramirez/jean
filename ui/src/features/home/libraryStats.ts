import {
	type AlbumArtist,
	albumArtistsOf,
	mostPlayed,
} from "@/domain/artist/albumArtists";
import type { Album, CoveredAlbum } from "@/domain/track/albums";
import type { TrackRows } from "@/domain/track/project";
import { summarise } from "@/domain/track/stats";

const GENRE_BARS = 14;

export function libraryStats({
	rows,
	albums,
}: {
	rows: TrackRows;
	albums: Album[];
}) {
	const artists: AlbumArtist[] = albumArtistsOf(albums);

	return {
		...summarise(rows, 0, { genres: GENRE_BARS }),
		albumCount: albums.length,
		artistCount: artists.length,
		topAlbum: mostPlayed(albums),
		topArtist: mostPlayed(artists),
	};
}

export type LibraryStats = ReturnType<typeof libraryStats>;

export const coveredStats = (
	stats: LibraryStats,
	cover: (album: Album) => CoveredAlbum,
) => ({
	...stats,
	topAlbum: stats.topAlbum && cover(stats.topAlbum),
	topArtist: stats.topArtist && {
		...stats.topArtist,
		cover: cover(stats.topArtist.cover),
	},
});

export type CoveredStats = ReturnType<typeof coveredStats>;
