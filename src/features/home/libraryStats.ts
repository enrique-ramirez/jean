import { summarise } from "@/domain/track/stats";
import type { TrackColumns } from "@/shared/api/types";
import type { CoveredAlbum } from "./albums";
import { type AlbumArtist, albumArtistsOf, mostPlayed } from "./artists";

const GENRE_BARS = 14;

export function libraryStats({
	rows,
	albums,
}: {
	rows: TrackColumns[];
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
