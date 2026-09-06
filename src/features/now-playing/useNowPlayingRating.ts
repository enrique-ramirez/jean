import { useCallback } from "react";

import { isWritableScale, rawRatingOfValue } from "@/domain/track/rating";
import { useTagWriting } from "@/domain/track/useTagWriter";
import { NOW_PLAYING_FIELD } from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

/**
 * What the playing track's rating is, and the one way to change it. The stars on the screen, the `⋯` menu and the `0`-`5` keys all reach it here, so which scales may be written and what a write does to the query cannot come to disagree between them.
 *
 * The playing track has no row to overlay, so the write patches the now-playing query rather than `ratingStore`.
 */
export function useNowPlayingRating() {
	const { canRate, rateTrack } = useTagWriting();
	const { track, details, setRating } = useNowPlayingTrack();

	const raw =
		details === null
			? null
			: rawRatingOfValue(details.row[NOW_PLAYING_FIELD.rating]);

	// One gate for every control here. A rating on another scale would be rescaled on write, so it is read-only -- asked per track, since one library holds several taggers' conventions. And until the player has answered with this track's rating there is nothing for an optimistic patch to stand on, so five empty stars would be a guess rather than a readout.
	const canWrite =
		canRate && track !== null && details !== null && isWritableScale(raw);

	const write = useCallback(
		(stars: number | null) => {
			if (!canWrite || !track || !details) return;
			const before = details.row[NOW_PLAYING_FIELD.rating];
			setRating(stars === null ? "" : String(stars));
			rateTrack(track, track.title, stars, () => setRating(before));
		},
		[canWrite, track, details, setRating, rateTrack],
	);

	return { raw, canWrite, write };
}
