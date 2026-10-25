import type { Schema } from "@/shared/api/client";
import { finished, SLICE_MASK, type Steps } from "@/shared/lib/idle";
import { columnsOf, slicedOver } from "./columnCache";
import { artistGroups, FIELD, readValue, tagGroups } from "./fields";
import { byValue, rowAt } from "./libraryColumns";
import type { Refs, TrackRows } from "./project";

interface DiscRun {
	number: number | null;
	start: number;
	count: number;
}

export interface AlbumSpan {
	kind: "span" | "run";
	key: string;
	start: number;
	count: number;
	cover: number;
}

export interface AlbumRun extends AlbumSpan {
	kind: "run";
	album: string | null;
	albumArtist: string | null;
	year: string | null;
	discs: DiscRun[] | null;
}

export interface AlbumHeading {
	album: string | null;
	albumArtist: string | null;
	year: string | null;
}

type OpenRun = Omit<AlbumRun, "discs"> & {
	discs: DiscRun[];
	albumGroup: number;
	artistGroup: number;
};

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

const RUN_FIELDS = [
	FIELD.album,
	FIELD.year,
	FIELD.discNumber,
	FIELD.artist,
	FIELD.albumArtist,
];

const WHOLE_LIBRARY: Refs = [];

const runsHeld = slicedOver<AlbumRun[]>();

const runSteps = (rows: TrackRows) =>
	runsHeld.steps(
		[...columnsOf(rows.columns, RUN_FIELDS), rows.indices ?? WHOLE_LIBRARY],
		() => runsOf(rows),
	);

// Contiguous runs only, never reordering: the player decides what comes next, so reordering here
// would desync the view from playback.
export const groupByAlbum = Object.assign(
	(rows: TrackRows): AlbumRun[] => finished(runSteps(rows)),
	{ steps: runSteps },
);

function* runsOf(rows: TrackRows): Steps<AlbumRun[]> {
	const { columns } = rows;
	const album = columns.fields[FIELD.album];
	const year = columns.fields[FIELD.year];
	const disc = columns.fields[FIELD.discNumber];

	const albums = yield* tagGroups.steps(album);
	const artists = yield* artistGroups.steps(columns);
	const discs = byValue(disc, discNumber);

	const built: OpenRun[] = [];
	const coverOf = new Map<number, number>();

	for (let index = 0; index < rows.length; index += 1) {
		if ((index & SLICE_MASK) === 0) yield;
		const ref = rows.ref(index);

		const albumGroup = albums.of[album.ids[ref]];
		const artistGroup = artists.at(ref);
		const number = discs[disc.ids[ref]];

		const open = built[built.length - 1];
		if (
			open &&
			open.albumGroup === albumGroup &&
			open.artistGroup === artistGroup
		) {
			open.count += 1;
			const run = open.discs[open.discs.length - 1];
			if (run.number === number) run.count += 1;
			else open.discs.push({ number, start: index, count: 1 });
			continue;
		}

		const name = albumGroup < 0 ? null : albums.names[albumGroup];
		const credit = artistGroup < 0 ? null : artists.names[artistGroup];

		const record = albumGroup < 0 ? -1 : artists.pairedWith(ref, albumGroup);
		const cover = albumGroup < 0 ? index : (coverOf.get(record) ?? index);
		if (albumGroup >= 0) coverOf.set(record, cover);

		built.push({
			kind: "run",
			key: `${credit ?? ""} ${name ?? ""} ${index}`,
			album: name,
			albumArtist: credit,
			albumGroup,
			artistGroup,
			year: readValue(year.at(ref)),
			start: index,
			count: 1,
			cover,
			discs: [{ number, start: index, count: 1 }],
		});
	}

	return built.map(({ albumGroup, artistGroup, ...group }) => ({
		...group,
		discs: discsWorthDrawing(group.discs),
	}));
}

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
				kind: "span",
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
			kind: "span",
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

export function coverCandidatesFromRuns(
	runs: RunBounds,
	positions: Refs | null,
): number[] {
	const { count, at } = coverCandidates(runs, positions);
	return Array.from({ length: count }, (_, index) => at(index));
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
const coverIsOrdinal = (group: AlbumSpan, rows: TrackRows) =>
	!isAlbumRun(group) && rows.indices !== null;

export const coverRefOf = (group: AlbumSpan, rows: TrackRows) =>
	coverIsOrdinal(group, rows) ? group.cover : rows.ref(group.cover);

export const coverRowOf = (group: AlbumSpan, rows: TrackRows) =>
	coverIsOrdinal(group, rows)
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

export const isAlbumRun = (group: AlbumSpan): group is AlbumRun =>
	group.kind === "run";

export function headingOf(
	group: AlbumSpan,
	rows: TrackRows,
): AlbumHeading | null {
	if (isAlbumRun(group)) return group;
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
	if (isAlbumRun(group)) return group.discs;
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
