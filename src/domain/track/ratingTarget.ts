import type { RateTarget } from "./useTagWriter";

let target: RateTarget | null = null;

let rateOnLayer: ((stars: number | null) => void) | null = null;

export const setRatingTarget = (next: RateTarget | null) => {
	target = next;
};

export const ratingTarget = () => target;

export const setRatingLayer = (
	next: ((stars: number | null) => void) | null,
) => {
	rateOnLayer = next;
};

export const ratingLayer = () => rateOnLayer;
