import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { albumTilesSteps } from "../../src/domain/track/albumTiles.ts";
import { slicedOver } from "../../src/domain/track/columnCache.ts";
import {
	artistGroups,
	FIELD,
	lastPlayedIn,
	playCountsIn,
	TRACK_EXPRESSIONS,
	tagGroups,
} from "../../src/domain/track/fields.ts";
import { groupByAlbum } from "../../src/domain/track/grouping.ts";
import { growingIndex } from "../../src/domain/track/growingIndex.ts";
import {
	deriveIntensity,
	intensitySteps,
} from "../../src/domain/track/intensity.ts";
import {
	type LibraryColumns,
	libraryColumnsOf,
} from "../../src/domain/track/libraryColumns.ts";
import { trackRows } from "../../src/domain/track/project.ts";
import { finished, inSlices, type Steps } from "../../src/shared/lib/idle.ts";
import { clamp } from "../../src/shared/lib/math.ts";

const NOW = Date.UTC(2026, 5, 15, 12);
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

const seeded = (seed: number) => {
	let state = seed >>> 0;
	return (count: number) => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state % count;
	};
};

const pad = (part: number) => String(part).padStart(2, "0");

const stamp = (at: number) => {
	const when = new Date(at);
	return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
};

const ARTISTS = ["Babasónicos", "Brand New", "Alice in Chains", "The Mock"];

function libraryRows(trackCount: number, seed: number): string[][] {
	const below = seeded(seed);
	const rows: string[][] = [];
	for (let at = 0; rows.length < trackCount; at += 1) {
		const row: string[] = new Array(TRACK_EXPRESSIONS.length).fill("?");
		const albumAt = Math.floor(at / 9);
		const artist = ARTISTS[albumAt % ARTISTS.length];
		const hasAlbum = at % 13 !== 0;

		row[FIELD.title] = `Song ${below(at % 5 === 0 ? 40 : 100_000)}`;
		row[FIELD.artist] = artist;
		if (!hasAlbum) {
			const repeated = below(40);
			row[FIELD.title] =
				at % 3 === 0 ? ` song  ${repeated} ` : `Song ${repeated}`;
			if (at % 91 === 0) row[FIELD.title] = "?";
			if (at % 117 === 0) row[FIELD.artist] = "?";
		} else {
			const name = albumAt % 10 === 9 ? "Greatest Hits" : `Record ${albumAt}`;
			row[FIELD.album] =
				at % 2 === 0 ? name : ` ${name.toLowerCase().replace(" ", "  ")} `;
			if (albumAt % 3 !== 0) row[FIELD.albumArtist] = artist;
			if (albumAt % 7 === 3) row[FIELD.discNumber] = String(1 + (at % 2));
			row[FIELD.trackNumber] = pad(1 + (at % 9));
			row[FIELD.year] = String(1980 + (albumAt % 40));
		}

		const plays = below(6) === 0 ? 0 : below(300);
		row[FIELD.playCount] = below(4) === 0 ? "?" : String(plays);
		row[FIELD.playCountLocal] = String(below(50));
		row[FIELD.lastPlayed] =
			plays > 0 ? stamp(NOW - below(4000) * DAY_MS) : "N/A";
		row[FIELD.lastPlayedLocal] =
			below(3) === 0 ? stamp(NOW - below(900) * DAY_MS) : "?";
		rows.push(row);
	}
	return rows;
}

const ROWS = libraryRows(4_500, 7);

const freshColumns = () => libraryColumnsOf(ROWS, TRACK_EXPRESSIONS.length);

const VIEW = Int32Array.from({ length: ROWS.length }, (_, at) =>
	at % 2 === 0 ? ROWS.length - 1 - at : at,
);

function oneStepPerSlice(t: TestContext) {
	let clock = 0;
	t.mock.method(performance, "now", () => {
		clock += 50;
		return clock;
	});
}

const counted = (total: number, onStep: (step: number) => void) =>
	function* (): Steps<string> {
		for (let step = 1; step <= total; step += 1) {
			onStep(step);
			yield;
		}
		return "built";
	};

const groupsOf = (columns: LibraryColumns) =>
	Array.from({ length: columns.trackCount }, (_, ref) =>
		artistGroups(columns).at(ref),
	);

test("inSlices answers what finished answers for the same derivation", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: NOW });
	oneStepPerSlice(t);
	const live = new AbortController().signal;

	const whole = freshColumns();
	const sliced = freshColumns();

	assert.deepEqual(
		await inSlices(intensitySteps(sliced), live),
		finished(intensitySteps(whole)),
	);

	const slicedAlbums = await inSlices(
		tagGroups.steps(sliced.fields[FIELD.album]),
		live,
	);
	const wholeAlbums = tagGroups(whole.fields[FIELD.album]);
	assert.deepEqual(
		[slicedAlbums.keys, slicedAlbums.names, slicedAlbums.of],
		[wholeAlbums.keys, wholeAlbums.names, wholeAlbums.of],
	);

	const slicedArtists = await inSlices(artistGroups.steps(sliced), live);
	assert.deepEqual(slicedArtists.names, artistGroups(whole).names);
	assert.deepEqual(
		Array.from({ length: ROWS.length }, (_, ref) => slicedArtists.at(ref)),
		groupsOf(whole),
	);

	assert.deepEqual(
		await inSlices(groupByAlbum.steps(trackRows(sliced, VIEW)), live),
		groupByAlbum(trackRows(whole, VIEW)),
	);
});

test("inSlices gives the event loop a turn between slices", async (t) => {
	oneStepPerSlice(t);
	let taskRan = false;
	const seenAt: boolean[] = [];

	const answer = await inSlices(
		counted(6, (step) => {
			if (step === 1) setImmediate(() => (taskRan = true));
			seenAt.push(taskRan);
		})(),
		new AbortController().signal,
	);

	assert.equal(answer, "built");
	assert.equal(seenAt.length, 6);
	assert.equal(seenAt[5], true, `the queued task ran at no step: ${seenAt}`);
});

test("inSlices rejects with the abort reason and takes no step after the abort", async (t) => {
	oneStepPerSlice(t);
	const controller = new AbortController();
	const reason = new Error("the library was replaced");
	let steps = 0;
	let stepsAfterAbort = 0;

	const building = inSlices(
		counted(6, (step) => {
			steps += 1;
			if (controller.signal.aborted) stepsAfterAbort += 1;
			if (step === 2) controller.abort(reason);
		})(),
		controller.signal,
	);

	await assert.rejects(building, (error) => error === reason);
	assert.equal(stepsAfterAbort, 0);
	assert.ok(steps < 6, `all ${steps} steps ran`);
});

test("slicedOver resumes a build begun in slices instead of starting it again", () => {
	const held = slicedOver<{ answer: number }>();
	const keys = [{}];
	let starts = 0;
	let steps = 0;

	function* build(): Steps<{ answer: number }> {
		starts += 1;
		for (let at = 0; at < 5; at += 1) {
			steps += 1;
			yield;
		}
		return { answer: 42 };
	}

	const begun = held.steps(keys, build);
	begun.next();
	begun.next();
	assert.equal(held.peek(keys), undefined);

	const read = held.get(keys, build);
	assert.deepEqual(read, { answer: 42 });
	assert.equal(starts, 1);
	assert.equal(steps, 5, "the read went back over steps the slices had taken");

	assert.equal(held.get(keys, build), read);
	assert.equal(held.peek(keys), read);
	assert.equal(starts, 1);

	assert.equal(finished(begun), read);
});

test("a derivation begun in slices and read whole gives a fresh build's answer, once", () => {
	const columns = freshColumns();
	const rows = trackRows(columns, VIEW);
	const runs = groupByAlbum.steps(rows);
	for (let at = 0; at < 3; at += 1) runs.next();

	const albums = groupByAlbum(rows);
	assert.deepEqual(albums, groupByAlbum(trackRows(freshColumns(), VIEW)));
	assert.equal(groupByAlbum(rows), albums);
});

function intensityAsItWas(columns: LibraryColumns) {
	const { trackCount } = columns;
	const playsOf = playCountsIn(columns);
	const playedAt = lastPlayedIn(columns);

	const playCounts = new Int32Array(trackCount);
	for (let ref = 0; ref < trackCount; ref += 1)
		playCounts[ref] = playsOf(ref) ?? 0;

	const ceiling = Math.log1p(
		playCounts.reduce((most, plays) => Math.max(most, plays), 0),
	);
	const now = Date.now();
	const heat = Float32Array.from(playCounts, (plays) =>
		plays > 0 && ceiling > 0 ? Math.log1p(plays) / ceiling : 0,
	);

	const patina = new Float32Array(trackCount);
	for (let ref = 0; ref < trackCount; ref += 1) {
		if (playCounts[ref] <= 0) continue;
		const lastPlayed = playedAt(ref);
		if (lastPlayed === null) continue;
		patina[ref] = clamp((now - lastPlayed) / YEAR_MS / 6, 0, 1);
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

test("deriveIntensity gives the heat, patina and played count it gave before it was sliced", (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: NOW });
	const columns = freshColumns();
	const before = intensityAsItWas(columns);

	assert.ok(before.playedCount > 0 && before.playedCount < ROWS.length);
	assert.ok(before.patina.some((one) => one > 0 && one < 1));
	assert.deepEqual(deriveIntensity(columns), before);
});

// foobar2000 answers `?` for a tag a track lacks, and `foo_jean` passes empty and `N/A` through too.
const presentTag = (raw: string | undefined) =>
	raw === undefined || raw === "?" || raw === "" || raw === "N/A" ? null : raw;

const foldedTag = (raw: string) =>
	raw.trim().toLowerCase().replace(/\s+/g, " ");

const creditOf = (row: string[]) => {
	const credited =
		presentTag(row[FIELD.albumArtist]) ?? presentTag(row[FIELD.artist]);
	return credited === null ? null : foldedTag(credited);
};

function tilesByTheOldRule(view: Int32Array): number[] {
	const seen = new Set<string>();
	const tiles: number[] = [];
	view.forEach((ref, at) => {
		const row = ROWS[ref];
		const album = presentTag(row[FIELD.album]);
		const title = presentTag(row[FIELD.title]);
		const named =
			album !== null
				? `album ${foldedTag(album)}`
				: title !== null
					? `title ${foldedTag(title)}`
					: null;
		if (named !== null) {
			const pair = JSON.stringify([named, creditOf(row)]);
			if (seen.has(pair)) return;
			seen.add(pair);
		}
		tiles.push(at);
	});
	return tiles;
}

test("album tiles keep one per record and one per title and artist among tracks with no album", async (t) => {
	oneStepPerSlice(t);
	const expected = tilesByTheOldRule(VIEW);

	assert.ok(
		expected.length < ROWS.length,
		"the library repeats no record or albumless title, so nothing was grouped",
	);
	assert.deepEqual(
		finished(albumTilesSteps(trackRows(freshColumns(), VIEW))),
		expected,
	);
	assert.deepEqual(
		await inSlices(
			albumTilesSteps(trackRows(freshColumns(), VIEW)),
			new AbortController().signal,
		),
		expected,
	);
});

test("tag groups put every row's value in the group of its folded spelling", () => {
	for (const field of [FIELD.album, FIELD.title]) {
		const column = freshColumns().fields[field];
		const groups = tagGroups(column);

		const keyOfRef = ROWS.map((_, ref) => {
			const group = groups.of[column.ids[ref]];
			return group < 0 ? null : groups.keys[group];
		});
		const expected = ROWS.map((row) => {
			const raw = presentTag(row[field]);
			return raw === null ? null : foldedTag(raw);
		});
		assert.deepEqual(keyOfRef, expected);
		assert.equal(new Set(groups.keys).size, groups.keys.length);
		assert.equal(
			groups.keys.length,
			new Set(expected.filter((key) => key !== null)).size,
		);
	}
});

const KEY = "library:3";

function titleIndex() {
	const builds = new Map<LibraryColumns, number>();
	let failAt: number | null = null;
	const index = growingIndex<string, number, [string, number]>(
		[FIELD.title],
		function* (byKey, rows, from) {
			builds.set(rows.columns, (builds.get(rows.columns) ?? 0) + 1);
			for (let at = from; at < rows.length; at += 1) {
				if (at === failAt) {
					failAt = null;
					throw new Error("a row it could not read");
				}
				const title = rows.at(at)[FIELD.title];
				byKey.set(title, (byKey.get(title) ?? 0) + 1);
				if ((at & 255) === 0) yield;
			}
		},
		(byKey) => [...byKey].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
	);
	return {
		index,
		builds,
		failNextAt: (row: number) => {
			failAt = row;
		},
	};
}

test("a build begun in slices for new columns and an ask for the columns on screen in between build each once", () => {
	const onScreen = freshColumns();
	const landing = freshColumns();
	const { index, builds } = titleIndex();

	const shown = index(KEY, onScreen);
	const sliced = index.steps(KEY, landing);
	for (let at = 0; at < 3; at += 1) sliced.next();

	assert.equal(
		index(KEY, onScreen),
		shown,
		"the columns on screen were indexed again",
	);
	const landed = finished(sliced);
	assert.equal(
		index(KEY, landing),
		landed,
		"the build the slices finished was not the one handed back after",
	);
	assert.deepEqual(
		[builds.get(onScreen), builds.get(landing)],
		[1, 1],
		"builds of the columns on screen, then of the landing columns",
	);
});

test("an index whose build threw is built again from the first row, not kept as far as it got", () => {
	const columns = freshColumns();
	const { index, failNextAt } = titleIndex();
	failNextAt(1_000);

	assert.throws(() => index(KEY, columns), /could not read/);
	assert.deepEqual(
		index(KEY, columns),
		titleIndex().index(KEY, freshColumns()),
	);
});

test("a build two callers share that throws is thrown to both, and the next ask builds it again", () => {
	const held = slicedOver<string>();
	const keys = [{}];
	let attempts = 0;

	function* build(): Steps<string> {
		attempts += 1;
		const attempt = attempts;
		for (let step = 1; step <= 4; step += 1) {
			if (attempt === 1 && step === 3) throw new Error("the build failed");
			yield;
		}
		return `built on attempt ${attempt}`;
	}

	const first = held.steps(keys, build);
	const second = held.steps(keys, build);
	first.next();
	second.next();

	assert.throws(() => finished(first), /the build failed/);
	assert.throws(
		() => finished(second),
		/the build failed/,
		"the second caller was handed an answer from a build that threw",
	);
	assert.equal(held.get(keys, build), "built on attempt 2");
});
