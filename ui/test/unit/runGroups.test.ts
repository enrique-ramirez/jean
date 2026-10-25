import assert from "node:assert/strict";
import test from "node:test";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import {
	coverCandidatesFromRuns,
	groupByAlbum,
	groupsFromRuns,
} from "../../src/domain/track/grouping.ts";
import {
	type LibraryColumns,
	libraryColumnsOf,
} from "../../src/domain/track/libraryColumns.ts";
import { trackRows, wholeRows } from "../../src/domain/track/project.ts";
import { fixture } from "./fakeLibraryHarness.ts";

interface RunsCase {
	name: string;
	source: "library_summary_cases.json" | "library_questions_cases.json";
	lengths: number[];
	covers: number[];
}

interface SourceCase {
	name: string;
	structure: number;
	revision: number;
	directory: string[];
	filename: string[];
	subsong?: string[];
	columns: Record<string, string[]>;
}

interface Span {
	start: number;
	count: number;
	cover: number;
}

const UNRESOLVED = "?";
const CREDIT_ROLES = new Set(["artist", "albumArtist"]);

const RUNS_CASES = fixture<{ cases: RunsCase[] }>(
	"library_runs_cases.json",
).cases;

const SOURCES: Record<RunsCase["source"], SourceCase[]> = {
	"library_summary_cases.json": fixture<{ cases: SourceCase[] }>(
		"library_summary_cases.json",
	).cases,
	"library_questions_cases.json": fixture<{ cases: SourceCase[] }>(
		"library_questions_cases.json",
	).cases,
};

const sourceOf = (one: RunsCase) => {
	const found = SOURCES[one.source].find((held) => held.name === one.name);
	assert.ok(found, `${one.source} holds no case ${one.name}`);
	return found;
};

// The component reads a credit of whitespace alone as nobody, where `groupByAlbum` gives it a group
// of its own so the rows `groupByAlbum` is compared against say "?" for one.
const blankCredits = (role: string, values: string[]) =>
	CREDIT_ROLES.has(role)
		? values.map((value) =>
				value !== "" && value.trim() === "" ? UNRESOLVED : value,
			)
		: values;

function columnsOf(one: SourceCase): LibraryColumns {
	const trackCount = one.directory.length;
	const roleOf = new Map(
		Object.entries(FIELD).map(([role, field]) => [field, role]),
	);
	const valuesOf = (role: string) =>
		blankCredits(
			role,
			one.columns[role] ?? new Array(trackCount).fill(UNRESOLVED),
		);
	const values = TRACK_EXPRESSIONS.map((_, field) =>
		valuesOf(roleOf.get(field) as string),
	);
	const rows = Array.from({ length: trackCount }, (_, ordinal) =>
		values.map((column) => column[ordinal]),
	);
	return libraryColumnsOf(rows, TRACK_EXPRESSIONS.length);
}

const spansOf = (groups: { start: number; count: number }[]) =>
	groups.map(({ start, count }) => ({ start, count }));

const coveredSpansOf = (groups: Span[]): Span[] =>
	groups.map(({ start, count, cover }) => ({ start, count, cover }));

const startsOf = (lengths: number[]) => {
	const starts: number[] = [];
	let at = 0;
	for (const length of lengths) {
		starts.push(at);
		at += length;
	}
	return starts;
};

const runOfEachOrdinal = (lengths: number[]) =>
	lengths.flatMap((length, run) => new Array<number>(length).fill(run));

// The rule for a list other than All Music: neighbouring positions are one group
// exactly when their ordinals fall in one run. Wherever the rows alone decide it that is the group
// `groupByAlbum` draws over the same rows, since one run is one album and one credit; where two runs
// of one record end up side by side, the runs keep them apart and `groupByAlbum` would not.
const expectedGroups = (
	runs: RunsCase,
	columns: LibraryColumns,
	positions: number[],
): Span[] => {
	const runOf = runOfEachOrdinal(runs.lengths);
	const drawn = groupByAlbum(trackRows(columns, positions));
	return drawn.flatMap(({ start, count }) => {
		const split: Span[] = [];
		for (let at = start; at < start + count; at += 1) {
			const run = runOf[positions[at]];
			const open = split[split.length - 1];
			if (open && runOf[positions[at - 1]] === run) open.count += 1;
			else split.push({ start: at, count: 1, cover: runs.covers[run] });
		}
		return split;
	});
};

const everyOther = (trackCount: number) =>
	Array.from({ length: Math.ceil(trackCount / 2) }, (_, at) => at * 2);

const withoutTheMiddleOfEachRun = (lengths: number[]) =>
	startsOf(lengths).flatMap((start, run) => {
		const length = lengths[run];
		const kept = Array.from({ length }, (_, step) => start + step);
		return length < 3 ? kept : [kept[0], kept[length - 1]];
	});

const recordsOf = (runs: RunsCase) => {
	const starts = startsOf(runs.lengths);
	const records = new Map<number, number[]>();
	runs.covers.forEach((cover, run) => {
		const held = records.get(cover) ?? [];
		for (let step = 0; step < runs.lengths[run]; step += 1)
			held.push(starts[run] + step);
		records.set(cover, held);
	});
	return [...records.values()];
};

const interleaved = (trackCount: number) => {
	const half = Math.ceil(trackCount / 2);
	const order: number[] = [];
	for (let at = 0; at < half; at += 1) {
		order.push(at);
		if (half + at < trackCount) order.push(half + at);
	}
	return order;
};

const descending = (trackCount: number) =>
	Array.from({ length: trackCount }, (_, at) => trackCount - 1 - at);

const samplesOf = (runs: RunsCase, trackCount: number) => [
	{ name: "every other position", positions: everyOther(trackCount) },
	{
		name: "each run without its middle",
		positions: withoutTheMiddleOfEachRun(runs.lengths),
	},
	...recordsOf(runs).map((positions, at) => ({
		name: `album record ${at}'s own positions`,
		positions,
	})),
	{ name: "the halves interleaved", positions: interleaved(trackCount) },
	{ name: "every position, last first", positions: descending(trackCount) },
	{ name: "no positions at all", positions: [] },
];

const LIBRARIES = (() => {
	const seen = new Map<string, { runs: RunsCase; source: SourceCase }>();
	for (const runs of RUNS_CASES) {
		const source = sourceOf(runs);
		const key = JSON.stringify([
			source.directory,
			source.filename,
			source.subsong,
			source.columns,
		]);
		if (!seen.has(key)) seen.set(key, { runs, source });
	}
	return [...seen.values()];
})();

const caseNamed = (name: string) => {
	const found = RUNS_CASES.find((one) => one.name === name);
	assert.ok(found, `the runs fixture holds no case ${name}`);
	return found;
};

const listOf = (positions: number[]) => ({ positions });

for (const { runs, source } of LIBRARIES)
	test(`over ${runs.source} case ${runs.name}, the groups from the runs are groupByAlbum's, covered by each run's cover`, () => {
		const columns = columnsOf(source);

		const whole = groupsFromRuns(runs, null);
		assert.deepEqual(spansOf(whole), spansOf(groupByAlbum(wholeRows(columns))));
		assert.deepEqual(
			whole.map((group) => group.cover),
			runs.covers,
		);
		// The virtualiser caches a group's measured height by its key.
		assert.equal(new Set(whole.map((group) => group.key)).size, whole.length);

		for (const { name, positions } of samplesOf(runs, columns.trackCount)) {
			const groups = groupsFromRuns(runs, positions);
			assert.deepEqual(
				coveredSpansOf(groups),
				expectedGroups(runs, columns, positions),
				`${name}: ${JSON.stringify(listOf(positions))}`,
			);
			assert.equal(
				new Set(groups.map((group) => group.key)).size,
				groups.length,
				`${name}: two groups share a key`,
			);
		}
	});

test("an album page over an album filed in two directories draws two groups, one per run, both covered by the album's cover", () => {
	const runs = caseNamed("album-across-directories");
	assert.deepEqual(runs.lengths, [6, 3, 2, 2, 4]);
	assert.deepEqual(runs.covers, [3, 6, 9, 3, 13]);

	assert.deepEqual(
		coveredSpansOf(groupsFromRuns(runs, [0, 1, 2, 3, 4, 5, 11, 12])),
		[
			{ start: 0, count: 6, cover: 3 },
			{ start: 6, count: 2, cover: 3 },
		],
	);
});

test("a list skipping the middle of a run still draws the run as one group", () => {
	const runs = caseNamed("album-across-directories");

	assert.deepEqual(coveredSpansOf(groupsFromRuns(runs, [0, 5, 6, 8])), [
		{ start: 0, count: 2, cover: 3 },
		{ start: 2, count: 2, cover: 6 },
	]);
});

test("a run whose positions sit either side of another run's is two groups", () => {
	const runs = caseNamed("album-across-directories");

	assert.deepEqual(coveredSpansOf(groupsFromRuns(runs, [1, 0, 7, 2, 6])), [
		{ start: 0, count: 2, cover: 3 },
		{ start: 2, count: 1, cover: 6 },
		{ start: 3, count: 1, cover: 3 },
		{ start: 4, count: 1, cover: 6 },
	]);
});

test("an empty library and an empty list draw no groups", () => {
	const empty = caseNamed("empty");
	assert.deepEqual(groupsFromRuns(empty, null), []);
	assert.deepEqual(
		groupsFromRuns(caseNamed("album-across-directories"), []),
		[],
	);
});

test("groups take positions as a typed array as readily as a list", () => {
	const runs = caseNamed("album-across-directories");
	assert.deepEqual(
		coveredSpansOf(groupsFromRuns(runs, Int32Array.from([0, 5, 6, 8]))),
		coveredSpansOf(groupsFromRuns(runs, [0, 5, 6, 8])),
	);
});

// A tagged run is one an album record's cover tells apart: a cover outside the run or past its first
// ordinal, or one cover carried by two runs, since an untagged run's cover is its own first ordinal
// and no other run's. A run whose cover is its own first ordinal and no other run's could be either.
const tellsOf = (runs: RunsCase) => {
	const starts = startsOf(runs.lengths);
	const carriers = new Map<number, number>();
	for (const cover of runs.covers)
		carriers.set(cover, (carriers.get(cover) ?? 0) + 1);
	return runs.covers.map(
		(cover, run) =>
			cover !== starts[run] || (carriers.get(cover) as number) > 1,
	);
};

const candidatesHold = (
	runs: RunsCase,
	positions: number[] | null,
	trackCount: number,
	name: string,
) => {
	const ordinalAt = (position: number) =>
		positions ? positions[position] : position;
	const length = positions ? positions.length : trackCount;
	const runOf = runOfEachOrdinal(runs.lengths);
	const tagged = tellsOf(runs);
	const groups = groupsFromRuns(runs, positions);

	const candidates = coverCandidatesFromRuns(runs, positions);
	const said = `${name}: candidates ${JSON.stringify(candidates)}`;

	assert.ok(
		candidates.every(
			(position, at) =>
				Number.isInteger(position) &&
				position >= 0 &&
				position < length &&
				(at === 0 || candidates[at - 1] < position),
		),
		`${said} are not ascending positions of the list`,
	);

	const chosen = new Set(candidates);
	const firstOfEachCover = new Map<number, number>();
	const allowed = new Set<number>();
	for (const group of groups) {
		const run = runOf[ordinalAt(group.start)];
		const isFirst = !firstOfEachCover.has(group.cover);
		if (isFirst) firstOfEachCover.set(group.cover, group.start);
		if (isFirst) allowed.add(group.start);
		if (!tagged[run])
			for (let at = group.start; at < group.start + group.count; at += 1)
				allowed.add(at);
	}

	for (const [cover, first] of firstOfEachCover)
		assert.ok(
			chosen.has(first),
			`${said} leave out position ${first}, where the record covered by ${cover} first appears`,
		);
	for (const position of candidates)
		assert.ok(
			allowed.has(position),
			`${said} take position ${position}, a later track of a tagged album`,
		);
};

for (const { runs, source } of LIBRARIES)
	test(`over ${runs.source} case ${runs.name}, a header's cover candidates are each album record's first position`, () => {
		const trackCount = source.directory.length;
		candidatesHold(runs, null, trackCount, "the whole library");
		for (const { name, positions } of samplesOf(runs, trackCount))
			candidatesHold(runs, positions, trackCount, name);
	});

test("an album filed in two directories is one candidate, its first position, and none of its later tracks", () => {
	const runs = caseNamed("album-across-directories");
	const candidates = coverCandidatesFromRuns(runs, null);

	assert.ok(candidates.includes(0));
	for (const position of [1, 2, 3, 4, 5, 11, 12])
		assert.ok(
			!candidates.includes(position),
			`candidates ${JSON.stringify(candidates)} take position ${position} of the album covered by 3`,
		);
	for (const opening of [6, 9, 13])
		assert.ok(
			candidates.includes(opening),
			`candidates ${JSON.stringify(candidates)} leave out the run opening at ${opening}`,
		);
});

test("a list holding only an album's second run takes its first position for the album's cover", () => {
	const runs = caseNamed("album-across-directories");
	assert.deepEqual(coverCandidatesFromRuns(runs, [11, 12]), [0]);
});

test("forty one-track runs of eight records are eight candidates, each record's first", () => {
	const runs = caseNamed("multi-valued-genres");
	assert.equal(runs.lengths.length, 40);

	assert.deepEqual(
		coverCandidatesFromRuns(runs, null),
		[0, 1, 2, 3, 4, 5, 6, 7],
	);
});

test("an empty library and an empty list have no cover candidates", () => {
	assert.deepEqual(coverCandidatesFromRuns(caseNamed("empty"), null), []);
	assert.deepEqual(
		coverCandidatesFromRuns(caseNamed("album-across-directories"), []),
		[],
	);
});
