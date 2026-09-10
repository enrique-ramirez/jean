import { clamp } from "@/shared/lib/math";
import {
	columnReader,
	FIELD,
	readNumber,
	readTimestamp,
	withAlternatives,
} from "./fields";
import type { LibraryColumns } from "./libraryColumns";

export const INTENSITY_FIELDS = withAlternatives([
	FIELD.playCount,
	FIELD.lastPlayed,
]);

const PATINA_YEARS = 6;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export function deriveIntensity(columns: LibraryColumns) {
	const { trackCount } = columns;
	const playsOf = columnReader(columns, FIELD.playCount, readNumber);
	const playedAt = columnReader(columns, FIELD.lastPlayed, readTimestamp);

	const playCounts = new Int32Array(trackCount);
	for (let ref = 0; ref < trackCount; ref += 1)
		playCounts[ref] = playsOf(ref) ?? 0;

	const maxPlayCount = playCounts.reduce(
		(most, plays) => Math.max(most, plays),
		0,
	);
	const ceiling = Math.log1p(maxPlayCount);
	const now = Date.now();

	const heat = Float32Array.from(playCounts, (plays) =>
		plays > 0 && ceiling > 0 ? Math.log1p(plays) / ceiling : 0,
	);

	const patina = new Float32Array(trackCount);
	for (let ref = 0; ref < trackCount; ref += 1) {
		if (playCounts[ref] <= 0) continue;
		const lastPlayed = playedAt(ref);
		if (lastPlayed === null) continue;
		patina[ref] = clamp((now - lastPlayed) / YEAR_MS / PATINA_YEARS, 0, 1);
	}

	return {
		heat,
		patina,
		playedCount: playCounts.reduce(
			(played, plays) => played + (plays > 0 ? 1 : 0),
			0,
		),
	};
}
