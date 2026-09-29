import { useEffect } from "react";
import { ratingDisplayOf } from "@/domain/track/rating";
import { setRatingLayer } from "@/domain/track/ratingTarget";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Stars, StarsInput } from "@/shared/ui/Stars";
import { useNowPlayingRating } from "./useNowPlayingRating";

export function Rating() {
	const t = useTranslate();
	const { raw, isLocalFile, canWrite, write } = useNowPlayingRating();

	useEffect(() => {
		setRatingLayer(write);
		return () => setRatingLayer(null);
	}, [write]);

	if (!isLocalFile) return null;

	const { stars, label } = ratingDisplayOf(raw, t);

	if (!canWrite) return <Stars value={stars} label={label} />;

	return <StarsInput value={stars} label={label} onRate={write} />;
}
