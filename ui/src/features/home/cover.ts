import { coverKey } from "@/domain/track/fields";
import { libraryArtworkUrl } from "@/shared/api/artwork";
import type { SummaryAlbum } from "@/shared/api/librarySummary";

export interface CoveredAlbum extends SummaryAlbum {
	artworkUrl: string | null;
	identity: string;
}

export const covered = (
	origin: string | null,
	album: SummaryAlbum,
): CoveredAlbum => ({
	...album,
	artworkUrl:
		album.cover === null ? null : libraryArtworkUrl(origin, album.cover),
	identity: coverKey(album.artist, album.album),
});
