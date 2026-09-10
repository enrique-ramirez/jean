import { useCallback } from "react";

import { rowAt } from "./libraryColumns";
import { isWritableScale, rawRatingWith } from "./rating";
import { writtenRatingOf } from "./ratingStore";
import { ratingLayer, ratingTarget } from "./ratingTarget";
import { useTagWriting } from "./useTagWriter";

export function useRateShortcut(ratePlaying: (stars: number | null) => void) {
	const { canRate, rate } = useTagWriting();

	return useCallback(
		(stars: number) => {
			if (!canRate) return;
			const value = stars === 0 ? null : stars;

			const rateOnLayer = ratingLayer();
			if (rateOnLayer) {
				rateOnLayer(value);
				return;
			}

			const target = ratingTarget();
			if (target) {
				const raw = rawRatingWith(
					rowAt(target.columns, target.ref),
					writtenRatingOf(target.columns, target.ref),
				);
				if (isWritableScale(raw)) rate(target, value);
				return;
			}

			ratePlaying(value);
		},
		[canRate, rate, ratePlaying],
	);
}
