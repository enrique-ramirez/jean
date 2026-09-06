import { useCallback } from "react";

import { isWritableScale, rawRatingWith } from "./rating";
import { writtenRatingOf } from "./ratingStore";
import { ratingLayer, ratingTarget } from "./ratingTarget";
import { useTagWriting } from "./useTagWriter";

// `0`-`5` from anywhere: what a layer over the list is showing, else the cursor row when a track list is on screen, else the playing track. The cursor wins over the playing track because it is the marked row, and `N` moves it to the playing track.
// `ratePlaying` is passed in rather than resolved here: rating the playing track means reading the copy that is audible and the scale it is on, and the now-playing screen already answers both. A second answer in this tier would be the one that drifts.
export function useRateShortcut(ratePlaying: (stars: number | null) => void) {
	const { canRate, rate } = useTagWriting();

	return useCallback(
		(stars: number) => {
			if (!canRate) return;
			const value = stars === 0 ? null : stars;

			// A layer over the list rates the track it draws: the cursor row is behind it, and its stars are not the ones on screen.
			const rateOnLayer = ratingLayer();
			if (rateOnLayer) {
				rateOnLayer(value);
				return;
			}

			const target = ratingTarget();
			if (target) {
				// Read-only scales are read-only however the rating is reached: a shortcut that quietly rescaled a 100 would be worse than the click that cannot, since no pointer is over the row to see it.
				const raw = rawRatingWith(target.row, writtenRatingOf(target.row));
				if (isWritableScale(raw)) rate(target, value);
				return;
			}

			ratePlaying(value);
		},
		[canRate, rate, ratePlaying],
	);
}
