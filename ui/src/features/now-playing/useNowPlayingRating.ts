import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { playingTrackPaint } from "@/domain/track/playingRating";
import { isWritableScale, rawRatingOfValue } from "@/domain/track/rating";
import { isStreamPath } from "@/domain/track/trackPath";
import { RATING_FIELD, useTagWriting } from "@/domain/track/useTagWriter";
import { useNowPlayingTrack } from "./useNowPlayingTrack";

const isLocalPath = (path: string | null) =>
	path !== null && !isStreamPath(path);

export function useNowPlayingRating() {
	const { hasWritableAddress, writableAddress, rateTrack } = useTagWriting();
	const { track, addresses, details, activeItem } = useNowPlayingTrack();
	const queryClient = useQueryClient();

	const isLocalFile = track !== null && isLocalPath(track.path);

	const raw = details === null ? null : rawRatingOfValue(details.rating);

	const title = track?.title ?? null;
	const canWrite =
		isLocalFile &&
		details !== null &&
		isWritableScale(raw) &&
		hasWritableAddress(RATING_FIELD, addresses);

	const write = useCallback(
		(stars: number | null) => {
			if (!canWrite || title === null || activeItem === null) return;

			const writable = writableAddress(RATING_FIELD, addresses);
			if (!writable) return;

			rateTrack(
				writable,
				title,
				stars,
				playingTrackPaint(queryClient, activeItem),
			);
		},
		[
			canWrite,
			title,
			addresses,
			activeItem,
			writableAddress,
			queryClient,
			rateTrack,
		],
	);

	return { raw, isLocalFile, canWrite, write };
}
