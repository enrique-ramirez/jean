import type { Schema } from "@/shared/api/client";
import { FIELD, readValue } from "./fields";
import { rowAt } from "./libraryColumns";
import type { Refs, TrackRows } from "./project";

interface DiscRun {
	number: number | null;
	start: number;
	count: number;
}

export interface AlbumSpan {
	key: string;
	start: number;
	count: number;
	cover: number;
}

export interface AlbumHeading {
	album: string | null;
	albumArtist: string | null;
	year: string | null;
}

// Free text, and rippers disagree: '1', '01' and '1/2' all turn up, the last writing the disc total
// into the same field.
export function discNumber(raw: string | undefined): number | null {
	const text = readValue(raw);
	if (text === null) return null;
	const parsed = Number.parseInt(text, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const discsWorthDrawing = (discs: DiscRun[]): DiscRun[] | null =>
	discs.length >= 2 && discs.every((disc) => disc.number !== null)
		? discs
		: null;

type RunBounds = Pick<Schema["LibraryRuns"], "lengths"> &
	Partial<Pick<Schema["LibraryRuns"], "covers" | "untagged">>;

const startsHeld = new WeakMap<RunBounds, Int32Array>();

const runStarts = (runs: RunBounds) => {
	const held = startsHeld.get(runs);
	if (held) return held;

	const starts = new Int32Array(runs.lengths.length);
	let next = 0;
	for (let run = 0; run < runs.lengths.length; run += 1) {
		starts[run] = next;
		next += runs.lengths[run];
	}
	startsHeld.set(runs, starts);
	return starts;
};

function lastAtOrBelow(
	length: number,
	startAt: (index: number) => number,
	target: number,
): number {
	let low = 0;
	let high = length - 1;
	let found = -1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		if (startAt(middle) <= target) {
			found = middle;
			low = middle + 1;
		} else high = middle - 1;
	}
	return found;
}

const lastNumberAtOrBelow = (sorted: ArrayLike<number>, target: number) =>
	lastAtOrBelow(sorted.length, (index) => sorted[index], target);

const isUntagged = (untagged: readonly number[], run: number) =>
	untagged[lastNumberAtOrBelow(untagged, run)] === run;

interface RunSpans {
	groups: AlbumSpan[];
	runOf: number[];
}

function spansFromRuns(runs: RunBounds, positions: Refs | null): RunSpans {
	const starts = runStarts(runs);
	const groups: AlbumSpan[] = [];
	const runOf: number[] = [];

	if (positions === null) {
		runs.lengths.forEach((count, run) => {
			if (count <= 0) return;
			groups.push({
				key: `${run}:${starts[run]}`,
				start: starts[run],
				count,
				cover: runs.covers?.[run] ?? starts[run],
			});
			runOf.push(run);
		});
		return { groups, runOf };
	}

	let run = -1;
	let open: AlbumSpan | null = null;
	for (let at = 0; at < positions.length; at += 1) {
		const ordinal = positions[at];
		if (
			run < 0 ||
			ordinal < starts[run] ||
			ordinal >= starts[run] + runs.lengths[run]
		)
			run = lastNumberAtOrBelow(starts, ordinal);
		if (open && runOf[runOf.length - 1] === run) {
			open.count += 1;
			continue;
		}
		open = {
			key: `${run}:${at}`,
			start: at,
			count: 1,
			cover: runs.covers?.[run] ?? starts[run],
		};
		groups.push(open);
		runOf.push(run);
	}
	return { groups, runOf };
}

export const NO_GROUPS: AlbumSpan[] = [];

export const groupsFromRuns = (
	runs: RunBounds,
	positions: Refs | null,
): AlbumSpan[] => spansFromRuns(runs, positions).groups;

export interface CoverCandidates {
	count: number;
	at: (index: number) => number;
}

export function coverCandidates(
	runs: RunBounds,
	positions: Refs | null,
): CoverCandidates {
	const { groups, runOf } = spansFromRuns(runs, positions);
	const untagged = runs.untagged ?? [];
	const seenCovers = new Set<number>();
	const firsts: number[] = [];
	const sizes: number[] = [];
	const ends: number[] = [];
	let count = 0;

	groups.forEach((group, at) => {
		let size = 1;
		if (isUntagged(untagged, runOf[at])) size = group.count;
		else if (seenCovers.has(group.cover)) return;
		else seenCovers.add(group.cover);

		firsts.push(group.start);
		sizes.push(size);
		count += size;
		ends.push(count);
	});

	return {
		count,
		at: (index) => {
			let low = 0;
			let high = ends.length - 1;
			while (low < high) {
				const middle = (low + high) >> 1;
				if (ends[middle] > index) high = middle;
				else low = middle + 1;
			}
			const segment = low;
			return firsts[segment] + index - (ends[segment] - sizes[segment]);
		},
	};
}

export function coverTrackOf(runs: RunBounds, ordinal: number): number {
	const run = lastNumberAtOrBelow(runStarts(runs), ordinal);
	if (run < 0) return ordinal;
	return isUntagged(runs.untagged ?? [], run)
		? ordinal
		: (runs.covers?.[run] ?? ordinal);
}

// A group from the runs names its cover by ordinal. Where a list is its own ordinals in order, the
// ordinal is also a position; in a set it is not, and the cover may lie outside the set.
export const coverRefOf = (group: AlbumSpan, rows: TrackRows) =>
	rows.indices !== null ? group.cover : rows.ref(group.cover);

export const coverRowOf = (group: AlbumSpan, rows: TrackRows) =>
	rows.indices !== null
		? rowAt(rows.columns, group.cover)
		: rows.at(group.cover);

export function groupIndexAt(groups: readonly AlbumSpan[], position: number) {
	const found = lastAtOrBelow(
		groups.length,
		(index) => groups[index].start,
		position,
	);
	return found >= 0 && position < groups[found].start + groups[found].count
		? found
		: -1;
}

export function headingOf(
	group: AlbumSpan,
	rows: TrackRows,
): AlbumHeading | null {
	if (rows.isPending(group.start)) return null;

	const first = rows.at(group.start);
	return {
		album: readValue(first[FIELD.album]),
		albumArtist:
			readValue(first[FIELD.albumArtist]) ?? readValue(first[FIELD.artist]),
		year: readValue(first[FIELD.year]),
	};
}

export function discsOf(group: AlbumSpan, rows: TrackRows): DiscRun[] | null {
	if (group.count < 2) return null;

	const found: DiscRun[] = [];
	for (let at = group.start; at < group.start + group.count; at += 1) {
		if (rows.isPending(at)) return null;
		const number = discNumber(rows.at(at)[FIELD.discNumber]);
		const open = found[found.length - 1];
		if (open && open.number === number) open.count += 1;
		else found.push({ number, start: at, count: 1 });
	}
	return discsWorthDrawing(found);
}
