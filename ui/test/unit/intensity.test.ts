import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	FIELD,
	lastPlayedOf,
	playCountOf,
	TRACK_EXPRESSIONS,
} from "../../src/domain/track/fields.ts";
import * as intensity from "../../src/domain/track/intensity.ts";
import { deriveIntensity } from "../../src/domain/track/intensity.ts";
import { libraryColumnsOf } from "../../src/domain/track/libraryColumns.ts";
import type { LibrarySummary } from "../../src/shared/api/librarySummary.ts";

// The two numbers a row is shaded from. Nothing renders either of them, so what
// `heat.spec.ts` can see is one row against another; the scale itself, the
// clamp and the never-played sentinel only exist here.

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

// 'YYYY-MM-DD HH:MM:SS' in local time, which is what the component writes and
// what `readTimestamp` parses.
const stamp = (at: number) => {
	const when = new Date(at);
	const pad = (part: number) => String(part).padStart(2, "0");
	return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
};

const intensityOf = (rows: string[][]) =>
	deriveIntensity(libraryColumnsOf(rows, TRACK_EXPRESSIONS.length));

const row = (plays: number | null, lastPlayed?: number): string[] => {
	const columns: string[] = new Array(TRACK_EXPRESSIONS.length).fill("?");
	if (plays !== null) columns[FIELD.playCount] = String(plays);
	columns[FIELD.lastPlayed] =
		lastPlayed === undefined ? "N/A" : stamp(lastPlayed);
	return columns;
};

test("heat is logarithmic, so one outlier does not flatten everything else", () => {
	const { heat } = intensityOf([row(163), row(107), row(72)]);

	assert.equal(heat[0], 1);
	assert.ok(heat[1] > 0.8, `107 plays against 163 shaded ${heat[1]}`);
	assert.ok(heat[1] < heat[0]);
	assert.ok(heat[2] < heat[1]);
});

test("the most played track in the set is the top of the scale", () => {
	assert.equal(intensityOf([row(3), row(1)]).heat[0], 1);
});

test("a track never played is flat rather than faded", () => {
	const { heat, patina } = intensityOf([row(100, Date.now()), row(0)]);

	assert.equal(heat[1], 0);
	assert.equal(patina[1], 0);
});

test("a date without a play count still reads as never played", () => {
	// The two facts come from different components and are spelled two ways
	// each, so an install can answer the date and not the count. Faded is a claim
	// about how long ago you stopped listening, and this row was never started.
	const { patina } = intensityOf([
		row(50, Date.now()),
		row(0, Date.now() - 5 * YEAR_MS),
	]);

	assert.equal(patina[1], 0);
});

test("a field the player cannot resolve counts as never played", () => {
	// With no playback-statistics component every row answers '?'. A library
	// where nothing is shaded is the right answer, and the ceiling is zero, so
	// this is also where a division by it would show up.
	const { heat, patina } = intensityOf([row(null), row(null)]);

	assert.deepEqual([...heat], [0, 0]);
	assert.deepEqual([...patina], [0, 0]);
});

test("patina reaches its ceiling at six years and stops there", () => {
	const now = Date.now();
	const { patina } = intensityOf([
		row(4, now - 3 * YEAR_MS),
		row(4, now - 6 * YEAR_MS),
		row(4, now - 40 * YEAR_MS),
	]);

	assert.ok(Math.abs(patina[0] - 0.5) < 0.01, `three years read ${patina[0]}`);
	assert.ok(patina[1] >= 0.99);
	assert.equal(patina[2], 1);
});

test("a date in the future does not go negative", () => {
	// Clock skew between the player's machine and this one, which is ordinary.
	const { patina } = intensityOf([row(4, Date.now() + 2 * DAY_MS)]);
	assert.equal(patina[0], 0);
});

interface SummaryCase {
	name: string;
	now: number;
	filename: string[];
	columns: Record<string, string[]>;
	expected: LibrarySummary;
}

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const SUMMARY_CASES: SummaryCase[] = JSON.parse(
	readFileSync(
		join(REPOSITORY, "plugins/fb2k/tests/fixtures/library_summary_cases.json"),
		"utf8",
	),
).cases;

const ROLE_AT = new Map(
	(Object.entries(FIELD) as [string, number][]).map(([role, at]) => [at, role]),
);

const rowsOf = ({ filename, columns }: SummaryCase) =>
	filename.map((_, at) =>
		TRACK_EXPRESSIONS.map(
			(_, field) => columns[ROLE_AT.get(field) ?? ""]?.[at] ?? "?",
		),
	);

const mostPlaysIn = (summary: LibrarySummary) =>
	summary.topTracks[0]?.plays ?? 0;

const todaysMostPlayed = (rows: string[][]) =>
	rows.reduce((most, one) => Math.max(most, playCountOf(one) ?? 0), 0);

const todaysShading = (one: string[], mostPlayed: number, now: number) => {
	const plays = playCountOf(one) ?? 0;
	const lastPlayed = lastPlayedOf(one);
	return {
		heat:
			plays > 0 && mostPlayed > 0
				? Math.log1p(plays) / Math.log1p(mostPlayed)
				: 0,
		patina:
			plays > 0 && lastPlayed !== null
				? Math.min(1, Math.max(0, (now - lastPlayed) / YEAR_MS / 6))
				: 0,
	};
};

type Shading = { heat: number; patina: number };
type ShadingOf = (row: string[], mostPlayed: number, now: number) => Shading;

// Looked up rather than imported, so the cases fail one by one on what is missing instead of the
// file failing to load.
const shadingOf = (): ShadingOf => {
	const found = (intensity as Record<string, unknown>).intensityOf;
	assert.equal(
		typeof found,
		"function",
		"intensity.ts exports no intensityOf(row, mostPlayed, now) shading one row",
	);
	return found as ShadingOf;
};

// Today's arrays are Float32Array, which rounds the seventh digit.
const CLOSE = 1e-6;

const assertShadedAs = (got: Shading, want: Shading, what: string) => {
	assert.ok(
		Math.abs(got.heat - want.heat) < CLOSE,
		`${what}: heat ${got.heat}, today ${want.heat}`,
	);
	assert.ok(
		Math.abs(got.patina - want.patina) < CLOSE,
		`${what}: patina ${got.patina}, today ${want.patina}`,
	);
};

for (const summaryCase of SUMMARY_CASES)
	test(`the summary's top track's plays are the highest play count over every row of the library, case ${summaryCase.name}`, () => {
		assert.equal(
			mostPlaysIn(summaryCase.expected),
			todaysMostPlayed(rowsOf(summaryCase)),
		);
	});

for (const summaryCase of SUMMARY_CASES)
	test(`each row shaded alone against the summary's top track is shaded as the whole set is by its own ceiling, case ${summaryCase.name}`, () => {
		const shade = shadingOf();
		const rows = rowsOf(summaryCase);
		const mostPlayed = mostPlaysIn(summaryCase.expected);
		const { now } = summaryCase;

		rows.forEach((one, at) => {
			assertShadedAs(
				shade(one, mostPlayed, now),
				todaysShading(one, mostPlayed, now),
				`row ${at}`,
			);
		});
	});

test("a row shaded against a library nobody has played is flat, not a division by zero", () => {
	// `topTracks` is empty there, so the ceiling is 0. The row itself carries a count the summary
	// has not caught up with yet, which is a revision apart and ordinary.
	const now = Date.now();
	assert.equal(shadingOf()(row(4, now - YEAR_MS), 0, now).heat, 0);
});

test("a row never played is flat and unfaded, whatever its date says", () => {
	const shade = shadingOf();
	const now = Date.now();

	assert.deepEqual(shade(row(0, now - 5 * YEAR_MS), 50, now), {
		heat: 0,
		patina: 0,
	});
	assert.deepEqual(shade(row(null), 50, now), { heat: 0, patina: 0 });
});

test("a row's patina is the years since it was last heard, from none to six, and no further either way", () => {
	const shade = shadingOf();
	const now = Date.now();
	const patinaAt = (ago: number) => shade(row(4, now - ago), 10, now).patina;

	assert.ok(Math.abs(patinaAt(3 * YEAR_MS) - 0.5) < 0.01);
	assert.equal(patinaAt(40 * YEAR_MS), 1);
	assert.equal(patinaAt(-2 * DAY_MS), 0);
});
