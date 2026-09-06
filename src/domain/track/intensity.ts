import type { TrackColumns } from "@/shared/api/types";
import { clamp } from "@/shared/lib/math";
import { lastPlayedOf, playCountOf } from "./fields";

const PATINA_YEARS = 6;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export function deriveIntensity(rows: TrackColumns[]) {
	const playCounts = Int32Array.from(rows, (row) => playCountOf(row) ?? 0);

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
		const lastPlayed = lastPlayedOf(row);
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
