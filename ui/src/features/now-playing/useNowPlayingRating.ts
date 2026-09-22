import { useCallback } from "react";

import { isWritableScale, rawRatingOfValue } from "@/domain/track/rating";
import { useTagWriting } from "@/domain/track/useTagWriter";
import { NOW_PLAYING_FIELD } from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

const isLocalPath = (path: string | null) =>
	path !== null && !path.includes("://");

export function useNowPlayingRating() {
	const { canRate, rateTrack } = useTagWriting();
	const { track, address, details, setRating } = useNowPlayingTrack();

	const isLocalFile = track !== null && isLocalPath(track.path);

	const raw =
		details === null
			? null
			: rawRatingOfValue(details.row[NOW_PLAYING_FIELD.rating]);

	const canWrite =
		canRate &&
		isLocalFile &&
		address !== null &&
		details !== null &&
		isWritableScale(raw);

	const write = useCallback(
		(stars: number | null) => {
			if (!canWrite || !track || !address || !details) return;
			const before = details.row[NOW_PLAYING_FIELD.rating];
			setRating(stars === null ? "" : String(stars));
			rateTrack(address, track.title, stars, {
				adopt: setRating,
				restore: () => setRating(before),
			});
		},
		[canWrite, track, address, details, setRating, rateTrack],
	);

	return { raw, isLocalFile, canWrite, write };
}
