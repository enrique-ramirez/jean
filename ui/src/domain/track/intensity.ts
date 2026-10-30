import type { TrackColumns } from "@/shared/api/types";
import { clamp } from "@/shared/lib/math";
import { FIELD, lastPlayedOf, playCountOf, withBothSources } from "./fields";

export const INTENSITY_FIELDS = withBothSources([
	FIELD.playCount,
	FIELD.lastPlayed,
]);

const PATINA_YEARS = 6;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

const heatOf = (plays: number, ceiling: number) =>
	plays > 0 && ceiling > 0 ? Math.log1p(plays) / ceiling : 0;

const patinaOf = (plays: number, lastPlayed: number | null, now: number) =>
	plays > 0 && lastPlayed !== null
		? clamp((now - lastPlayed) / YEAR_MS / PATINA_YEARS, 0, 1)
		: 0;

export interface Shading {
	heat: number;
	patina: number;
}

// A row is shaded alone, against the library's highest play count, which `GET /api/library/summary`
// answers as its first top track.
export const intensityOf = (
	row: TrackColumns,
	mostPlayed: number,
	now: number,
): Shading => {
	const plays = playCountOf(row) ?? 0;
	return {
		heat: clamp(heatOf(plays, Math.log1p(mostPlayed)), 0, 1),
		patina: patinaOf(plays, lastPlayedOf(row), now),
	};
};
