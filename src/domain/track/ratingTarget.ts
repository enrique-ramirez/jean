import type { RateTarget } from "./useTagWriter";

// What a rating shortcut acts on when a track list is on screen. Read imperatively from a key handler rather than subscribed to, so nothing re-renders when the cursor moves.
let target: RateTarget | null = null;

// The list stays mounted under the now-playing screen, so without this the digits would rate the cursor row behind the layer -- silently, since a successful rating says nothing, and invisibly, since on a compact viewport that row is off screen altogether.
// Published whatever the layer will do with the value, so a rating it refuses is refused here rather than falling through to the row.
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
