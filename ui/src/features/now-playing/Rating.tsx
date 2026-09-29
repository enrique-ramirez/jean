import { useEffect } from "react";
import { MAX_STARS, starsOf, toStars } from "@/domain/track/rating";
import { setRatingLayer } from "@/domain/track/ratingTarget";
import { Stars, StarsInput } from "@/shared/ui/Stars";
import { useNowPlayingRating } from "./useNowPlayingRating";

export function Rating() {
	const { raw, isLocalFile, canWrite, write } = useNowPlayingRating();

	useEffect(() => {
		setRatingLayer(write);
		return () => setRatingLayer(null);
	}, [write]);

	if (!isLocalFile) return null;

	const rating = starsOf(raw);
	const stars = rating === null ? 0 : toStars(rating);
	const label = rating === null ? "Unrated" : `${stars} of ${MAX_STARS} stars`;

	if (!canWrite) return <Stars value={stars} label={label} />;

	return <StarsInput value={stars} label={label} onRate={write} />;
}
