import type { TrackColumns } from "@/shared/api/types";
import { finished, SLICE_MASK, type Steps } from "@/shared/lib/idle";
import { clamp } from "@/shared/lib/math";
import {
	FIELD,
	lastPlayedIn,
	lastPlayedOf,
	playCountOf,
	playCountsIn,
	withBothSources,
} from "./fields";
import type { LibraryColumns } from "./libraryColumns";

export const INTENSITY_FIELDS = withBothSources([
	FIELD.playCount,
	FIELD.lastPlayed,
]);

const PATINA_YEARS = 6;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

interface Intensity {
	heat: Float32Array;
	patina: Float32Array;
	playedCount: number;
}

interface Counted {
	plays: Int32Array;
	mostPlayed: number;
}

const countedBy = new WeakMap<Float32Array, Counted>();

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

const mostIn = (plays: Int32Array) =>
	plays.reduce((most, one) => Math.max(most, one), 0);

export function* intensitySteps(columns: LibraryColumns): Steps<Intensity> {
	const { trackCount } = columns;
	const playsOf = yield* playCountsIn.steps(columns);
	const playedAt = yield* lastPlayedIn.steps(columns);

	const plays = new Int32Array(trackCount);
	for (let ref = 0; ref < trackCount; ref += 1) {
		plays[ref] = playsOf(ref) ?? 0;
		if ((ref & SLICE_MASK) === 0) yield;
	}

	const mostPlayed = mostIn(plays);
	const ceiling = Math.log1p(mostPlayed);
	const now = Date.now();

	const heat = new Float32Array(trackCount);
	const patina = new Float32Array(trackCount);
	let playedCount = 0;
	for (let ref = 0; ref < trackCount; ref += 1) {
		heat[ref] = heatOf(plays[ref], ceiling);
		if (plays[ref] > 0) {
			patina[ref] = patinaOf(plays[ref], playedAt(ref), now);
			playedCount += 1;
		}
		if ((ref & SLICE_MASK) === 0) yield;
	}

	countedBy.set(heat, { plays, mostPlayed });
	return { heat, patina, playedCount };
}

export const deriveIntensity = (columns: LibraryColumns) =>
	finished(intensitySteps(columns));
