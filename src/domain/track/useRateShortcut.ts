import { useCallback } from "react";

import { usePlayer } from "@/domain/player/usePlayer";
import { readTrack } from "@/shared/api/beefweb";
import { isWritableScale, rawRatingOf, rawRatingOfValue } from "./rating";
import { writtenRatingOf } from "./ratingStore";
import { ratingTarget } from "./ratingTarget";
import { useTagWriting } from "./useTagWriter";

// `0`-`5` from anywhere: the cursor row when a track list is on screen, the playing track otherwise. The cursor wins because it is the marked row, and `N` moves it to the playing track.
export function useRateShortcut() {
	const { canRate, rate, rateTrack } = useTagWriting();
	const { data: snapshot } = usePlayer();

	return useCallback(
		(stars: number) => {
			if (!canRate) return;
			const value = stars === 0 ? null : stars;

			const target = ratingTarget();
			if (target) {
				// Read-only scales are read-only however the rating is reached: a shortcut that quietly rescaled a 100 would be worse than the click that cannot, since no pointer is over the row to see it.
				const written = writtenRatingOf(target.row);
				const raw =
					written === undefined
						? rawRatingOf(target.row)
						: rawRatingOfValue(written);
				if (isWritableScale(raw)) rate(target, value);
				return;
			}

			const track = readTrack(snapshot?.player);
			if (!track?.path) return;
			rateTrack(track, track.title, value);
		},
		[canRate, rate, rateTrack, snapshot],
	);
}
