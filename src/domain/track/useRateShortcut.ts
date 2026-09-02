import { useCallback } from "react";

import { usePlayer } from "@/domain/player/usePlayer";
import { readTrack } from "@/shared/api/beefweb";
import { isWritableScale, rawRatingOf, rawRatingOfValue } from "./rating";
import { writtenRatingOf } from "./ratingStore";
import { ratingTarget } from "./ratingTarget";
import { useTagWriting } from "./useTagWriter";

// `0`-`5` from anywhere, resolving what they act on: the cursor row when a track
// list is on screen, and the playing track otherwise. One question with one
// answer, rather than the same six keys declared in two scopes.
//
// The cursor wins because it is the thing you are looking at and it is marked on
// screen. `N` moves the cursor to the playing track, so rating what is playing
// while a list is open is two keys rather than a special case.
export function useRateShortcut() {
	const { canRate, rate, rateTrack } = useTagWriting();
	const { data: snapshot } = usePlayer();

	return useCallback(
		(stars: number) => {
			if (!canRate) return;
			const value = stars === 0 ? null : stars;

			const target = ratingTarget();
			if (target) {
				// Read-only scales are read-only however the rating is reached. A
				// keyboard shortcut that quietly rescaled a `100` would be worse than
				// the click that cannot: there is no pointer over the row to see it.
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
