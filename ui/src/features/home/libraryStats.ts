import type { CoveredAlbum } from "@/domain/track/albums";
import type { TrackRows } from "@/domain/track/project";
import { summarise } from "@/domain/track/stats";
import { type AlbumArtist, albumArtistsOf, mostPlayed } from "./artists";

const GENRE_BARS = 14;

export function libraryStats({
	rows,
	albums,
}: {
	rows: TrackRows;
	albums: CoveredAlbum[];
}) {
	const artists: AlbumArtist<CoveredAlbum>[] = albumArtistsOf(albums);

	return {
		...summarise(rows, 0, { genres: GENRE_BARS }),
		albumCount: albums.length,
		artistCount: artists.length,
		topAlbum: mostPlayed(albums),
		topArtist: mostPlayed(artists),
	};
}

export type LibraryStats = ReturnType<typeof libraryStats>;
