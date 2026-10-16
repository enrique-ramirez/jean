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
import { rowsMoved } from "./libraryColumns";

export const INTENSITY_FIELDS = withBothSources([
	FIELD.playCount,
	FIELD.lastPlayed,
]);

const PATINA_YEARS = 6;
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export interface Intensity {
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

export const rowPlays = (columns: LibraryColumns, ref: number) => {
	const row: string[] = [];
	for (const field of INTENSITY_FIELDS)
		row[field] = columns.fields[field].at(ref);
	return { plays: playCountOf(row) ?? 0, lastPlayed: lastPlayedOf(row) };
};

export function patchedIntensity(
	held: Intensity,
	before: LibraryColumns,
	after: LibraryColumns,
): Intensity {
	const counted = countedBy.get(held.heat);
	if (!counted || counted.plays.length !== after.trackCount)
		return deriveIntensity(after);

	const moved = rowsMoved(INTENSITY_FIELDS, before, after);
	if (moved.length === 0) return held;

	const plays = counted.plays.slice();
	const patina = held.patina.slice();
	const now = Date.now();
	let playedCount = held.playedCount;

	for (const ref of moved) {
		const { plays: next, lastPlayed } = rowPlays(after, ref);
		const was = plays[ref];
		plays[ref] = next;
		playedCount += (plays[ref] > 0 ? 1 : 0) - (was > 0 ? 1 : 0);
		patina[ref] = patinaOf(plays[ref], lastPlayed, now);
	}

	const mostPlayed = mostIn(plays);
	const ceiling = Math.log1p(mostPlayed);
	let heat: Float32Array;
	if (mostPlayed === counted.mostPlayed) {
		heat = held.heat.slice();
		for (const ref of moved) heat[ref] = heatOf(plays[ref], ceiling);
	} else heat = Float32Array.from(plays, (one) => heatOf(one, ceiling));

	countedBy.set(heat, { plays, mostPlayed });
	return { heat, patina, playedCount };
}
