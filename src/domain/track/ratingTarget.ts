import type { RateTarget } from "./useTagWriter";

let target: RateTarget | null = null;

// The list stays mounted under the now-playing screen, so without this the rating shortcuts would
// write to the cursor row behind the layer. Published whatever the layer will do with the value, so
// a rating it refuses is refused here rather than falling through to the row.
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
