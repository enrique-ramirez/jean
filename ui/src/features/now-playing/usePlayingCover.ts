import {
	playingArtwork,
	usePlayingLibrary,
} from "@/domain/library/usePlayingLibrary";
import { coverKey } from "@/domain/track/fields";
import { playingArtworkUrl } from "@/shared/api/artwork";
import type { ActiveItem, NowPlayingTrack } from "@/shared/api/types";

// `identity` is the key the playing cover is held under, and `src` is where it is fetched from.
export function usePlayingCover(
	track: NowPlayingTrack | null,
	item: ActiveItem | null | undefined,
	origin: string | null,
): { identity: string | undefined; src: string | null } {
	const playingLibrary = usePlayingLibrary();
	if (!track) return { identity: undefined, src: null };

	const album = item?.album ?? null;
	const credited = item?.albumArtist || item?.columns[0] || null;
	return {
		identity: album
			? coverKey(credited, album)
			: coverKey(track.artist, track.title, "track"),
		src: playingArtwork(playingLibrary, playingArtworkUrl(origin)),
	};
}
