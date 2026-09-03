import type { RateTarget } from "./useTagWriter";

// What a rating shortcut acts on when a track list is on screen. Read imperatively from a key handler rather than subscribed to, so nothing re-renders when the cursor moves.
let target: RateTarget | null = null;

export const setRatingTarget = (next: RateTarget | null) => {
	target = next;
};

export const ratingTarget = () => target;
