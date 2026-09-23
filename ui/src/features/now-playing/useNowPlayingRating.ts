import { useCallback } from "react";

import { isWritableScale, rawRatingOfValue } from "@/domain/track/rating";
import { RATING_FIELD, useTagWriting } from "@/domain/track/useTagWriter";
import { NOW_PLAYING_FIELD } from "./nowPlayingFields";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

const isLocalPath = (path: string | null) =>
	path !== null && !path.includes("://");

export function useNowPlayingRating() {
	const { hasWritableAddress, writableAddress, rateTrack } = useTagWriting();
	const { track, addresses, details, setRating, confirmRating, restoreRating } =
		useNowPlayingTrack();

	const isLocalFile = track !== null && isLocalPath(track.path);

	const raw =
		details === null
			? null
			: rawRatingOfValue(details.row[NOW_PLAYING_FIELD.rating]);

	const title = track?.title ?? null;
	const canWrite =
		isLocalFile &&
		details !== null &&
		isWritableScale(raw) &&
		hasWritableAddress(RATING_FIELD, addresses);

	const write = useCallback(
		(stars: number | null) => {
			if (!canWrite || title === null) return;

			const writable = writableAddress(RATING_FIELD, addresses);
			if (!writable) return;

			rateTrack(writable, title, stars, {
				adopt: setRating,
				confirm: confirmRating,
				restore: restoreRating,
			});
		},
		[
			canWrite,
			title,
			addresses,
			writableAddress,
			setRating,
			confirmRating,
			restoreRating,
			rateTrack,
		],
	);

	return { raw, isLocalFile, canWrite, write };
}
