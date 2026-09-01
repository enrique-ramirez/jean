import type { TrackColumns } from "../api/types";
import { clamp } from "../ui/math";
import { FIELD, number, timestamp } from "./fields";

// How long since a track was last played before it reads as fully faded.
const PATINA_YEARS = 6;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// Play count and recency, precomputed into typed arrays.
//
// Heat is logarithmic because play counts are heavily skewed: on a linear scale
// almost every track sits at zero and one outlier takes the whole range. Patina
// applies only to tracks that were played at all -- a never-played track is
// flat, not faded, and dimming it would say something untrue about it.
export function deriveIntensity(rows: TrackColumns[]) {
	const playCounts = Int32Array.from(
		rows,
		(row) => number(row, FIELD.playCount) ?? 0,
	);

	const maxPlayCount = playCounts.reduce(
		(most, plays) => Math.max(most, plays),
		0,
	);
	const ceiling = Math.log1p(maxPlayCount);
	const now = Date.now();

	const heat = Float32Array.from(playCounts, (plays) =>
		plays > 0 && ceiling > 0 ? Math.log1p(plays) / ceiling : 0,
	);

	const patina = Float32Array.from(rows, (row, index) => {
		if (playCounts[index] <= 0) return 0;
		const lastPlayed = timestamp(row, FIELD.lastPlayed);
		return lastPlayed === null
			? 0
			: clamp((now - lastPlayed) / YEAR_MS / PATINA_YEARS, 0, 1);
	});

	return {
		heat,
		patina,
		playedCount: playCounts.reduce(
			(played, plays) => played + (plays > 0 ? 1 : 0),
			0,
		),
	};
}
